import type { CurrencyCode } from '@aegis/shared';
import { AppError } from '../../core/errors.js';

export type LedgerDirection = 'DEBIT' | 'CREDIT';

export interface LedgerPostingInput {
  accountId: string;
  direction: LedgerDirection;
  amountCents: number;
  currency: CurrencyCode;
}

/**
 * DIDACTIC INVARIANT #1: Double-Entry Zero-Sum Law (ADR-002)
 * Every financial transaction must have at least one DEBIT and one CREDIT per currency,
 * and the sum of DEBITs must equal the sum of CREDITs for each currency involved.
 */
export function assertBalancedPostings(postings: readonly LedgerPostingInput[]): void {
  if (postings.length < 2) {
    throw new AppError(
      'LEDGER_IMBALANCE',
      'A double-entry transaction requires at least 2 postings (DEBIT and CREDIT).',
      400
    );
  }

  const totalsByCurrency = new Map<CurrencyCode, { debit: bigint; credit: bigint }>();

  for (const posting of postings) {
    if (!Number.isInteger(posting.amountCents) || posting.amountCents <= 0) {
      throw new AppError(
        'LEDGER_IMBALANCE',
        `Ledger posting amount must be a positive integer in cents (got ${posting.amountCents}).`,
        400
      );
    }

    const current = totalsByCurrency.get(posting.currency) ?? { debit: 0n, credit: 0n };
    const amount = BigInt(posting.amountCents);
    if (posting.direction === 'DEBIT') {
      current.debit += amount;
    } else {
      current.credit += amount;
    }
    totalsByCurrency.set(posting.currency, current);
  }

  for (const [currency, totals] of totalsByCurrency.entries()) {
    if (totals.debit !== totals.credit) {
      throw new AppError(
        'LEDGER_IMBALANCE',
        `Double-entry imbalance for currency ${currency}: DEBIT=${totals.debit.toString()} cents != CREDIT=${totals.credit.toString()} cents.`,
        400
      );
    }
  }
}

/**
 * DIDACTIC INVARIANT #2: Deterministic Lock Ordering (ADR-003)
 * Always sort unique account IDs in ascending lexicographical order before `SELECT ... FOR UPDATE`.
 * This guarantees that concurrent A->B and B->A transfers lock accounts in the exact same sequence,
 * eliminating circular wait conditions (AB-BA database deadlocks).
 */
export function sortAccountIdsForLocking(accountIds: readonly string[]): string[] {
  return [...new Set(accountIds)].sort((a, b) => a.localeCompare(b));
}

export interface FxConversionInput {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  sourceAmountCents: number;
  /**
   * Commercial exchange rate expressed as how many units of `toCurrency` equal 1.0000 unit of `fromCurrency`,
   * scaled by 10_000 (e.g., 1 USD = 5.8000 BRL -> 58000; 1 BRL = 0.1724 USD -> 1724).
   */
  rateScaled1e4: number;
  spreadBps: number; // e.g., 100 bps = 1.00%
  iofBps: number; // e.g., 110 bps = 1.10% IOF tax
}

export interface FxConversionQuote {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  sourceAmountCents: number;
  spreadFeeCents: number;
  iofTaxCents: number;
  netSourceConvertedCents: number;
  targetAmountCents: number;
  commercialRate: number;
  effectiveRate: number;
  spreadBps: number;
  iofBps: number;
}

/**
 * Pure FX conversion calculator using integer cents and basis points (10_000 bps = 100%).
 */
export function calculateFxConversion(input: FxConversionInput): FxConversionQuote {
  if (input.fromCurrency === input.toCurrency) {
    throw new AppError('VALIDATION_ERROR', 'Source and target currencies must differ', 400);
  }
  if (!Number.isInteger(input.sourceAmountCents) || input.sourceAmountCents <= 0) {
    throw new AppError('VALIDATION_ERROR', 'Source amount must be positive integer cents', 400);
  }

  const gross = BigInt(input.sourceAmountCents);
  const spreadFee = (gross * BigInt(input.spreadBps) + 5000n) / 10000n;
  const iofTax = (gross * BigInt(input.iofBps) + 5000n) / 10000n;
  const netSource = gross - spreadFee - iofTax;

  if (netSource <= 0n) {
    throw new AppError('VALIDATION_ERROR', 'Source amount is too small after spread and IOF', 400);
  }

  const targetAmount = (netSource * BigInt(input.rateScaled1e4)) / 10000n;
  if (targetAmount <= 0n) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Source amount is too small to yield at least 1 cent in target currency',
      400
    );
  }

  const commercialRate = input.rateScaled1e4 / 10000;
  const effectiveRate = Number(targetAmount) / input.sourceAmountCents;

  return {
    fromCurrency: input.fromCurrency,
    toCurrency: input.toCurrency,
    sourceAmountCents: input.sourceAmountCents,
    spreadFeeCents: Number(spreadFee),
    iofTaxCents: Number(iofTax),
    netSourceConvertedCents: Number(netSource),
    targetAmountCents: Number(targetAmount),
    commercialRate: Number(commercialRate.toFixed(4)),
    effectiveRate: Number(effectiveRate.toFixed(4)),
    spreadBps: input.spreadBps,
    iofBps: input.iofBps,
  };
}

/**
 * Computes compound interest over `businessDays` using the standard 252 business-days year convention:
 *   Final = Balance * (1 + annualRate)^(businessDays / 252)
 */
export function calculateCompoundYield(params: {
  balanceCents: number;
  annualRateBps: number;
  businessDays: number;
}): {
  grossYieldCents: number;
  estimatedTaxBps: number;
  newBalanceCents: number;
} {
  if (params.balanceCents <= 0 || params.businessDays <= 0 || params.annualRateBps <= 0) {
    return {
      grossYieldCents: 0,
      estimatedTaxBps: 2250,
      newBalanceCents: params.balanceCents,
    };
  }

  const annualRate = params.annualRateBps / 10000;
  const compoundFactor = Math.pow(1 + annualRate, params.businessDays / 252);
  const grossYieldCents = Math.max(
    1,
    Math.round(params.balanceCents * (compoundFactor - 1))
  );

  // Brazilian Fixed Income Regressive IR table (22.5% -> 20% -> 17.5% -> 15%)
  let estimatedTaxBps = 2250;
  if (params.businessDays > 504) estimatedTaxBps = 1500;
  else if (params.businessDays > 252) estimatedTaxBps = 1750;
  else if (params.businessDays > 126) estimatedTaxBps = 2000;

  return {
    grossYieldCents,
    estimatedTaxBps,
    newBalanceCents: params.balanceCents + grossYieldCents,
  };
}

/**
 * Computes brokerage fee in integer cents (e.g. 15 bps = 0.15% with a minimum of 1 cent).
 */
export function calculateBrokerageFee(grossAmountCents: number, feeBps = 15): number {
  if (grossAmountCents <= 0) return 0;
  return Math.max(1, Math.round((grossAmountCents * feeBps) / 10000));
}

/**
 * Computes new portfolio state after a BUY fill using Weighted Average Cost (Preço Médio).
 */
export function calculatePortfolioAfterBuy(params: {
  currentQuantity: number;
  currentAvgPriceCents: number;
  buyQuantity: number;
  executionPriceCents: number;
  feeCents: number;
}): {
  newQuantity: number;
  newAveragePriceCents: number;
} {
  const existingCost =
    BigInt(params.currentQuantity) * BigInt(params.currentAvgPriceCents);
  const newPurchaseCost =
    BigInt(params.buyQuantity) * BigInt(params.executionPriceCents) + BigInt(params.feeCents);
  const totalQuantity = params.currentQuantity + params.buyQuantity;
  const newAvg = (existingCost + newPurchaseCost) / BigInt(totalQuantity);

  return {
    newQuantity: totalQuantity,
    newAveragePriceCents: Number(newAvg),
  };
}

/**
 * Computes new portfolio state and Realized P&L after a SELL fill.
 * Note: Selling shares does NOT change the weighted average cost of remaining shares!
 */
export function calculatePortfolioAfterSell(params: {
  currentQuantity: number;
  currentAvgPriceCents: number;
  currentRealizedPnlCents: number;
  sellQuantity: number;
  executionPriceCents: number;
  feeCents: number;
}): {
  newQuantity: number;
  newAveragePriceCents: number;
  tradeRealizedPnlCents: number;
  newTotalRealizedPnlCents: number;
} {
  if (params.sellQuantity > params.currentQuantity) {
    throw new AppError(
      'INSUFFICIENT_SHARES',
      `Cannot sell ${params.sellQuantity} shares when only ${params.currentQuantity} are available.`,
      400
    );
  }

  const grossProceeds = BigInt(params.sellQuantity) * BigInt(params.executionPriceCents);
  const costBasis = BigInt(params.sellQuantity) * BigInt(params.currentAvgPriceCents);
  const tradePnl = Number(grossProceeds - costBasis - BigInt(params.feeCents));
  const remainingQty = params.currentQuantity - params.sellQuantity;

  return {
    newQuantity: remainingQty,
    newAveragePriceCents: remainingQty === 0 ? 0 : params.currentAvgPriceCents,
    tradeRealizedPnlCents: tradePnl,
    newTotalRealizedPnlCents: params.currentRealizedPnlCents + tradePnl,
  };
}
