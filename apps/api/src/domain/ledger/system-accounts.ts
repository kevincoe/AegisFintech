import { and, eq } from 'drizzle-orm';
import type { CurrencyCode } from '@aegis/shared';
import type { DbClient, DbTransaction } from '../../db/index.js';
import { accounts } from '../../db/schema.js';

export type SystemAccountRole =
  | 'SYS-TREASURY'
  | 'SYS-FX-POOL'
  | 'SYS-MARKET-CLEARING'
  | 'SYS-BILL-SETTLEMENT';

const SYSTEM_LABELS: Record<SystemAccountRole, string> = {
  'SYS-TREASURY': 'Aegis Central Treasury & Yield Reserve',
  'SYS-FX-POOL': 'Aegis FX Multi-Currency Liquidity Pool',
  'SYS-MARKET-CLEARING': 'Aegis Stock Exchange Clearing House',
  'SYS-BILL-SETTLEMENT': 'Aegis Bill & Merchant Settlement Clearing',
};

/**
 * Returns (or creates if missing) the System Counterparty Account for a given role and currency.
 * Because Double-Entry Bookkeeping requires every DEBIT to have a matching CREDIT in the same currency,
 * system liquidity accounts serve as the institutional counterparty for external inflows/outflows.
 */
export async function getOrCreateSystemAccount(
  dbOrTx: DbClient | DbTransaction,
  role: SystemAccountRole,
  currency: CurrencyCode
) {
  const accountNumber = `${role}-${currency}`;

  const [existing] = await dbOrTx
    .select()
    .from(accounts)
    .where(and(eq(accounts.accountNumber, accountNumber), eq(accounts.currency, currency)))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await dbOrTx
    .insert(accounts)
    .values({
      userId: null,
      accountNumber,
      currency,
      accountType: 'SYSTEM',
      label: `${SYSTEM_LABELS[role]} (${currency})`,
      balanceCents: 0,
      lockedBalanceCents: 0,
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    return created;
  }

  const [fetchedAfterConflict] = await dbOrTx
    .select()
    .from(accounts)
    .where(and(eq(accounts.accountNumber, accountNumber), eq(accounts.currency, currency)))
    .limit(1);

  return fetchedAfterConflict!;
}
