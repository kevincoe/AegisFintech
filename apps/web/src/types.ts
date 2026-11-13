import type {
  ConfidentialityLevel,
  CurrencyCode,
  InteractionChannel,
  KycTier,
  LifeEventType,
  OrderSide,
  OrderType,
  RestrictionReason,
  RestrictionType,
  SavingsProductType,
  SuitabilityRiskTier,
  UpdateSuitabilityInput,
} from '@aegis/shared';
import type { LedgerEntryItem } from './api/client.js';

export type ActiveSection = 'dashboard' | 'transfers' | 'savings' | 'fx' | 'trading' | 'crm';

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
  volatilityBps?: number;
  changeCents: number;
  changePercent: number;
  isRestricted?: boolean;
  restrictionType?: string | null;
  restrictionReason?: string | null;
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
  status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'PENDING_COMPLIANCE_APPROVAL';
  createdAt: string;
}

export interface KycProfileItem {
  id: string;
  userId: string;
  tier: KycTier;
  status: string;
  isPep: boolean;
  pepCategory: string | null;
  pepDescription: string | null;
  dailyTransferLimitCents: number;
  lastVerifiedAt: string;
  nextReviewDueAt: string;
}

export interface SuitabilityProfileItem {
  id: string;
  userId: string;
  riskTier: SuitabilityRiskTier;
  score: number;
  horizonMonths: number;
  maxStockConcentrationBps: number;
  maxSingleTradeCents: number;
  questionnaireAnswers: UpdateSuitabilityInput;
  assessedAt: string;
  expiresAt: string;
}

export interface HouseholdOverview {
  id: string;
  name: string;
  taxIdentifier: string | null;
  notes: string | null;
  consolidatedCashCents: number;
  consolidatedLockedCashCents: number;
  consolidatedEquityCents: number;
  consolidatedNetWorthCents: number;
  members: Array<{
    userId: string;
    name: string;
    email: string;
    role: string;
    isDecisionMaker: boolean;
    includeInRollup: boolean;
  }>;
  partyRelationships: Array<{
    id: string;
    sourceUserName: string;
    targetUserName: string;
    relationshipType: string;
    reciprocalType: string;
    ownershipPercentageBps: number;
    isUbo: boolean;
  }>;
}

export interface AccountRoleItem {
  id: string;
  accountId: string;
  accountNumber: string;
  currency: CurrencyCode;
  accountLabel: string;
  userName: string;
  roleType: string;
  canTrade: boolean;
  canWithdraw: boolean;
}

export interface InteractionLogItem {
  id: string;
  channel: InteractionChannel;
  subject: string;
  notes: string;
  redactedNotes: string | null;
  confidentialityLevel: ConfidentialityLevel;
  advisorName: string;
  createdAt: string;
}

export interface LifeEventItem {
  id: string;
  eventType: LifeEventType;
  title: string;
  description: string | null;
  eventDate: string;
  financialImpactCents: number;
  requiresSuitabilityReview: boolean;
  createdAt: string;
}

export interface RestrictedSecurityItem {
  id: string;
  symbol: string;
  restrictionType: RestrictionType;
  reason: RestrictionReason;
  notes: string | null;
  effectiveFrom: string;
  effectiveTo: string;
  isActive: boolean;
  createdAt: string;
}

export interface ComplianceOverrideItem {
  id: string;
  orderId: string;
  userId: string;
  clientName: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPriceCents: number | null;
  totalGrossCents: number;
  feeCents: number;
  currency: CurrencyCode;
  orderStatus: string;
  overrideType: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  riskViolationReason: string;
  clientAttestationText: string | null;
  reviewerRationale: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ComplianceAuditLogItem {
  id: string;
  eventType: string;
  userId: string | null;
  operatorId: string | null;
  ruleEvaluated: string;
  decision: 'ALLOW' | 'BLOCK' | 'PENDING';
  payloadSnapshot: Record<string, unknown>;
  recordHash: string;
  createdAt: string;
}

export interface CrmOverviewResponse {
  kycProfile: KycProfileItem;
  suitabilityProfile: SuitabilityProfileItem;
  household: HouseholdOverview | null;
  accountRoles: AccountRoleItem[];
  interactions: InteractionLogItem[];
  lifeEvents: LifeEventItem[];
  restrictedSecurities: RestrictedSecurityItem[];
  complianceOverrides: ComplianceOverrideItem[];
  complianceAuditLogs: ComplianceAuditLogItem[];
}
