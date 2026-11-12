import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

const scryptAsync = promisify(scrypt);

/**
 * Hashes a plaintext password using Node's native `crypto.scrypt` with a 16-byte cryptographic salt.
 * (AGENTS.md §2.3: Native crypto avoids C++ native addon build issues while maintaining OWASP security).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const keyBuffer = Buffer.from(keyHex, 'hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  if (keyBuffer.length !== derivedKey.length) return false;
  return timingSafeEqual(keyBuffer, derivedKey);
}

export interface JwtPayload {
  sub: string; // userId
  email: string;
  name: string;
  iat: number;
  exp: number;
}

/**
 * Signs a compact HS256 JWT using native `crypto.createHmac`.
 */
export function signJwt(user: { id: string; email: string; name: string }, ttlSeconds = 86400 * 7): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadObj: JwtPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    iat: now,
    exp: now + ttlSeconds,
  };
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = createHmac('sha256', env.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AppError('UNAUTHORIZED', 'Malformed authentication token', 401);
  }
  const [header, payload, signature] = parts as [string, string, string];
  const expectedSig = createHmac('sha256', env.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new AppError('UNAUTHORIZED', 'Invalid token signature', 401);
  }

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as JwtPayload;
  const now = Math.floor(Date.now() / 1000);
  if (decoded.exp < now) {
    throw new AppError('UNAUTHORIZED', 'Authentication token expired', 401);
  }
  return decoded;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: {
      id: string;
      email: string;
      name: string;
    };
  }
}

/**
 * Fastify preHandler hook that authenticates via Bearer header or `aegis_token` HttpOnly cookie.
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (request.cookies?.aegis_token) {
    token = request.cookies.aegis_token;
  }

  if (!token) {
    throw new AppError('UNAUTHORIZED', 'Authentication required. Please log in.', 401);
  }

  const payload = verifyJwt(token);
  request.authUser = {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
  };
}
