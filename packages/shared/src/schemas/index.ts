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
