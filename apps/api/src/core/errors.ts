import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE_ENTITY'
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_SHARES'
  | 'LEDGER_IMBALANCE'
  | 'CURRENCY_MISMATCH'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'SELF_TRANSFER_NOT_ALLOWED'
  | 'INVALID_ORDER_STATE'
  | 'KYC_TIER_INSUFFICIENT'
  | 'RESTRICTED_SECURITY'
  | 'SUITABILITY_EXPIRED'
  | 'SUITABILITY_ATTESTATION_REQUIRED'
  | 'INTERNAL_ERROR';

/**
 * Structured domain/application error with explicit HTTP status and machine-readable code.
 * Never leaks internal database stack traces to the client (AGENTS.md §2.1).
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function globalErrorHandler(
  error: FastifyError | AppError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.errors.map((e) => `${e.path.join('.') || 'input'}: ${e.message}`).join('; '),
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }

  request.log.error({ err: error, url: request.url, method: request.method }, 'Unhandled error');

  reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred. Please try again later.',
    },
  });
}
