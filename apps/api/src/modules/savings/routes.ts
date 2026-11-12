import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  CreateSavingsVaultInputSchema,
  SavingsVaultMoveInputSchema,
  SimulateYieldInputSchema,
  type CurrencyCode,
  type SavingsProductType,
} from '@aegis/shared';
import { db } from '../../db/index.js';
import { accounts, savingsVaults } from '../../db/schema.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/auth.js';
import { executeIdempotent } from '../../core/idempotency.js';
import { calculateCompoundYield } from '../../domain/money/financial-math.js';
import { postLedgerTransaction } from '../../domain/ledger/post-ledger-transaction.js';
import { getOrCreateSystemAccount } from '../../domain/ledger/system-accounts.js';

const PRODUCT_CATALOG: Record<
  SavingsProductType,
  { label: string; cdiPercentage: number; annualRateBps: number }
> = {
  EMERGENCY_VAULT_100_CDI: {
    label: 'Emergency Liquidity Vault (100% CDI)',
    cdiPercentage: 100,
    annualRateBps: 1125, // 11.25% p.a.
  },
  CDB_LIQUIDEZ_110_CDI: {
    label: 'CDB Daily Liquidity (110% CDI)',
    cdiPercentage: 110,
    annualRateBps: 1238, // 12.38% p.a.
  },
  CDB_PLUS_120_CDI: {
    label: 'CDB Plus High Yield (120% CDI)',
    cdiPercentage: 120,
    annualRateBps: 1350, // 13.50% p.a.
  },
};

export async function savingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/savings/vaults', { preHandler: [requireAuth] }, async (request) => {
    const userId = request.authUser!.id;
    const vaults = await db
      .select()
      .from(savingsVaults)
      .where(eq(savingsVaults.userId, userId))
      .orderBy(desc(savingsVaults.createdAt));

    return {
      catalog: PRODUCT_CATALOG,
      vaults: vaults.map((v) => ({
        ...v,
        totalBalanceCents: v.principalCents + v.accruedYieldCents,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  });

  app.post('/api/savings/vaults', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.id;
    const body = CreateSavingsVaultInputSchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await executeIdempotent({
      userId,
      idempotencyKey,
      endpoint: 'POST /api/savings/vaults',
      payload: body,
      statusCode: 201,
      handler: async (tx) => {
        const spec = PRODUCT_CATALOG[body.productType];
        const vaultAccNumber = `VAULT-${Math.floor(100000 + Math.random() * 900000)}`;

        const [backingAccount] = await tx
          .insert(accounts)
          .values({
            userId,
            accountNumber: vaultAccNumber,
            currency: body.currency,
            accountType: 'SAVINGS_VAULT',
            label: `Vault: ${body.name} (${body.currency})`,
            balanceCents: 0,
            lockedBalanceCents: 0,
          })
          .returning();

        if (!backingAccount) {
          throw new AppError('INTERNAL_ERROR', 'Failed to create vault backing account', 500);
        }

        let ledgerReceipt = null;
        if (body.initialDepositCents > 0) {
          const [checkingAcc] = await tx
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

          if (!checkingAcc) {
            throw new AppError('NOT_FOUND', `No ${body.currency} checking account found`, 404);
          }

          ledgerReceipt = await postLedgerTransaction(tx, {
            idempotencyKey,
            category: 'SAVINGS_DEPOSIT',
            description: `Initial Deposit into Vault "${body.name}"`,
            postings: [
              {
                accountId: checkingAcc.id,
                direction: 'DEBIT',
                amountCents: body.initialDepositCents,
                currency: body.currency,
              },
              {
                accountId: backingAccount.id,
                direction: 'CREDIT',
                amountCents: body.initialDepositCents,
                currency: body.currency,
              },
            ],
          });
        }

        const [vault] = await tx
          .insert(savingsVaults)
          .values({
            userId,
            backingAccountId: backingAccount.id,
            name: body.name,
            productType: body.productType,
            currency: body.currency,
            annualRateBps: spec.annualRateBps,
            cdiPercentage: spec.cdiPercentage,
            principalCents: body.initialDepositCents,
            accruedYieldCents: 0,
            simulatedDaysElapsed: 0,
          })
          .returning();

        return {
          vault: {
            ...vault!,
            totalBalanceCents: vault!.principalCents + vault!.accruedYieldCents,
            createdAt: vault!.createdAt.toISOString(),
          },
          ledgerReceipt,
        };
      },
    });

    return reply.status(result.statusCode).send({
      ...result.body,
      idempotency: { key: result.idempotencyKey, replayed: result.replayed },
    });
  });

  app.post(
    '/api/savings/vaults/:vaultId/deposit',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.authUser!.id;
      const { vaultId } = request.params as { vaultId: string };
      const body = SavingsVaultMoveInputSchema.parse(request.body);
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      const result = await executeIdempotent({
        userId,
        idempotencyKey,
        endpoint: `POST /api/savings/vaults/${vaultId}/deposit`,
        payload: body,
        statusCode: 200,
        handler: async (tx) => {
          const [vault] = await tx
            .select()
            .from(savingsVaults)
            .where(and(eq(savingsVaults.id, vaultId), eq(savingsVaults.userId, userId)))
            .limit(1);

          if (!vault) {
            throw new AppError('NOT_FOUND', 'Savings vault not found', 404);
          }

          const currency = vault.currency as CurrencyCode;
          const [checkingAcc] = await tx
            .select()
            .from(accounts)
            .where(
              and(
                eq(accounts.userId, userId),
                eq(accounts.currency, currency),
                eq(accounts.accountType, 'CHECKING')
              )
            )
            .limit(1);

          if (!checkingAcc) {
            throw new AppError('NOT_FOUND', `Checking account for ${currency} not found`, 404);
          }

          const receipt = await postLedgerTransaction(tx, {
            idempotencyKey,
            category: 'SAVINGS_DEPOSIT',
            description: `Deposit into Savings Vault "${vault.name}"`,
            postings: [
              {
                accountId: checkingAcc.id,
                direction: 'DEBIT',
                amountCents: body.amountCents,
                currency,
              },
              {
                accountId: vault.backingAccountId,
                direction: 'CREDIT',
                amountCents: body.amountCents,
                currency,
              },
            ],
          });

          const [updated] = await tx
            .update(savingsVaults)
            .set({
              principalCents: sql`${savingsVaults.principalCents} + ${body.amountCents}`,
            })
            .where(eq(savingsVaults.id, vault.id))
            .returning();

          return {
            vault: {
              ...updated!,
              totalBalanceCents: updated!.principalCents + updated!.accruedYieldCents,
            },
            ledgerReceipt: receipt,
          };
        },
      });

      return reply.status(result.statusCode).send({
        ...result.body,
        idempotency: { key: result.idempotencyKey, replayed: result.replayed },
      });
    }
  );

  app.post(
    '/api/savings/vaults/:vaultId/redeem',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.authUser!.id;
      const { vaultId } = request.params as { vaultId: string };
      const body = SavingsVaultMoveInputSchema.parse(request.body);
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      const result = await executeIdempotent({
        userId,
        idempotencyKey,
        endpoint: `POST /api/savings/vaults/${vaultId}/redeem`,
        payload: body,
        statusCode: 200,
        handler: async (tx) => {
          const [vault] = await tx
            .select()
            .from(savingsVaults)
            .where(and(eq(savingsVaults.id, vaultId), eq(savingsVaults.userId, userId)))
            .limit(1);

          if (!vault) {
            throw new AppError('NOT_FOUND', 'Savings vault not found', 404);
          }

          const totalAvailable = vault.principalCents + vault.accruedYieldCents;
          if (body.amountCents > totalAvailable) {
            throw new AppError(
              'INSUFFICIENT_FUNDS',
              `Vault balance (${(totalAvailable / 100).toFixed(2)}) is less than requested redemption.`,
              422
            );
          }

          const currency = vault.currency as CurrencyCode;
          const [checkingAcc] = await tx
            .select()
            .from(accounts)
            .where(
              and(
                eq(accounts.userId, userId),
                eq(accounts.currency, currency),
                eq(accounts.accountType, 'CHECKING')
              )
            )
            .limit(1);

          if (!checkingAcc) {
            throw new AppError('NOT_FOUND', `Checking account for ${currency} not found`, 404);
          }

          const receipt = await postLedgerTransaction(tx, {
            idempotencyKey,
            category: 'SAVINGS_REDEEM',
            description: `Redemption from Savings Vault "${vault.name}"`,
            postings: [
              {
                accountId: vault.backingAccountId,
                direction: 'DEBIT',
                amountCents: body.amountCents,
                currency,
              },
              {
                accountId: checkingAcc.id,
                direction: 'CREDIT',
                amountCents: body.amountCents,
                currency,
              },
            ],
          });

          // Deduct from accrued yield first, then from principal
          const yieldReduction = Math.min(vault.accruedYieldCents, body.amountCents);
          const principalReduction = body.amountCents - yieldReduction;

          const [updated] = await tx
            .update(savingsVaults)
            .set({
              accruedYieldCents: vault.accruedYieldCents - yieldReduction,
              principalCents: vault.principalCents - principalReduction,
            })
            .where(eq(savingsVaults.id, vault.id))
            .returning();

          return {
            vault: {
              ...updated!,
              totalBalanceCents: updated!.principalCents + updated!.accruedYieldCents,
            },
            ledgerReceipt: receipt,
          };
        },
      });

      return reply.status(result.statusCode).send({
        ...result.body,
        idempotency: { key: result.idempotencyKey, replayed: result.replayed },
      });
    }
  );

  /**
   * POST /api/savings/vaults/:vaultId/simulate-yield
   * Didactic Time-Travel Simulator: Fast-forwards `businessDays` (e.g., 1d, 30d, 252d)
   * and credits compound interest from `SYS-TREASURY` into the vault's backing ledger account.
   */
  app.post(
    '/api/savings/vaults/:vaultId/simulate-yield',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.authUser!.id;
      const { vaultId } = request.params as { vaultId: string };
      const body = SimulateYieldInputSchema.parse(request.body);
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      const result = await executeIdempotent({
        userId,
        idempotencyKey,
        endpoint: `POST /api/savings/vaults/${vaultId}/simulate-yield`,
        payload: body,
        statusCode: 200,
        handler: async (tx) => {
          const [vault] = await tx
            .select()
            .from(savingsVaults)
            .where(and(eq(savingsVaults.id, vaultId), eq(savingsVaults.userId, userId)))
            .limit(1);

          if (!vault) {
            throw new AppError('NOT_FOUND', 'Savings vault not found', 404);
          }

          const currentTotal = vault.principalCents + vault.accruedYieldCents;
          if (currentTotal <= 0) {
            throw new AppError(
              'VALIDATION_ERROR',
              'Deposit funds into the vault before simulating compound interest.',
              400
            );
          }

          const yieldCalc = calculateCompoundYield({
            balanceCents: currentTotal,
            annualRateBps: vault.annualRateBps,
            businessDays: body.businessDays,
          });

          const currency = vault.currency as CurrencyCode;
          const sysTreasury = await getOrCreateSystemAccount(tx, 'SYS-TREASURY', currency);

          const receipt = await postLedgerTransaction(tx, {
            idempotencyKey,
            category: 'SAVINGS_YIELD',
            description: `CDI Yield Accrual (+${body.businessDays} business days @ ${vault.cdiPercentage}% CDI) on "${vault.name}"`,
            metadata: {
              businessDays: body.businessDays,
              annualRateBps: vault.annualRateBps,
              grossYieldCents: yieldCalc.grossYieldCents,
            },
            postings: [
              {
                accountId: sysTreasury.id,
                direction: 'DEBIT',
                amountCents: yieldCalc.grossYieldCents,
                currency,
              },
              {
                accountId: vault.backingAccountId,
                direction: 'CREDIT',
                amountCents: yieldCalc.grossYieldCents,
                currency,
              },
            ],
          });

          const [updated] = await tx
            .update(savingsVaults)
            .set({
              accruedYieldCents: vault.accruedYieldCents + yieldCalc.grossYieldCents,
              simulatedDaysElapsed: vault.simulatedDaysElapsed + body.businessDays,
            })
            .where(eq(savingsVaults.id, vault.id))
            .returning();

          return {
            vault: {
              ...updated!,
              totalBalanceCents: updated!.principalCents + updated!.accruedYieldCents,
            },
            yieldAccruedCents: yieldCalc.grossYieldCents,
            ledgerReceipt: receipt,
          };
        },
      });

      return reply.status(result.statusCode).send({
        ...result.body,
        idempotency: { key: result.idempotencyKey, replayed: result.replayed },
      });
    }
  );
}
