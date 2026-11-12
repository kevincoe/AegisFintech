import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { FxExchangeInputSchema, FxQuoteQuerySchema } from '@aegis/shared';
import { accounts } from '../../db/schema.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/auth.js';
import { executeIdempotent } from '../../core/idempotency.js';
import { calculateFxConversion } from '../../domain/money/financial-math.js';
import { postLedgerTransaction } from '../../domain/ledger/post-ledger-transaction.js';
import { getOrCreateSystemAccount } from '../../domain/ledger/system-accounts.js';
import { FX_IOF_BPS, FX_SPREAD_BPS, getAllFxPairs, getFxRateScaled1e4 } from './rates.js';

export async function fxRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/fx/rates', async () => {
    return {
      pairs: getAllFxPairs(),
      updatedAt: new Date().toISOString(),
    };
  });

  app.post('/api/fx/quote', { preHandler: [requireAuth] }, async (request) => {
    const body = FxQuoteQuerySchema.parse(request.body);
    const rateScaled1e4 = getFxRateScaled1e4(body.fromCurrency, body.toCurrency);
    const quote = calculateFxConversion({
      fromCurrency: body.fromCurrency,
      toCurrency: body.toCurrency,
      sourceAmountCents: body.sourceAmountCents,
      rateScaled1e4,
      spreadBps: FX_SPREAD_BPS,
      iofBps: FX_IOF_BPS,
    });
    return { quote };
  });

  /**
   * POST /api/fx/exchange
   * Atomic Multi-Currency Conversion via 4-Leg Double-Entry Bookkeeping:
   * - Leg 1: DEBIT User's `fromCurrency` account (`sourceAmountCents`)
   * - Leg 2: CREDIT `SYS-FX-POOL` `fromCurrency` account (`sourceAmountCents`)
   * - Leg 3: DEBIT `SYS-FX-POOL` `toCurrency` account (`targetAmountCents`)
   * - Leg 4: CREDIT User's `toCurrency` account (`targetAmountCents`)
   *
   * Notice how `fromCurrency` entries sum to 0 AND `toCurrency` entries sum to 0 inside a single
   * ACID PostgreSQL transaction with sorted `SELECT ... FOR UPDATE` row locks!
   */
  app.post('/api/fx/exchange', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.id;
    const body = FxExchangeInputSchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await executeIdempotent({
      userId,
      idempotencyKey,
      endpoint: 'POST /api/fx/exchange',
      payload: body,
      statusCode: 201,
      handler: async (tx) => {
        const rateScaled1e4 = getFxRateScaled1e4(body.fromCurrency, body.toCurrency);
        const quote = calculateFxConversion({
          fromCurrency: body.fromCurrency,
          toCurrency: body.toCurrency,
          sourceAmountCents: body.sourceAmountCents,
          rateScaled1e4,
          spreadBps: FX_SPREAD_BPS,
          iofBps: FX_IOF_BPS,
        });

        const [sourceAccount] = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, userId),
              eq(accounts.currency, body.fromCurrency),
              eq(accounts.accountType, 'CHECKING')
            )
          )
          .limit(1);

        const [targetAccount] = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, userId),
              eq(accounts.currency, body.toCurrency),
              eq(accounts.accountType, 'CHECKING')
            )
          )
          .limit(1);

        if (!sourceAccount || !targetAccount) {
          throw new AppError(
            'NOT_FOUND',
            `User is missing a ${body.fromCurrency} or ${body.toCurrency} checking account.`,
            404
          );
        }

        const fxPoolSource = await getOrCreateSystemAccount(tx, 'SYS-FX-POOL', body.fromCurrency);
        const fxPoolTarget = await getOrCreateSystemAccount(tx, 'SYS-FX-POOL', body.toCurrency);

        const receipt = await postLedgerTransaction(tx, {
          idempotencyKey,
          category: 'FX_EXCHANGE',
          description: `FX Exchange: ${body.fromCurrency} -> ${body.toCurrency} @ ${quote.effectiveRate}`,
          metadata: {
            quote,
          },
          postings: [
            {
              accountId: sourceAccount.id,
              direction: 'DEBIT',
              amountCents: quote.sourceAmountCents,
              currency: body.fromCurrency,
            },
            {
              accountId: fxPoolSource.id,
              direction: 'CREDIT',
              amountCents: quote.sourceAmountCents,
              currency: body.fromCurrency,
            },
            {
              accountId: fxPoolTarget.id,
              direction: 'DEBIT',
              amountCents: quote.targetAmountCents,
              currency: body.toCurrency,
            },
            {
              accountId: targetAccount.id,
              direction: 'CREDIT',
              amountCents: quote.targetAmountCents,
              currency: body.toCurrency,
            },
          ],
        });

        return {
          exchange: {
            transactionId: receipt.transactionId,
            quote,
            createdAt: receipt.createdAt,
          },
          ledgerReceipt: receipt,
        };
      },
    });

    return reply.status(result.statusCode).send({
      ...result.body,
      idempotency: {
        key: result.idempotencyKey,
        replayed: result.replayed,
      },
    });
  });
}
