import { and, asc, eq, sql } from 'drizzle-orm';
import type { CurrencyCode } from '@aegis/shared';
import { db, type DbTransaction } from '../../db/index.js';
import { accounts, assets, portfolios, tradeOrders } from '../../db/schema.js';
import {
  calculateBrokerageFee,
  calculatePortfolioAfterBuy,
  calculatePortfolioAfterSell,
} from '../../domain/money/financial-math.js';
import { postLedgerTransaction } from '../../domain/ledger/post-ledger-transaction.js';
import { getOrCreateSystemAccount } from '../../domain/ledger/system-accounts.js';
import { getAllFxPairs, nudgeFxRates } from '../fx/rates.js';

export const DEFAULT_MARKET_ASSETS = [
  {
    symbol: 'PETR4',
    name: 'Petrobras PN',
    sector: 'Energy & Oil',
    exchange: 'B3',
    currency: 'BRL' as const,
    currentPriceCents: 3850, // R$ 38,50
    openPriceCents: 3800,
    highPriceCents: 3890,
    lowPriceCents: 3780,
    volatilityBps: 140,
  },
  {
    symbol: 'VALE3',
    name: 'Vale ON',
    sector: 'Mining & Metals',
    exchange: 'B3',
    currency: 'BRL' as const,
    currentPriceCents: 6120, // R$ 61,20
    openPriceCents: 6080,
    highPriceCents: 6180,
    lowPriceCents: 6040,
    volatilityBps: 130,
  },
  {
    symbol: 'ITUB4',
    name: 'Itaú Unibanco PN',
    sector: 'Financials & Banking',
    exchange: 'B3',
    currency: 'BRL' as const,
    currentPriceCents: 3480, // R$ 34,80
    openPriceCents: 3450,
    highPriceCents: 3510,
    lowPriceCents: 3430,
    volatilityBps: 95,
  },
  {
    symbol: 'WEGE3',
    name: 'WEG S.A. ON',
    sector: 'Industrial Electrification',
    exchange: 'B3',
    currency: 'BRL' as const,
    currentPriceCents: 5240, // R$ 52,40
    openPriceCents: 5190,
    highPriceCents: 5280,
    lowPriceCents: 5150,
    volatilityBps: 115,
  },
  {
    symbol: 'IVVB11',
    name: 'iShares S&P 500 B3 ETF',
    sector: 'Index ETF',
    exchange: 'B3',
    currency: 'BRL' as const,
    currentPriceCents: 34200, // R$ 342,00
    openPriceCents: 34000,
    highPriceCents: 34450,
    lowPriceCents: 33900,
    volatilityBps: 85,
  },
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    sector: 'Technology',
    exchange: 'NASDAQ',
    currency: 'USD' as const,
    currentPriceCents: 22850, // US$ 228.50
    openPriceCents: 22600,
    highPriceCents: 23000,
    lowPriceCents: 22550,
    volatilityBps: 125,
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    sector: 'Semiconductors & AI',
    exchange: 'NASDAQ',
    currency: 'USD' as const,
    currentPriceCents: 13800, // US$ 138.00
    openPriceCents: 13500,
    highPriceCents: 13950,
    lowPriceCents: 13450,
    volatilityBps: 190,
  },
];

export async function ensureDefaultAssets(dbOrTx: typeof db | DbTransaction = db): Promise<void> {
  for (const item of DEFAULT_MARKET_ASSETS) {
    await dbOrTx
      .insert(assets)
      .values(item)
      .onConflictDoNothing({ target: assets.symbol });
  }
}

/**
 * Matches and settles any OPEN limit orders for `symbol` whose limit price is crossed by `marketPriceCents`.
 * Executes atomically inside the database transaction `tx`.
 */
export async function matchOpenLimitOrdersForSymbol(
  tx: DbTransaction,
  symbol: string,
  marketPriceCents: number
): Promise<number> {
  const openOrders = await tx
    .select()
    .from(tradeOrders)
    .where(and(eq(tradeOrders.status, 'OPEN'), eq(tradeOrders.symbol, symbol)))
    .orderBy(asc(tradeOrders.createdAt));

  let filledCount = 0;

  for (const order of openOrders) {
    if (order.limitPriceCents === null) continue;

    const shouldFillBuy = order.side === 'BUY' && marketPriceCents <= order.limitPriceCents;
    const shouldFillSell = order.side === 'SELL' && marketPriceCents >= order.limitPriceCents;

    if (!shouldFillBuy && !shouldFillSell) {
      continue;
    }

    const currency = order.currency as CurrencyCode;
    const executionPriceCents = marketPriceCents;
    const grossCents = order.quantity * executionPriceCents;
    const feeCents = calculateBrokerageFee(grossCents);
    const clearingAccount = await getOrCreateSystemAccount(tx, 'SYS-MARKET-CLEARING', currency);

    const [userChecking] = await tx
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, order.userId),
          eq(accounts.currency, currency),
          eq(accounts.accountType, 'CHECKING')
        )
      )
      .limit(1);

    if (!userChecking) continue;

    if (order.side === 'BUY') {
      // Originally locked: order.totalGrossCents + order.feeCents (at limitPriceCents)
      const originallyLockedCents = order.totalGrossCents + order.feeCents;
      const actualRequiredCents = grossCents + feeCents;

      // Release original lock first so postLedgerTransaction can cleanly debit actualRequiredCents
      await tx.execute(sql`
        UPDATE accounts
        SET locked_balance_cents = GREATEST(0, locked_balance_cents - ${originallyLockedCents})
        WHERE id = ${userChecking.id}::uuid
      `);

      const receipt = await postLedgerTransaction(tx, {
        category: 'STOCK_BUY',
        description: `Limit Order Filled: BUY ${order.quantity} ${order.symbol} @ ${(executionPriceCents / 100).toFixed(2)} ${currency}`,
        metadata: {
          orderId: order.id,
          symbol: order.symbol,
          quantity: order.quantity,
          executionPriceCents,
          feeCents,
        },
        postings: [
          {
            accountId: userChecking.id,
            direction: 'DEBIT',
            amountCents: actualRequiredCents,
            currency,
          },
          {
            accountId: clearingAccount.id,
            direction: 'CREDIT',
            amountCents: actualRequiredCents,
            currency,
          },
        ],
      });

      const [existingPos] = await tx
        .select()
        .from(portfolios)
        .where(and(eq(portfolios.userId, order.userId), eq(portfolios.symbol, order.symbol)))
        .limit(1);

      const nextPos = calculatePortfolioAfterBuy({
        currentQuantity: existingPos?.quantity ?? 0,
        currentAvgPriceCents: existingPos?.averagePriceCents ?? 0,
        buyQuantity: order.quantity,
        executionPriceCents,
        feeCents,
      });

      if (existingPos) {
        await tx
          .update(portfolios)
          .set({
            quantity: nextPos.newQuantity,
            averagePriceCents: nextPos.newAveragePriceCents,
            updatedAt: new Date(),
          })
          .where(eq(portfolios.id, existingPos.id));
      } else {
        await tx.insert(portfolios).values({
          userId: order.userId,
          symbol: order.symbol,
          quantity: nextPos.newQuantity,
          lockedQuantity: 0,
          averagePriceCents: nextPos.newAveragePriceCents,
          realizedPnlCents: 0,
        });
      }

      await tx
        .update(tradeOrders)
        .set({
          status: 'FILLED',
          executedPriceCents: executionPriceCents,
          totalGrossCents: grossCents,
          feeCents,
          ledgerTransactionId: receipt.transactionId,
          executedAt: new Date(),
        })
        .where(eq(tradeOrders.id, order.id));

      filledCount++;
    } else {
      // SELL Limit Order Fill
      const netProceedsCents = Math.max(1, grossCents - feeCents);

      const [existingPos] = await tx
        .select()
        .from(portfolios)
        .where(and(eq(portfolios.userId, order.userId), eq(portfolios.symbol, order.symbol)))
        .limit(1);

      if (!existingPos || existingPos.quantity < order.quantity) continue;

      const nextPos = calculatePortfolioAfterSell({
        currentQuantity: existingPos.quantity,
        currentAvgPriceCents: existingPos.averagePriceCents,
        currentRealizedPnlCents: existingPos.realizedPnlCents,
        sellQuantity: order.quantity,
        executionPriceCents,
        feeCents,
      });

      await tx
        .update(portfolios)
        .set({
          quantity: nextPos.newQuantity,
          lockedQuantity: Math.max(0, existingPos.lockedQuantity - order.quantity),
          averagePriceCents: nextPos.newAveragePriceCents,
          realizedPnlCents: nextPos.newTotalRealizedPnlCents,
          updatedAt: new Date(),
        })
        .where(eq(portfolios.id, existingPos.id));

      const receipt = await postLedgerTransaction(tx, {
        category: 'STOCK_SELL',
        description: `Limit Order Filled: SELL ${order.quantity} ${order.symbol} @ ${(executionPriceCents / 100).toFixed(2)} ${currency}`,
        metadata: {
          orderId: order.id,
          symbol: order.symbol,
          quantity: order.quantity,
          executionPriceCents,
          feeCents,
          realizedPnlCents: nextPos.tradeRealizedPnlCents,
        },
        postings: [
          {
            accountId: clearingAccount.id,
            direction: 'DEBIT',
            amountCents: netProceedsCents,
            currency,
          },
          {
            accountId: userChecking.id,
            direction: 'CREDIT',
            amountCents: netProceedsCents,
            currency,
          },
        ],
      });

      await tx
        .update(tradeOrders)
        .set({
          status: 'FILLED',
          executedPriceCents: executionPriceCents,
          totalGrossCents: grossCents,
          feeCents,
          ledgerTransactionId: receipt.transactionId,
          executedAt: new Date(),
        })
        .where(eq(tradeOrders.id, order.id));

      filledCount++;
    }
  }

  return filledCount;
}

type MarketListener = (payload: {
  assets: Array<typeof assets.$inferSelect>;
  fxPairs: ReturnType<typeof getAllFxPairs>;
  filledOrdersCount: number;
  timestamp: string;
}) => void;

const listeners = new Set<MarketListener>();
let tickerInterval: ReturnType<typeof setInterval> | null = null;

export function subscribeToMarketStream(listener: MarketListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Executes a single simulated market tick across all listed equities & FX rates,
 * and triggers automatic limit-order matching.
 */
export async function stepMarketSimulation(): Promise<{
  assets: Array<typeof assets.$inferSelect>;
  filledOrdersCount: number;
}> {
  let totalFilled = 0;

  const updatedAssets = await db.transaction(async (tx) => {
    const currentAssets = await tx.select().from(assets).orderBy(asc(assets.symbol));
    const results: Array<typeof assets.$inferSelect> = [];

    for (const asset of currentAssets) {
      // Bounded random walk step between -volatilityBps and +volatilityBps
      const randomSwing = (Math.random() - 0.495) * 2; // Slight upward drift
      const deltaBps = Math.round(randomSwing * (asset.volatilityBps / 3));
      const rawNext = Math.round(asset.currentPriceCents * (1 + deltaBps / 10000));
      const nextPriceCents = Math.max(100, rawNext);

      const highPriceCents = Math.max(asset.highPriceCents, nextPriceCents);
      const lowPriceCents = Math.min(asset.lowPriceCents, nextPriceCents);

      const [updated] = await tx
        .update(assets)
        .set({
          currentPriceCents: nextPriceCents,
          highPriceCents,
          lowPriceCents,
          updatedAt: new Date(),
        })
        .where(eq(assets.symbol, asset.symbol))
        .returning();

      if (updated) {
        results.push(updated);
        const filled = await matchOpenLimitOrdersForSymbol(tx, updated.symbol, nextPriceCents);
        totalFilled += filled;
      }
    }

    return results;
  });

  nudgeFxRates(Math.round((Math.random() - 0.5) * 20), Math.round((Math.random() - 0.5) * 20));

  const payload = {
    assets: updatedAssets,
    fxPairs: getAllFxPairs(),
    filledOrdersCount: totalFilled,
    timestamp: new Date().toISOString(),
  };

  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // Ignore individual disconnected client errors
    }
  }

  return { assets: updatedAssets, filledOrdersCount: totalFilled };
}

export function startMarketTicker(intervalMs: number): void {
  if (tickerInterval) return;
  tickerInterval = setInterval(() => {
    stepMarketSimulation().catch(() => {});
  }, intervalMs);
}

export function stopMarketTicker(): void {
  if (tickerInterval) {
    clearInterval(tickerInterval);
    tickerInterval = null;
  }
}
