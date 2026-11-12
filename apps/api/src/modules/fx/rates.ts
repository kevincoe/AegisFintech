import type { CurrencyCode } from '@aegis/shared';

/**
 * Base mid-market commercial FX rates against BRL (`1 unit of currency = X BRL`).
 * In our live market simulator, these fluctuate slightly alongside stock ticks while
 * maintaining deterministic defaults for reproducible testing.
 */
const stateRatesInBrl: Record<CurrencyCode, number> = {
  BRL: 1.0,
  USD: 5.8, // 1 USD = 5.8000 BRL
  EUR: 6.25, // 1 EUR = 6.2500 BRL
};

export const FX_SPREAD_BPS = 100; // 1.00% FX Desk Spread
export const FX_IOF_BPS = 110; // 1.10% IOF Tax

export function getMidMarketRate(from: CurrencyCode, to: CurrencyCode): number {
  if (from === to) return 1.0;
  const fromInBrl = stateRatesInBrl[from];
  const toInBrl = stateRatesInBrl[to];
  return fromInBrl / toInBrl;
}

/**
 * Returns the commercial exchange rate scaled by 10_000 (integer) for `calculateFxConversion`.
 */
export function getFxRateScaled1e4(from: CurrencyCode, to: CurrencyCode): number {
  return Math.round(getMidMarketRate(from, to) * 10000);
}

export function nudgeFxRates(deltaUsdBps: number, deltaEurBps: number): void {
  stateRatesInBrl.USD = Number(
    Math.max(4.5, Math.min(7.5, stateRatesInBrl.USD * (1 + deltaUsdBps / 10000))).toFixed(4)
  );
  stateRatesInBrl.EUR = Number(
    Math.max(5.0, Math.min(8.5, stateRatesInBrl.EUR * (1 + deltaEurBps / 10000))).toFixed(4)
  );
}

export function resetFxRatesToDefault(): void {
  stateRatesInBrl.BRL = 1.0;
  stateRatesInBrl.USD = 5.8;
  stateRatesInBrl.EUR = 6.25;
}

export function getAllFxPairs() {
  const pairs: Array<{
    pair: string;
    fromCurrency: CurrencyCode;
    toCurrency: CurrencyCode;
    commercialRate: number;
    spreadBps: number;
    iofBps: number;
  }> = [
    {
      pair: 'USD/BRL',
      fromCurrency: 'USD',
      toCurrency: 'BRL',
      commercialRate: Number(getMidMarketRate('USD', 'BRL').toFixed(4)),
      spreadBps: FX_SPREAD_BPS,
      iofBps: FX_IOF_BPS,
    },
    {
      pair: 'BRL/USD',
      fromCurrency: 'BRL',
      toCurrency: 'USD',
      commercialRate: Number(getMidMarketRate('BRL', 'USD').toFixed(4)),
      spreadBps: FX_SPREAD_BPS,
      iofBps: FX_IOF_BPS,
    },
    {
      pair: 'EUR/BRL',
      fromCurrency: 'EUR',
      toCurrency: 'BRL',
      commercialRate: Number(getMidMarketRate('EUR', 'BRL').toFixed(4)),
      spreadBps: FX_SPREAD_BPS,
      iofBps: FX_IOF_BPS,
    },
    {
      pair: 'BRL/EUR',
      fromCurrency: 'BRL',
      toCurrency: 'EUR',
      commercialRate: Number(getMidMarketRate('BRL', 'EUR').toFixed(4)),
      spreadBps: FX_SPREAD_BPS,
      iofBps: FX_IOF_BPS,
    },
    {
      pair: 'EUR/USD',
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      commercialRate: Number(getMidMarketRate('EUR', 'USD').toFixed(4)),
      spreadBps: FX_SPREAD_BPS,
      iofBps: FX_IOF_BPS,
    },
    {
      pair: 'USD/EUR',
      fromCurrency: 'USD',
      toCurrency: 'EUR',
      commercialRate: Number(getMidMarketRate('USD', 'EUR').toFixed(4)),
      spreadBps: FX_SPREAD_BPS,
      iofBps: FX_IOF_BPS,
    },
  ];
  return pairs;
}
