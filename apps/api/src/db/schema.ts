import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  integer,
  boolean,
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
    status: varchar('status', { length: 32 }).notNull(), // 'OPEN' | 'FILLED' | 'CANCELLED' | 'PENDING_COMPLIANCE_APPROVAL'
    ledgerTransactionId: uuid('ledger_transaction_id').references(() => ledgerTransactions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
  },
  (table) => [
    index('trade_orders_user_idx').on(table.userId, table.createdAt),
    index('trade_orders_open_symbol_idx').on(table.status, table.symbol),
  ]
);

// ============================================================================
// 7. Households & Multi-Party Members (Salesforce FSC Party Model)
// ============================================================================
export const households = pgTable(
  'households',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    taxIdentifier: varchar('tax_identifier', { length: 32 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('households_name_idx').on(table.name)]
);

export const householdMembers = pgTable(
  'household_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 32 }).notNull(), // 'HEAD_OF_HOUSEHOLD' | 'SPOUSE' | 'DEPENDENT' | 'BENEFICIARY'
    isDecisionMaker: boolean('is_decision_maker').default(false).notNull(),
    includeInRollup: boolean('include_in_rollup').default(true).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('household_user_unique_idx').on(table.householdId, table.userId),
    index('household_members_user_idx').on(table.userId),
  ]
);

// ============================================================================
// 8. Party Role Relationships (Peer Links & UBO Graph)
// ============================================================================
export const partyRelationships = pgTable(
  'party_relationships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceUserId: uuid('source_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    relationshipType: varchar('relationship_type', { length: 40 }).notNull(),
    reciprocalType: varchar('reciprocal_type', { length: 40 }).notNull(),
    ownershipPercentageBps: integer('ownership_percentage_bps').default(0).notNull(),
    isUbo: boolean('is_ubo').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('party_rel_source_target_idx').on(
      table.sourceUserId,
      table.targetUserId,
      table.relationshipType
    ),
    index('party_rel_target_idx').on(table.targetUserId),
  ]
);

// ============================================================================
// 9. Due Diligence: KYC Tiers & PEP Surveillance
// ============================================================================
export const kycProfiles = pgTable(
  'kyc_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tier: varchar('tier', { length: 24 }).notNull().default('TIER_2_STANDARD'),
    status: varchar('status', { length: 16 }).notNull().default('VERIFIED'),
    isPep: boolean('is_pep').default(false).notNull(),
    pepCategory: varchar('pep_category', { length: 32 }),
    pepDescription: text('pep_description'),
    dailyTransferLimitCents: bigint('daily_transfer_limit_cents', { mode: 'number' })
      .notNull()
      .default(5_000_000),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).defaultNow().notNull(),
    nextReviewDueAt: timestamp('next_review_due_at', { withTimezone: true }).notNull(),
    verifiedBy: uuid('verified_by').references(() => users.id),
  },
  (table) => [uniqueIndex('kyc_user_unique_idx').on(table.userId)]
);

// ============================================================================
// 10. Financial Account Roles (Multi-Party Joint & Fiduciary Ownership)
// ============================================================================
export const financialAccountRoles = pgTable(
  'financial_account_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleType: varchar('role_type', { length: 32 }).notNull(),
    canTrade: boolean('can_trade').default(false).notNull(),
    canWithdraw: boolean('can_withdraw').default(false).notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('financial_acc_role_unique_idx').on(table.accountId, table.userId, table.roleType),
    index('financial_acc_role_user_idx').on(table.userId),
  ]
);

// ============================================================================
// 11. Investor Profiling & Suitability (FINRA 2111 / Reg BI / CVM 30)
// ============================================================================
export const suitabilityProfiles = pgTable(
  'suitability_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    riskTier: varchar('risk_tier', { length: 24 }).notNull(),
    score: integer('score').notNull(),
    horizonMonths: integer('horizon_months').notNull(),
    maxStockConcentrationBps: integer('max_stock_concentration_bps').notNull().default(2000),
    maxSingleTradeCents: bigint('max_single_trade_cents', { mode: 'number' }).notNull(),
    questionnaireAnswers: jsonb('questionnaire_answers').notNull(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('suitability_user_expires_idx').on(table.userId, table.expiresAt)]
);

// ============================================================================
// 12. Interaction Summaries & Life Events (Compliant Data Sharing)
// ============================================================================
export const interactionLogs = pgTable(
  'interaction_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    advisorId: uuid('advisor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    channel: varchar('channel', { length: 24 }).notNull(),
    subject: varchar('subject', { length: 160 }).notNull(),
    notes: text('notes').notNull(),
    redactedNotes: text('redacted_notes'),
    confidentialityLevel: varchar('confidentiality_level', { length: 20 })
      .default('STANDARD')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('interaction_logs_client_idx').on(table.clientId, table.createdAt)]
);

export const personLifeEvents = pgTable(
  'person_life_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    description: text('description'),
    eventDate: timestamp('event_date', { withTimezone: true }).notNull(),
    financialImpactCents: bigint('financial_impact_cents', { mode: 'number' })
      .default(0)
      .notNull(),
    requiresSuitabilityReview: boolean('requires_suitability_review').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('person_life_events_user_idx').on(table.userId, table.eventDate)]
);

// ============================================================================
// 13. Trading Compliance: Restricted Lists, Overrides & SHA-256 Audit Log
// ============================================================================
export const restrictedSecurities = pgTable(
  'restricted_securities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    symbol: varchar('symbol', { length: 12 })
      .notNull()
      .references(() => assets.symbol, { onDelete: 'restrict' }),
    restrictionType: varchar('restriction_type', { length: 24 }).notNull(),
    reason: varchar('reason', { length: 40 }).notNull(),
    notes: text('notes'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }).notNull(),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('restricted_symbol_active_idx').on(table.symbol, table.isActive)]
);

export const complianceOverrides = pgTable(
  'compliance_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => tradeOrders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    overrideType: varchar('override_type', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    riskViolationReason: text('risk_violation_reason').notNull(),
    clientAttestationText: text('client_attestation_text'),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    reviewerRationale: text('reviewer_rationale'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('compliance_overrides_status_idx').on(table.status),
    index('compliance_overrides_order_idx').on(table.orderId),
  ]
);

export const complianceAuditLogs = pgTable(
  'compliance_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: varchar('event_type', { length: 48 }).notNull(),
    userId: uuid('user_id').references(() => users.id),
    operatorId: uuid('operator_id').references(() => users.id),
    ruleEvaluated: varchar('rule_evaluated', { length: 80 }).notNull(),
    decision: varchar('decision', { length: 16 }).notNull(),
    payloadSnapshot: jsonb('payload_snapshot').notNull(),
    recordHash: varchar('record_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('compliance_audit_created_idx').on(table.createdAt),
    index('compliance_audit_user_idx').on(table.userId),
  ]
);
