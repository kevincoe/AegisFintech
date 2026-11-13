import type {
  CurrencyCode,
  OrderSide,
  OrderType,
  SavingsProductType,
} from '@aegis/shared';
import type { LedgerEntryItem } from './api/client.js';

export type ActiveSection = 'dashboard' | 'transfers' | 'savings' | 'fx' | 'trading';

export type SseConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'PAUSED' | 'RECONNECTING';

export interface ToastMessage {
  type: 'success' | 'error' | 'info';
  text: string;
}

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  documentNumber: string;
  accountNumber: string;
}

export interface CheckingAccount {
  id: string;
  accountNumber: string;
  currency: CurrencyCode;
  label: string;
  balanceCents: number;
  lockedBalanceCents: number;
  availableBalanceCents: number;
  balanceInBrlCents: number;
}

export interface NetWorthSummary {
  totalCheckingBrlCents: number;
  totalSavingsBrlCents: number;
  totalInvestmentsBrlCents: number;
  totalNetWorthBrlCents: number;
}

export interface StatementTx {
  id: string;
  idempotencyKey: string | null;
  category: string;
  description: string;
  createdAt: string;
  primaryImpact: {
    direction: 'DEBIT' | 'CREDIT';
    amountCents: number;
    currency: CurrencyCode;
    balanceAfterCents: number;
  };
  doubleEntryLegs: Array<LedgerEntryItem & { accountType: string }>;
}

export interface SavingsVaultItem {
  id: string;
  name: string;
  productType: SavingsProductType;
  currency: CurrencyCode;
  annualRateBps: number;
  cdiPercentage: number;
  principalCents: number;
  accruedYieldCents: number;
  totalBalanceCents: number;
  simulatedDaysElapsed: number;
}

export interface MarketAsset {
  symbol: string;
  name: string;
  sector: string;
  exchange: string;
  currency: CurrencyCode;
  currentPriceCents: number;
  openPriceCents: number;
  highPriceCents: number;
  lowPriceCents: number;
  changeCents: number;
  changePercent: number;
}

export interface FxPair {
  pair: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  commercialRate: number;
  spreadBps: number;
  iofBps: number;
}

export interface PortfolioHolding {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  currency: CurrencyCode;
  quantity: number;
  lockedQuantity: number;
  availableQuantity: number;
  averagePriceCents: number;
  currentPriceCents: number;
  marketValueCents: number;
  unrealizedPnlCents: number;
  unrealizedPnlPercent: number;
  realizedPnlCents: number;
}

export interface PortfolioOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPriceCents: number | null;
  executedPriceCents: number | null;
  totalGrossCents: number;
  feeCents: number;
  currency: CurrencyCode;
  status: 'OPEN' | 'FILLED' | 'CANCELLED';
  createdAt: string;
}
