import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  accounts,
  assets,
  ledgerEntries,
  ledgerTransactions,
  portfolios,
  savingsVaults,
} from '../../db/schema.js';
import { requireAuth } from '../../core/auth.js';
import { getFxRateScaled1e4 } from '../fx/rates.js';
import type { CurrencyCode } from '@aegis/shared';

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Consolidated Account Summary (Zero Pass-Through Bloat — queries Drizzle directly)
   * Returns multi-currency checking balances, savings vaults total, stock portfolio valuation,
   * and consolidated Net Worth converted to BRL.
   */
  app.get('/api/accounts/summary', { preHandler: [requireAuth] }, async (request) => {
    const userId = request.authUser!.id;

    const userAccounts = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.accountType, 'CHECKING')));

    const vaults = await db
      .select()
      .from(savingsVaults)
      .where(eq(savingsVaults.userId, userId));

    const userPositions = await db
      .select({
        symbol: portfolios.symbol,
        quantity: portfolios.quantity,
        lockedQuantity: portfolios.lockedQuantity,
        averagePriceCents: portfolios.averagePriceCents,
        realizedPnlCents: portfolios.realizedPnlCents,
        currentPriceCents: assets.currentPriceCents,
        currency: assets.currency,
        name: assets.name,
      })
      .from(portfolios)
      .innerJoin(assets, eq(portfolios.symbol, assets.symbol))
      .where(eq(portfolios.userId, userId));

    const convertToBrlCents = (cents: number, currency: CurrencyCode): number => {
      if (currency === 'BRL') return cents;
      const rate1e4 = getFxRateScaled1e4(currency, 'BRL');
      return Math.round((cents * rate1e4) / 10000);
    };

    const checkingAccounts = userAccounts.map((acc) => ({
      id: acc.id,
      accountNumber: acc.accountNumber,
      currency: acc.currency as CurrencyCode,
      label: acc.label,
      balanceCents: acc.balanceCents,
      lockedBalanceCents: acc.lockedBalanceCents,
      availableBalanceCents: acc.balanceCents - acc.lockedBalanceCents,
      balanceInBrlCents: convertToBrlCents(acc.balanceCents, acc.currency as CurrencyCode),
    }));

    const totalCheckingBrlCents = checkingAccounts.reduce(
      (sum, acc) => sum + acc.balanceInBrlCents,
      0
    );

    const totalSavingsBrlCents = vaults.reduce((sum, v) => {
      const totalVault = v.principalCents + v.accruedYieldCents;
      return sum + convertToBrlCents(totalVault, v.currency as CurrencyCode);
    }, 0);

    const totalInvestmentsBrlCents = userPositions.reduce((sum, pos) => {
      if (pos.quantity <= 0) return sum;
      const marketValueCents = pos.quantity * pos.currentPriceCents;
      return sum + convertToBrlCents(marketValueCents, pos.currency as CurrencyCode);
    }, 0);

    return {
      checkingAccounts,
      netWorthSummary: {
        totalCheckingBrlCents,
        totalSavingsBrlCents,
        totalInvestmentsBrlCents,
        totalNetWorthBrlCents:
          totalCheckingBrlCents + totalSavingsBrlCents + totalInvestmentsBrlCents,
      },
    };
  });

  /**
   * Double-Entry Account Statement & Audit Trail
   * Returns all transactions involving any of the user's accounts, together with the complete
   * set of balanced DEBIT and CREDIT postings for the Engineering X-Ray Inspector.
   */
  app.get('/api/accounts/statement', { preHandler: [requireAuth] }, async (request) => {
    const userId = request.authUser!.id;
    const { currency, limit = '30' } = request.query as {
      currency?: CurrencyCode;
      limit?: string;
    };

    const userAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId));

    const filteredAccounts = currency
      ? userAccounts.filter((a) => a.currency === currency)
      : userAccounts;

    if (filteredAccounts.length === 0) {
      return { transactions: [] };
    }

    const userAccountIds = filteredAccounts.map((a) => a.id);
    const userAccountIdSet = new Set(userAccountIds);

    // Find recent ledger entries touching the user's accounts
    const matchingEntries = await db
      .select({
        transactionId: ledgerEntries.transactionId,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.accountId, userAccountIds))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(Math.min(100, Math.max(5, Number(limit) * 2)));

    const uniqueTxIds = [...new Set(matchingEntries.map((e) => e.transactionId))].slice(
      0,
      Math.min(50, Math.max(1, Number(limit)))
    );

    if (uniqueTxIds.length === 0) {
      return { transactions: [] };
    }

    const txRows = await db
      .select()
      .from(ledgerTransactions)
      .where(inArray(ledgerTransactions.id, uniqueTxIds))
      .orderBy(desc(ledgerTransactions.createdAt));

    // Fetch ALL ledger legs (both DEBIT and CREDIT, including counterparty accounts) for didactic transparency
    const allEntriesForTxs = await db
      .select({
        id: ledgerEntries.id,
        transactionId: ledgerEntries.transactionId,
        accountId: ledgerEntries.accountId,
        accountNumber: accounts.accountNumber,
        accountLabel: accounts.label,
        accountType: accounts.accountType,
        direction: ledgerEntries.direction,
        amountCents: ledgerEntries.amountCents,
        currency: ledgerEntries.currency,
        balanceAfterCents: ledgerEntries.balanceAfterCents,
      })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(ledgerEntries.accountId, accounts.id))
      .where(inArray(ledgerEntries.transactionId, uniqueTxIds));

    const entriesByTx = new Map<string, typeof allEntriesForTxs>();
    for (const entry of allEntriesForTxs) {
      const list = entriesByTx.get(entry.transactionId) ?? [];
      list.push(entry);
      entriesByTx.set(entry.transactionId, list);
    }

    const transactions = txRows.map((tx) => {
      const legs = entriesByTx.get(tx.id) ?? [];
      const userCheckingLegs = legs.filter(
        (l) => userAccountIdSet.has(l.accountId) && l.accountType === 'CHECKING'
      );
      const primaryLeg = userCheckingLegs[0] ?? legs.find((l) => userAccountIdSet.has(l.accountId)) ?? legs[0]!;

      return {
        id: tx.id,
        idempotencyKey: tx.idempotencyKey,
        category: tx.category,
        description: tx.description,
        createdAt: tx.createdAt.toISOString(),
        metadata: tx.metadata,
        primaryImpact: {
          direction: primaryLeg.direction,
          amountCents: primaryLeg.amountCents,
          currency: primaryLeg.currency,
          balanceAfterCents: primaryLeg.balanceAfterCents,
        },
        doubleEntryLegs: legs,
      };
    });

    return { transactions };
  });
}
