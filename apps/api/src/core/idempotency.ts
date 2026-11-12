import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, type DbTransaction } from '../db/index.js';
import { idempotencyRecords } from '../db/schema.js';
import { AppError } from './errors.js';

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
  idempotencyKey: string;
}

/**
 * Computes a deterministic SHA-256 hash of a JSON payload for idempotency fingerprinting.
 */
export function hashPayload(payload: unknown): string {
  const canonical = JSON.stringify(payload ?? {});
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Executes a financial operation inside an ACID PostgreSQL transaction protected by an `Idempotency-Key`.
 *
 * DIDACTIC NOTE (ADR-003):
 * Why do we serialize on `(userId, idempotencyKey, endpoint)` using a transactional advisory lock?
 * Suppose a client sends two identical HTTP requests with the same `Idempotency-Key` at the exact
 * same millisecond. Without a lock on the key itself, both transactions would check `idempotency_records`,
 * see nothing, execute the business logic, and one would fail with a unique constraint error at the end.
 * By acquiring `pg_advisory_xact_lock(hashtext(...))` first, the second concurrent request waits cleanly
 * until the first commits, and then immediately returns the cached response (`replayed: true`)!
 */
export async function executeIdempotent<T>(params: {
  userId: string;
  idempotencyKey: string | undefined;
  endpoint: string;
  payload: unknown;
  statusCode?: number;
  handler: (tx: DbTransaction) => Promise<T>;
}): Promise<IdempotentResult<T>> {
  const rawKey = params.idempotencyKey?.trim();
  if (!rawKey || rawKey.length < 4 || rawKey.length > 128) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header (4-128 chars) is required for financial mutations.',
      400
    );
  }

  const requestHash = hashPayload(params.payload);
  const statusCode = params.statusCode ?? 200;

  return db.transaction(async (tx) => {
    // 1. Serialize concurrent requests sharing the same (userId, endpoint, idempotencyKey)
    const lockIdentifier = `${params.userId}:${params.endpoint}:${rawKey}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockIdentifier}))`);

    // 2. Check if this Idempotency-Key was already processed
    const [existing] = await tx
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.userId, params.userId),
          eq(idempotencyRecords.idempotencyKey, rawKey),
          eq(idempotencyRecords.endpoint, params.endpoint)
        )
      )
      .limit(1);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_KEY_CONFLICT',
          'This Idempotency-Key was already used with a different request payload.',
          409
        );
      }

      return {
        statusCode: existing.statusCode,
        body: existing.responseBody as T,
        replayed: true,
        idempotencyKey: rawKey,
      };
    }

    // 3. Execute the financial business logic inside the same ACID transaction
    const resultBody = await params.handler(tx);

    // 4. Persist the idempotency record atomically with the ledger changes
    await tx.insert(idempotencyRecords).values({
      userId: params.userId,
      idempotencyKey: rawKey,
      endpoint: params.endpoint,
      requestHash,
      statusCode,
      responseBody: resultBody as Record<string, unknown>,
    });

    return {
      statusCode,
      body: resultBody,
      replayed: false,
      idempotencyKey: rawKey,
    };
  });
}
