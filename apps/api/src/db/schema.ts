import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// 1. Users
// ============================================================================
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 160 }).notNull(),
    documentNumber: varchar('document_number', { length: 20 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_email_idx').on(table.email),
    uniqueIndex('users_document_idx').on(table.documentNumber),
  ]
);

// ============================================================================
// 2. Accounts (Multi-Currency Checking, Savings Vault Backing & System Liquidity)
// ============================================================================
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    accountNumber: varchar('account_number', { length: 32 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(), // 'BRL' | 'USD' | 'EUR'
    accountType: varchar('account_type', { length: 24 }).notNull(), // 'CHECKING' | 'SAVINGS_VAULT' | 'SYSTEM'
    label: varchar('label', { length: 80 }).notNull(),
    balanceCents: bigint('balance_cents', { mode: 'number' }).notNull().default(0),
    lockedBalanceCents: bigint('locked_balance_cents', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('accounts_number_currency_idx').on(table.accountNumber, table.currency),
    index('accounts_user_id_idx').on(table.userId),
  ]
);

// ============================================================================
// 3. Immutable Double-Entry Ledger Transactions & Entries
// ============================================================================
export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    category: varchar('category', { length: 32 }).notNull(),
    // 'WELCOME_BONUS' | 'TRANSFER' | 'BILL_PAYMENT' | 'SAVINGS_DEPOSIT' | 'SAVINGS_REDEEM' | 'SAVINGS_YIELD' | 'FX_EXCHANGE' | 'STOCK_BUY' | 'STOCK_SELL'
    description: varchar('description', { length: 240 }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('ledger_tx_created_at_idx').on(table.createdAt)]
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    direction: varchar('direction', { length: 6 }).notNull(), // 'DEBIT' | 'CREDIT'
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(), // strictly > 0
    currency: varchar('currency', { length: 3 }).notNull(),
    balanceAfterCents: bigint('balance_after_cents', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ledger_entries_account_idx').on(table.accountId, table.createdAt),
    index('ledger_entries_tx_idx').on(table.transactionId),
  ]
);

// ============================================================================
// 4. Idempotency Records (Safe Retries at Financial Boundaries)
// ============================================================================
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    endpoint: varchar('endpoint', { length: 120 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    statusCode: integer('status_code').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_user_key_idx').on(table.userId, table.idempotencyKey, table.endpoint),
  ]
);

// ============================================================================
// 5. Savings Vaults & Fixed-Income Positions (Caixinhas & CDBs)
// ============================================================================
export const savingsVaults = pgTable(
  'savings_vaults',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    backingAccountId: uuid('backing_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 80 }).notNull(),
    productType: varchar('product_type', { length: 40 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    annualRateBps: integer('annual_rate_bps').notNull(), // e.g. 1125 = 11.25% p.a.
    cdiPercentage: integer('cdi_percentage').notNull(), // e.g. 100, 110, 120 (% of CDI)
    principalCents: bigint('principal_cents', { mode: 'number' }).notNull().default(0),
    accruedYieldCents: bigint('accrued_yield_cents', { mode: 'number' }).notNull().default(0),
    simulatedDaysElapsed: integer('simulated_days_elapsed').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('savings_vaults_user_idx').on(table.userId)]
);

// ============================================================================
// 6. Stock Market Assets, User Portfolios & Trade Orders
// ============================================================================
export const assets = pgTable('assets', {
  symbol: varchar('symbol', { length: 12 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  sector: varchar('sector', { length: 60 }).notNull(),
  exchange: varchar('exchange', { length: 16 }).notNull(), // 'B3' | 'NASDAQ'
  currency: varchar('currency', { length: 3 }).notNull(), // 'BRL' | 'USD'
  currentPriceCents: bigint('current_price_cents', { mode: 'number' }).notNull(),
  openPriceCents: bigint('open_price_cents', { mode: 'number' }).notNull(),
  highPriceCents: bigint('high_price_cents', { mode: 'number' }).notNull(),
  lowPriceCents: bigint('low_price_cents', { mode: 'number' }).notNull(),
  volatilityBps: integer('volatility_bps').notNull().default(120),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 12 })
      .notNull()
      .references(() => assets.symbol, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull().default(0),
    lockedQuantity: integer('locked_quantity').notNull().default(0),
    averagePriceCents: bigint('average_price_cents', { mode: 'number' }).notNull().default(0),
    realizedPnlCents: bigint('realized_pnl_cents', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('portfolios_user_symbol_idx').on(table.userId, table.symbol)]
);

export const tradeOrders = pgTable(
  'trade_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 12 })
      .notNull()
      .references(() => assets.symbol, { onDelete: 'restrict' }),
    side: varchar('side', { length: 4 }).notNull(), // 'BUY' | 'SELL'
    orderType: varchar('order_type', { length: 8 }).notNull(), // 'MARKET' | 'LIMIT'
    quantity: integer('quantity').notNull(),
    limitPriceCents: bigint('limit_price_cents', { mode: 'number' }),
    executedPriceCents: bigint('executed_price_cents', { mode: 'number' }),
    totalGrossCents: bigint('total_gross_cents', { mode: 'number' }).notNull(),
    feeCents: bigint('fee_cents', { mode: 'number' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: varchar('status', { length: 12 }).notNull(), // 'OPEN' | 'FILLED' | 'CANCELLED'
    ledgerTransactionId: uuid('ledger_transaction_id').references(() => ledgerTransactions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
  },
  (table) => [
    index('trade_orders_user_idx').on(table.userId, table.createdAt),
    index('trade_orders_open_symbol_idx').on(table.status, table.symbol),
  ]
);
