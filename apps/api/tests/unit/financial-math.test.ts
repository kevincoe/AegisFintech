import { describe, expect, it } from 'vitest';
import { parseDecimalToCents, formatBps } from '@aegis/shared';
import {
  assertBalancedPostings,
  calculateBrokerageFee,
  calculateCompoundYield,
  calculateFxConversion,
  calculatePortfolioAfterBuy,
  calculatePortfolioAfterSell,
  sortAccountIdsForLocking,
} from '../../src/domain/money/financial-math.js';

describe('Financial Math & Domain Invariants (Unit)', () => {
  describe('Integer Cents Parsing & Basis Points', () => {
    it('parses human decimal strings into exact integer cents without IEEE 754 drift', () => {
      // Famous floating point trap: 19.99 * 100 in float is 1998.9999999999998
      expect(parseDecimalToCents('19.99')).toBe(1999);
      expect(parseDecimalToCents('0.10') + parseDecimalToCents('0.20')).toBe(30);
      expect(parseDecimalToCents('1250,50')).toBe(125050);
      expect(parseDecimalToCents('1,250.75')).toBe(125075);
      expect(parseDecimalToCents('100')).toBe(10000);
      expect(formatBps(1125)).toBe('11.25%');
    });
  });

  describe('Double-Entry Zero-Sum Invariant (assertBalancedPostings)', () => {
    it('accepts balanced single-currency and multi-currency (FX 4-leg) postings', () => {
      expect(() =>
        assertBalancedPostings([
          { accountId: 'acc-1', direction: 'DEBIT', amountCents: 50000, currency: 'BRL' },
          { accountId: 'acc-2', direction: 'CREDIT', amountCents: 50000, currency: 'BRL' },
        ])
      ).not.toThrow();

      // 4-leg FX transaction where BRL sums to 0 and USD sums to 0 independently
      expect(() =>
        assertBalancedPostings([
          { accountId: 'user-brl', direction: 'DEBIT', amountCents: 58000, currency: 'BRL' },
          { accountId: 'pool-brl', direction: 'CREDIT', amountCents: 58000, currency: 'BRL' },
          { accountId: 'pool-usd', direction: 'DEBIT', amountCents: 9790, currency: 'USD' },
          { accountId: 'user-usd', direction: 'CREDIT', amountCents: 9790, currency: 'USD' },
        ])
      ).not.toThrow();
    });

    it('rejects imbalanced postings or non-positive amounts', () => {
      expect(() =>
        assertBalancedPostings([
          { accountId: 'acc-1', direction: 'DEBIT', amountCents: 50000, currency: 'BRL' },
          { accountId: 'acc-2', direction: 'CREDIT', amountCents: 49999, currency: 'BRL' },
        ])
      ).toThrow(/Double-entry imbalance/);

      expect(() =>
        assertBalancedPostings([
          { accountId: 'acc-1', direction: 'DEBIT', amountCents: 0, currency: 'BRL' },
          { accountId: 'acc-2', direction: 'CREDIT', amountCents: 0, currency: 'BRL' },
        ])
      ).toThrow(/positive integer/);
    });
  });

  describe('Deadlock Prevention Lock Ordering (sortAccountIdsForLocking)', () => {
    it('sorts account IDs deterministically regardless of transfer direction', () => {
      const orderAtoB = sortAccountIdsForLocking(['uuid-z-bob', 'uuid-a-alice']);
      const orderBtoA = sortAccountIdsForLocking(['uuid-a-alice', 'uuid-z-bob']);
      expect(orderAtoB).toEqual(['uuid-a-alice', 'uuid-z-bob']);
      expect(orderBtoA).toEqual(['uuid-a-alice', 'uuid-z-bob']);
    });
  });

  describe('FX Conversion with Spread & IOF (calculateFxConversion)', () => {
    it('calculates spread fee, IOF tax, and target currency cents accurately', () => {
      // Convert US$ 100.00 (10_000 cents) to BRL at 1 USD = 5.8000 BRL (rateScaled1e4 = 58000)
      // Spread = 100 bps (1.00% = $1.00), IOF = 110 bps (1.10% = $1.10) -> Net USD = $97.90 (9790 cents)
      // Target BRL = 9790 * 5.80 = 56782 cents (R$ 567,82)
      const quote = calculateFxConversion({
        fromCurrency: 'USD',
        toCurrency: 'BRL',
        sourceAmountCents: 10_000,
        rateScaled1e4: 58_000,
        spreadBps: 100,
        iofBps: 110,
      });

      expect(quote.spreadFeeCents).toBe(100);
      expect(quote.iofTaxCents).toBe(110);
      expect(quote.netSourceConvertedCents).toBe(9790);
      expect(quote.targetAmountCents).toBe(56782);
    });
  });

  describe('Savings Compound Interest (calculateCompoundYield)', () => {
    it('calculates exact annual yield over 252 business days and regressive tax brackets', () => {
      // R$ 10.000,00 (1_000_000 cents) at 13.50% p.a. (1350 bps) for 252 business days (1 full year)
      const result = calculateCompoundYield({
        balanceCents: 1_000_000,
        annualRateBps: 1350,
        businessDays: 252,
      });

      expect(result.grossYieldCents).toBe(135_000); // R$ 1.350,00
      expect(result.newBalanceCents).toBe(1_135_000);
      expect(result.estimatedTaxBps).toBe(2000); // 181-360 days bracket = 20%
    });
  });

  describe('Stock Portfolio Weighted Average Price & Realized P&L', () => {
    it('calculates weighted average price on consecutive buys and realized P&L on partial sells', () => {
      // 1st Buy: 100 shares @ R$ 30,00 (3000 cents), fee = R$ 4,50 (450 cents)
      // Total cost = 300_000 + 450 = 300_450 -> Avg price = 3004 cents
      const pos1 = calculatePortfolioAfterBuy({
        currentQuantity: 0,
        currentAvgPriceCents: 0,
        buyQuantity: 100,
        executionPriceCents: 3000,
        feeCents: calculateBrokerageFee(300_000),
      });
      expect(pos1.newQuantity).toBe(100);
      expect(pos1.newAveragePriceCents).toBe(3004);

      // 2nd Buy: 100 shares @ R$ 40,00 (4000 cents), fee = R$ 6,00 (600 cents)
      // Existing cost = 100 * 3004 = 300_400; New purchase = 400_600 -> Total = 701_000 / 200 = 3505 cents
      const pos2 = calculatePortfolioAfterBuy({
        currentQuantity: pos1.newQuantity,
        currentAvgPriceCents: pos1.newAveragePriceCents,
        buyQuantity: 100,
        executionPriceCents: 4000,
        feeCents: calculateBrokerageFee(400_000),
      });
      expect(pos2.newQuantity).toBe(200);
      expect(pos2.newAveragePriceCents).toBe(3505);

      // Partial Sell: Sell 50 shares @ R$ 45,00 (4500 cents), fee = 338 cents
      // Average price of remaining 150 shares MUST stay 3505 cents!
      // Gross proceeds = 225_000; Cost basis = 50 * 3505 = 175_250; Net P&L = 225_000 - 175_250 - 338 = +49_412 cents
      const pos3 = calculatePortfolioAfterSell({
        currentQuantity: pos2.newQuantity,
        currentAvgPriceCents: pos2.newAveragePriceCents,
        currentRealizedPnlCents: 0,
        sellQuantity: 50,
        executionPriceCents: 4500,
        feeCents: calculateBrokerageFee(225_000),
      });
      expect(pos3.newQuantity).toBe(150);
      expect(pos3.newAveragePriceCents).toBe(3505);
      expect(pos3.tradeRealizedPnlCents).toBe(49_412);
    });
  });
});
