import type { FastifyInstance } from 'fastify';
import { and, eq, or } from 'drizzle-orm';
import { BillPaymentInputSchema, P2PTransferInputSchema } from '@aegis/shared';
import { accounts, users } from '../../db/schema.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/auth.js';
import { executeIdempotent } from '../../core/idempotency.js';
import { postLedgerTransaction } from '../../domain/ledger/post-ledger-transaction.js';
import { getOrCreateSystemAccount } from '../../domain/ledger/system-accounts.js';

export async function transferRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/transfers/p2p
   * Instant P2P / Pix Transfer between two users in BRL, USD, or EUR.
   *
   * ENGINEERING GUARANTEES (ADR-002 & ADR-003):
   * 1. Requires `Idempotency-Key` header — safe against network retries.
   * 2. Resolves sender and recipient accounts for the requested currency.
   * 3. Delegates to `postLedgerTransaction` which sorts account IDs (`ORDER BY id ASC`),
   *    acquires `SELECT ... FOR UPDATE` row locks (preventing double-spend & deadlocks),
   *    and writes balanced DEBIT + CREDIT entries.
   */
  app.post('/api/transfers/p2p', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.id;
    const body = P2PTransferInputSchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await executeIdempotent({
      userId,
      idempotencyKey,
      endpoint: 'POST /api/transfers/p2p',
      payload: body,
      statusCode: 201,
      handler: async (tx) => {
        // 1. Find sender's checking account for the requested currency
        const [senderAccount] = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, userId),
              eq(accounts.currency, body.currency),
              eq(accounts.accountType, 'CHECKING')
            )
          )
          .limit(1);

        if (!senderAccount) {
          throw new AppError(
            'NOT_FOUND',
            `You do not have an active ${body.currency} checking account.`,
            404
          );
        }

        // 2. Resolve recipient by email, document number, or accountNumber
        const identifier = body.recipientIdentifier.trim().toLowerCase();
        let recipientAccount: typeof senderAccount | undefined;
        let recipientName = body.recipientIdentifier;

        const [matchedUser] = await tx
          .select()
          .from(users)
          .where(
            or(
              eq(users.email, identifier),
              eq(users.documentNumber, body.recipientIdentifier.trim())
            )
          )
          .limit(1);

        if (matchedUser) {
          recipientName = matchedUser.name;
          const [acc] = await tx
            .select()
            .from(accounts)
            .where(
              and(
                eq(accounts.userId, matchedUser.id),
                eq(accounts.currency, body.currency),
                eq(accounts.accountType, 'CHECKING')
              )
            )
            .limit(1);
          recipientAccount = acc;
        } else {
          // Try lookup by account_number (e.g. "1002-1")
          const [acc] = await tx
            .select()
            .from(accounts)
            .where(
              and(
                eq(accounts.accountNumber, body.recipientIdentifier.trim()),
                eq(accounts.currency, body.currency),
                eq(accounts.accountType, 'CHECKING')
              )
            )
            .limit(1);
          recipientAccount = acc;
          if (acc?.userId) {
            const [u] = await tx.select().from(users).where(eq(users.id, acc.userId)).limit(1);
            if (u) recipientName = u.name;
          }
        }

        if (!recipientAccount) {
          throw new AppError(
            'NOT_FOUND',
            `Recipient "${body.recipientIdentifier}" not found with an active ${body.currency} account.`,
            404
          );
        }

        if (recipientAccount.id === senderAccount.id) {
          throw new AppError(
            'SELF_TRANSFER_NOT_ALLOWED',
            'Cannot transfer funds to the same source account.',
            400
          );
        }

        // 3. Execute atomic Double-Entry Ledger transfer with sorted SELECT FOR UPDATE locks
        const receipt = await postLedgerTransaction(tx, {
          idempotencyKey,
          category: 'TRANSFER',
          description: `${body.description || 'Pix Transfer'} to ${recipientName}`,
          metadata: {
            senderUserId: userId,
            recipientAccountId: recipientAccount.id,
            recipientAccountNumber: recipientAccount.accountNumber,
            recipientName,
          },
          postings: [
            {
              accountId: senderAccount.id,
              direction: 'DEBIT',
              amountCents: body.amountCents,
              currency: body.currency,
            },
            {
              accountId: recipientAccount.id,
              direction: 'CREDIT',
              amountCents: body.amountCents,
              currency: body.currency,
            },
          ],
        });

        return {
          transfer: {
            transactionId: receipt.transactionId,
            recipientName,
            recipientAccountNumber: recipientAccount.accountNumber,
            currency: body.currency,
            amountCents: body.amountCents,
            description: receipt.description,
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

  /**
   * POST /api/transfers/bill-payment
   * Pays a Boleto / Utility Barcode by debiting the user's checking account and crediting
   * the institutional `SYS-BILL-SETTLEMENT` counterparty account.
   */
  app.post('/api/transfers/bill-payment', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.id;
    const body = BillPaymentInputSchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await executeIdempotent({
      userId,
      idempotencyKey,
      endpoint: 'POST /api/transfers/bill-payment',
      payload: body,
      statusCode: 201,
      handler: async (tx) => {
        const [senderAccount] = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, userId),
              eq(accounts.currency, body.currency),
              eq(accounts.accountType, 'CHECKING')
            )
          )
          .limit(1);

        if (!senderAccount) {
          throw new AppError('NOT_FOUND', `Active ${body.currency} checking account not found`, 404);
        }

        const settlementAccount = await getOrCreateSystemAccount(
          tx,
          'SYS-BILL-SETTLEMENT',
          body.currency
        );

        const receipt = await postLedgerTransaction(tx, {
          idempotencyKey,
          category: 'BILL_PAYMENT',
          description: `Bill Payment: ${body.billerName} (${body.barcode.slice(0, 12)}...)`,
          metadata: {
            barcode: body.barcode,
            billerName: body.billerName,
          },
          postings: [
            {
              accountId: senderAccount.id,
              direction: 'DEBIT',
              amountCents: body.amountCents,
              currency: body.currency,
            },
            {
              accountId: settlementAccount.id,
              direction: 'CREDIT',
              amountCents: body.amountCents,
              currency: body.currency,
            },
          ],
        });

        return {
          payment: {
            transactionId: receipt.transactionId,
            billerName: body.billerName,
            barcode: body.barcode,
            currency: body.currency,
            amountCents: body.amountCents,
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
