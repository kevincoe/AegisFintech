/**
 * @aegis/shared — Integer Minor-Unit Monetary Primitives
 *
 * DIDACTIC NOTE (ADR-002):
 * Why do we store and transmit money as integer cents (e.g., R$ 150,25 -> 15025)?
 * Because IEEE 754 floating-point numbers cannot represent base-10 decimals like 0.1 or 0.01
 * accurately in binary (`0.1 + 0.2 === 0.30000000000000004`).
 * By working strictly in integer minor units (cents), addition and subtraction are 100% exact.
 */

export const SUPPORTED_CURRENCIES = ['BRL', 'USD', 'EUR'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export interface CurrencyMetadata {
  code: CurrencyCode;
  symbol: string;
  name: string;
  locale: string;
  flag: string;
}

export const CURRENCY_META: Record<CurrencyCode, CurrencyMetadata> = {
  BRL: {
    code: 'BRL',
    symbol: 'R$',
    name: 'Brazilian Real',
    locale: 'pt-BR',
    flag: '🇧🇷',
  },
  USD: {
    code: 'USD',
    symbol: 'US$',
    name: 'US Dollar',
    locale: 'en-US',
    flag: '🇺🇸',
  },
  EUR: {
    code: 'EUR',
    symbol: '€',
    name: 'Euro',
    locale: 'de-DE',
    flag: '🇪🇺',
  },
};

/**
 * Formats integer cents (e.g., 125050) into a localized currency string (e.g., "R$ 1.250,50").
 */
export function formatCents(cents: number | bigint, currency: CurrencyCode = 'BRL'): string {
  const numericCents = typeof cents === 'bigint' ? Number(cents) : cents;
  const meta = CURRENCY_META[currency];
  return new Intl.NumberFormat(meta.locale, {
    style: 'currency',
    currency: meta.code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericCents / 100);
}

/**
 * Safely parses a human decimal input string (e.g., "150.25" or "150,25") into exact integer cents (15025).
 * Avoids `Math.round(parseFloat(str) * 100)` precision traps by parsing integer and fractional parts directly.
 */
export function parseDecimalToCents(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error('Invalid numeric amount');
    }
    return Math.round(input * 100);
  }

  const trimmed = input.trim().replace(/\s/g, '');
  if (!trimmed) {
    throw new Error('Amount cannot be empty');
  }

  // Normalize comma decimal separator if needed (e.g. "1250,50" -> "1250.50")
  const normalized =
    trimmed.includes(',') && !trimmed.includes('.')
      ? trimmed.replace(',', '.')
      : trimmed.replace(/,/g, '');

  const match = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(normalized);
  if (!match) {
    throw new Error(`Invalid monetary format: "${input}"`);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const wholeUnits = parseInt(match[2] ?? '0', 10);
  const rawFraction = (match[3] ?? '').padEnd(2, '0');
  const fractionCents = parseInt(rawFraction, 10);

  return sign * (wholeUnits * 100 + fractionCents);
}

/**
 * Formats basis points (100 bps = 1.00%) into a human-readable percentage string.
 */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
