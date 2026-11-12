import { sql } from 'drizzle-orm';
import type { CurrencyCode } from '@aegis/shared';
import type { DbTransaction } from '../../db/index.js';
import { ledgerEntries, ledgerTransactions } from '../../db/schema.js';
import { AppError } from '../../core/errors.js';
import {
  assertBalancedPostings,
  sortAccountIdsForLocking,
  type LedgerDirection,
  type LedgerPostingInput,
} from '../money/financial-math.js';

export type LedgerCategory =
  | 'WELCOME_BONUS'
  | 'TRANSFER'
  | 'BILL_PAYMENT'
  | 'SAVINGS_DEPOSIT'
  | 'SAVINGS_REDEEM'
  | 'SAVINGS_YIELD'
  | 'FX_EXCHANGE'
  | 'STOCK_BUY'
  | 'STOCK_SELL';

export interface PostLedgerInput {
  idempotencyKey?: string;
  category: LedgerCategory;
  description: string;
  metadata?: Record<string, unknown>;
  postings: LedgerPostingInput[];
  /**
   * Optional flag when settling a previously locked LIMIT BUY order where funds were already reserved
   * in `locked_balance_cents`.
   */
  consumeLockedFundsForAccountId?: string;
}

export interface LedgerEntryReceipt {
  id: string;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  direction: LedgerDirection;
  amountCents: number;
  currency: CurrencyCode;
  balanceAfterCents: number;
}

export interface LedgerReceipt {
  transactionId: string;
  category: LedgerCategory;
  description: string;
  createdAt: string;
  lockOrderApplied: string[];
  entries: LedgerEntryReceipt[];
}

interface LockedAccountRow {
  id: string;
  user_id: string | null;
  account_number: string;
  label: string;
  currency: CurrencyCode;
  account_type: string;
  balance_cents: number | string;
  locked_balance_cents: number | string;
}

/**
 * Atomic Double-Entry Ledger Engine (`postLedgerTransaction`)
 *
 * DIDACTIC SUMMARY (ADR-002 & ADR-003):
 * 1. Validates that `sum(DEBIT) === sum(CREDIT)` per currency before touching the database.
 * 2. Sorts all unique `accountId`s lexicographically (`ORDER BY id ASC`) to prevent AB-BA deadlocks.
 * 3. Acquires PostgreSQL row-level pessimistic locks (`SELECT ... FOR UPDATE`).
 * 4. Verifies currency consistency and available funds (`balance_cents - locked_balance_cents >= debit`).
 *    (System liquidity accounts of type `SYSTEM` are allowed to go negative as central counterparties).
 * 5. Creates an immutable `ledger_transaction` + `ledger_entries` and updates materialized `balance_cents`.
 */
export async function postLedgerTransaction(
  tx: DbTransaction,
  input: PostLedgerInput
): Promise<LedgerReceipt> {
  // Step 1: Enforce Double-Entry Zero-Sum Invariant
  assertBalancedPostings(input.postings);

  // Step 2: Sort account IDs deterministically to prevent deadlocks
  const sortedAccountIds = sortAccountIdsForLocking(input.postings.map((p) => p.accountId));

  // Step 3: Acquire Pessimistic Row-Level Locks (SELECT ... FOR UPDATE)
  const idSqlList = sql.join(
    sortedAccountIds.map((id) => sql`${id}::uuid`),
    sql`, `
  );

  const lockedRows = (await tx.execute(sql`
    SELECT
      id,
      user_id,
      account_number,
      label,
      currency,
      account_type,
      balance_cents,
      locked_balance_cents
    FROM accounts
    WHERE id IN (${idSqlList})
    ORDER BY id ASC
    FOR UPDATE
  `)) as unknown as LockedAccountRow[];

  const accountsById = new Map<string, LockedAccountRow>();
  for (const row of lockedRows) {
    accountsById.set(row.id, row);
  }

  if (accountsById.size !== sortedAccountIds.length) {
    throw new AppError('NOT_FOUND', 'One or more ledger target accounts do not exist.', 404);
  }

  // Step 4: Compute net delta per account & verify sufficient funds
  const workingBalances = new Map<string, { balance: number; locked: number }>();
  for (const [id, acc] of accountsById.entries()) {
    workingBalances.set(id, {
      balance: Number(acc.balance_cents),
      locked: Number(acc.locked_balance_cents),
    });
  }

  const plannedEntries: Array<{
    accountId: string;
    accountNumber: string;
    accountLabel: string;
    direction: LedgerDirection;
    amountCents: number;
    currency: CurrencyCode;
    balanceAfterCents: number;
  }> = [];

  for (const posting of input.postings) {
    const account = accountsById.get(posting.accountId);
    if (!account) {
      throw new AppError('NOT_FOUND', `Account ${posting.accountId} not found`, 404);
    }

    if (account.currency !== posting.currency) {
      throw new AppError(
        'CURRENCY_MISMATCH',
        `Account ${account.account_number} is denominated in ${account.currency}, cannot post ${posting.currency}.`,
        400
      );
    }

    const state = workingBalances.get(posting.accountId)!;

    if (posting.direction === 'DEBIT') {
      // Customer accounts (non-SYSTEM) cannot overdraft their available balance
      if (account.account_type !== 'SYSTEM') {
        const consumingEscrow = input.consumeLockedFundsForAccountId === posting.accountId;
        const availableCents = consumingEscrow
          ? state.balance
          : state.balance - state.locked;

        if (availableCents < posting.amountCents) {
          throw new AppError(
            'INSUFFICIENT_FUNDS',
            `Insufficient available funds in ${account.currency} account (${account.account_number}). Available: ${(availableCents / 100).toFixed(2)}, Required: ${(posting.amountCents / 100).toFixed(2)}.`,
            422
          );
        }

        if (consumingEscrow) {
          state.locked = Math.max(0, state.locked - posting.amountCents);
        }
      }
      state.balance -= posting.amountCents;
    } else {
      state.balance += posting.amountCents;
    }

    plannedEntries.push({
      accountId: posting.accountId,
      accountNumber: account.account_number,
      accountLabel: account.label,
      direction: posting.direction,
      amountCents: posting.amountCents,
      currency: posting.currency,
      balanceAfterCents: state.balance,
    });
  }

  // Step 5: Persist immutable ledger_transaction
  const [txRecord] = await tx
    .insert(ledgerTransactions)
    .values({
      idempotencyKey: input.idempotencyKey,
      category: input.category,
      description: input.description,
      metadata: {
        ...(input.metadata ?? {}),
        lockOrderApplied: sortedAccountIds,
      },
    })
    .returning();

  if (!txRecord) {
    throw new AppError('INTERNAL_ERROR', 'Failed to create ledger transaction record', 500);
  }

  // Step 6: Persist immutable ledger_entries
  const insertedEntries = await tx
    .insert(ledgerEntries)
    .values(
      plannedEntries.map((entry) => ({
        transactionId: txRecord.id,
        accountId: entry.accountId,
        direction: entry.direction,
        amountCents: entry.amountCents,
        currency: entry.currency,
        balanceAfterCents: entry.balanceAfterCents,
      }))
    )
    .returning();

  // Step 7: Update materialized account balances inside the same ACID transaction
  for (const [accountId, finalState] of workingBalances.entries()) {
    await tx.execute(sql`
      UPDATE accounts
      SET
        balance_cents = ${finalState.balance},
        locked_balance_cents = ${finalState.locked}
      WHERE id = ${accountId}::uuid
    `);
  }

  return {
    transactionId: txRecord.id,
    category: input.category,
    description: input.description,
    createdAt: txRecord.createdAt.toISOString(),
    lockOrderApplied: sortedAccountIds,
    entries: plannedEntries.map((pe, idx) => ({
      id: insertedEntries[idx]?.id ?? '',
      accountId: pe.accountId,
      accountNumber: pe.accountNumber,
      accountLabel: pe.accountLabel,
      direction: pe.direction,
      amountCents: pe.amountCents,
      currency: pe.currency,
      balanceAfterCents: pe.balanceAfterCents,
    })),
  };
}
