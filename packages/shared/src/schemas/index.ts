import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../money.js';

export const CurrencySchema = z.enum(SUPPORTED_CURRENCIES);

export const PositiveCentsSchema = z
  .number()
  .int('Amount must be in integer cents')
  .positive('Amount must be greater than zero')
  .max(10_000_000_000, 'Amount exceeds maximum single transaction limit');

// ============================================================================
// 1. Auth Schemas
// ============================================================================
export const RegisterInputSchema = z.object({
  name: z.string().trim().min(2, 'Name must have at least 2 characters').max(100),
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  documentNumber: z
    .string()
    .trim()
    .regex(/^\d{11,14}$/, 'Document number (CPF/CNPJ) must be 11 to 14 digits'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

// ============================================================================
// 2. Transfers & Bill Payment Schemas
// ============================================================================
export const P2PTransferInputSchema = z.object({
  recipientIdentifier: z
    .string()
    .trim()
    .min(3, 'Enter recipient email or account number (e.g., bob@aegis.bank or 1002-1)'),
  currency: CurrencySchema.default('BRL'),
  amountCents: PositiveCentsSchema,
  description: z.string().trim().max(140).optional().default('Pix / P2P Transfer'),
});
export type P2PTransferInput = z.infer<typeof P2PTransferInputSchema>;

export const BillPaymentInputSchema = z.object({
  barcode: z
    .string()
    .trim()
    .regex(/^\d{10,48}$/, 'Barcode must contain between 10 and 48 numeric digits'),
  billerName: z.string().trim().min(2).max(100),
  currency: CurrencySchema.default('BRL'),
  amountCents: PositiveCentsSchema,
});
export type BillPaymentInput = z.infer<typeof BillPaymentInputSchema>;

// ============================================================================
// 3. Savings & Fixed-Income (CDB / Yield Vaults) Schemas
// ============================================================================
export const SAVINGS_PRODUCTS = [
  'EMERGENCY_VAULT_100_CDI',
  'CDB_LIQUIDEZ_110_CDI',
  'CDB_PLUS_120_CDI',
] as const;
export type SavingsProductType = (typeof SAVINGS_PRODUCTS)[number];

export const CreateSavingsVaultInputSchema = z.object({
  name: z.string().trim().min(2, 'Vault name is required').max(60),
  productType: z.enum(SAVINGS_PRODUCTS),
  currency: CurrencySchema.default('BRL'),
  initialDepositCents: z.number().int().min(0).default(0),
});
export type CreateSavingsVaultInput = z.infer<typeof CreateSavingsVaultInputSchema>;

export const SavingsVaultMoveInputSchema = z.object({
  amountCents: PositiveCentsSchema,
});
export type SavingsVaultMoveInput = z.infer<typeof SavingsVaultMoveInputSchema>;

export const SimulateYieldInputSchema = z.object({
  businessDays: z
    .number()
    .int()
    .min(1, 'Must simulate at least 1 business day')
    .max(1260, 'Maximum 5 years (1260 business days) per simulation step'),
});
export type SimulateYieldInput = z.infer<typeof SimulateYieldInputSchema>;

// ============================================================================
// 4. FX Currency Exchange Schemas
// ============================================================================
export const FxQuoteQuerySchema = z
  .object({
    fromCurrency: CurrencySchema,
    toCurrency: CurrencySchema,
    sourceAmountCents: PositiveCentsSchema,
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, {
    message: 'Source and target currencies must be different',
    path: ['toCurrency'],
  });
export type FxQuoteQuery = z.infer<typeof FxQuoteQuerySchema>;

export const FxExchangeInputSchema = FxQuoteQuerySchema;
export type FxExchangeInput = z.infer<typeof FxExchangeInputSchema>;

// ============================================================================
// 5. Stock Market & Trading Order Schemas
// ============================================================================
export const ORDER_SIDES = ['BUY', 'SELL'] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export const ORDER_TYPES = ['MARKET', 'LIMIT'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const PlaceOrderInputSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,10}$/, 'Invalid ticker symbol'),
    side: z.enum(ORDER_SIDES),
    orderType: z.enum(ORDER_TYPES),
    quantity: z.number().int().min(1, 'Minimum 1 share').max(1_000_000),
    limitPriceCents: z.number().int().positive().optional(),
    hasClientAttestation: z.boolean().optional().default(false),
    attestationText: z.string().trim().max(500).optional(),
  })
  .refine(
    (data) => {
      if (data.orderType === 'LIMIT') {
        return typeof data.limitPriceCents === 'number' && data.limitPriceCents > 0;
      }
      return true;
    },
    {
      message: 'limitPriceCents is required for LIMIT orders',
      path: ['limitPriceCents'],
    }
  );
export type PlaceOrderInput = z.infer<typeof PlaceOrderInputSchema>;

// ============================================================================
// 6. CRM, Investor Suitability & Pre-Trade Compliance Schemas
// ============================================================================
export const KYC_TIERS = [
  'TIER_0_UNVERIFIED',
  'TIER_1_SIMPLIFIED',
  'TIER_2_STANDARD',
  'TIER_3_ENHANCED',
] as const;
export type KycTier = (typeof KYC_TIERS)[number];

export const SUITABILITY_RISK_TIERS = [
  'CONSERVATIVE',
  'MODERATE',
  'BALANCED_GROWTH',
  'AGGRESSIVE_SPECULATIVE',
] as const;
export type SuitabilityRiskTier = (typeof SUITABILITY_RISK_TIERS)[number];

export const UpdateKycProfileInputSchema = z.object({
  tier: z.enum(KYC_TIERS),
  isPep: z.boolean().default(false),
  pepCategory: z
    .enum(['HEAD_OF_STATE', 'SENIOR_GOV', 'JUDICIAL_MILITARY', 'FAMILY_MEMBER', 'CLOSE_ASSOCIATE'])
    .optional()
    .nullable(),
  pepDescription: z.string().trim().max(240).optional().nullable(),
});
export type UpdateKycProfileInput = z.infer<typeof UpdateKycProfileInputSchema>;

export const UpdateSuitabilityInputSchema = z.object({
  investmentObjective: z.enum([
    'CAPITAL_PRESERVATION',
    'INCOME_GENERATION',
    'BALANCED_GROWTH',
    'AGGRESSIVE_SPECULATION',
  ]),
  horizonMonths: z.number().int().min(1).max(360),
  liquidityNeed: z.enum(['HIGH_IMMEDIATE', 'MEDIUM_6_TO_12M', 'LOW_LONG_TERM']),
  experienceLevel: z.enum(['NONE', 'BASIC_FIXED_INCOME', 'EQUITIES_AND_ETFS', 'DERIVATIVES_PRO']),
  maxDrawdownTolerancePct: z.number().int().min(0).max(100),
});
export type UpdateSuitabilityInput = z.infer<typeof UpdateSuitabilityInputSchema>;

export const INTERACTION_CHANNELS = ['PHONE', 'VIDEO', 'IN_PERSON', 'CHAT', 'EMAIL'] as const;
export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number];

export const CONFIDENTIALITY_LEVELS = ['STANDARD', 'CONFIDENTIAL', 'RESTRICTED_MNPI'] as const;
export type ConfidentialityLevel = (typeof CONFIDENTIALITY_LEVELS)[number];

export const CreateInteractionLogInputSchema = z.object({
  channel: z.enum(INTERACTION_CHANNELS),
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(160),
  notes: z.string().trim().min(5, 'Detailed notes are required').max(2000),
  redactedNotes: z.string().trim().max(2000).optional(),
  confidentialityLevel: z.enum(CONFIDENTIALITY_LEVELS).default('STANDARD'),
});
export type CreateInteractionLogInput = z.infer<typeof CreateInteractionLogInputSchema>;

export const LIFE_EVENT_TYPES = [
  'MARRIAGE',
  'DIVORCE',
  'CHILD_BIRTH',
  'HOME_PURCHASE',
  'CAREER_CHANGE',
  'RETIREMENT',
  'INHERITANCE',
] as const;
export type LifeEventType = (typeof LIFE_EVENT_TYPES)[number];

export const CreateLifeEventInputSchema = z.object({
  eventType: z.enum(LIFE_EVENT_TYPES),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional(),
  eventDate: z.string().trim().min(4),
  financialImpactCents: z.number().int().min(0).max(10_000_000_000).default(0),
  requiresSuitabilityReview: z.boolean().default(false),
});
export type CreateLifeEventInput = z.infer<typeof CreateLifeEventInputSchema>;

export const RESTRICTION_TYPES = [
  'RESTRICTED_ALL',
  'RESTRICTED_BUY_ONLY',
  'RESTRICTED_SELL_ONLY',
  'WATCH_LIST_ONLY',
] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

export const RESTRICTION_REASONS = [
  'MNPI_INSIDER',
  'M_AND_A_ADVISORY',
  'UNDERWRITING_BLACKOUT',
  'SANCTION_REGULATORY',
] as const;
export type RestrictionReason = (typeof RESTRICTION_REASONS)[number];

export const UpsertRestrictedSecurityInputSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,10}$/, 'Invalid ticker symbol'),
  restrictionType: z.enum(RESTRICTION_TYPES).default('RESTRICTED_ALL'),
  reason: z.enum(RESTRICTION_REASONS).default('M_AND_A_ADVISORY'),
  notes: z.string().trim().max(300).optional(),
  isActive: z.boolean(),
});
export type UpsertRestrictedSecurityInput = z.infer<typeof UpsertRestrictedSecurityInputSchema>;

export const ResolveComplianceOverrideInputSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rationale: z
    .string()
    .trim()
    .min(5, 'Supervisory rationale must be at least 5 characters')
    .max(500),
});
export type ResolveComplianceOverrideInput = z.infer<typeof ResolveComplianceOverrideInputSchema>;
