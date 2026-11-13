# AegisFintech: Banking & Trading CRM Architecture and Implementation Plan

**Document Identifier:** `docs/CRM_ARCHITECTURE_PLAN.md`  
**Classification:** System Architecture, Drizzle Schema Design, Pre-Trade Compliance Engine & Implementation Roadmap  
**Status:** Approved Engineering Architecture Specification  
**Target Subsystems:** `apps/api` (Fastify 5 + Drizzle ORM + PostgreSQL 17), `packages/shared` (Zod Schemas + Financial Math), `apps/web` (React 19 + Tailwind CSS v4 + TanStack Query v5 + Lucide React)  
**Authors:** Principal Software Engineer, Quantitative Systems Architect & Pragmatic Software Engineer  
**Constitutional Compliance:** `AGENTS.md` (Selective Complexity Budget: Zone 1 Mandatory Rigor & Zone 2 Anti-Overengineering)  

---

## 1. Architectural Vision & Engineering Invariants

This document specifies the end-to-end architecture and implementation roadmap for incorporating enterprise Salesforce FSC-inspired CRM capabilities, investor suitability profiling, and real-time pre-trade compliance rules into AegisFintech.

### 1.1 Strict Alignment with `AGENTS.md`

#### Zone 1: Where Rigor and Complexity Are MANDATORY (High Engineering)
1. **Double-Entry Ledger Integrity:** All balance-affecting operations strictly preserve the zero-sum ledger invariant:
   $$\sum \text{DEBITS} \equiv \sum \text{CREDITS}$$
2. **Deterministic Row-Level Pessimistic Locking:** Any operation mutating cash or securities (including escrow reservation for compliance overrides) acquires `SELECT ... FOR UPDATE` locks on target rows sorted ascending by primary key (`id ASC` or `account_id ASC`), eliminating AB-BA deadlocks.
3. **Integer Minor Units:** All financial values, prices, limits, and fees are stored and computed in integer minor units (`BIGINT` or integer cents). Ratios and percentages are expressed in integer basis points ($1\text{ bps} = 0.01\% = 0.0001$). Floating-point arithmetic is strictly forbidden.
4. **Cryptographic Idempotency & Audit Immutability:** Pre-trade checks, order approvals, and compliance overrides require an `Idempotency-Key` and record a SHA-256 cryptographic payload hash. Compliance audit logs are append-only (`INSERT` only).

#### Zone 2: Where Overengineering Is STRICTLY FORBIDDEN (Zero Ceremony)
1. **YAGNI & Direct Vertical Slices:** No generic repository interfaces (`ICRMRepository`), abstract factory builders, or unnecessary DTO mappers. Fastify route handlers directly query Drizzle ORM within clean transaction boundaries.
2. **Dynamic Aggregate Views over Denormalized Caching:** Household balances and net worth are calculated dynamically via optimized PostgreSQL aggregate queries and views, eliminating Salesforce-style asynchronous trigger batching (RBL/DPE) and preventing stale cache bugs.
3. **Dependency Economy:** Zero external JWT, encryption, or heavy UI dependencies. Native `node:crypto` handles HMAC and SHA-256 hashing; React 19 + Tailwind CSS v4 + Lucide React handle frontend views.

---

## 2. High-Level Subsystem Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     AEGISFINTECH SYSTEM TOPOLOGY                                │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                  WEB CLIENT (apps/web)                                          │
│  React 19 + Vite 6 + Tailwind CSS v4 + TanStack Query v5 + Lucide React                         │
│  ┌───────────────────────┐ ┌─────────────────────────┐ ┌──────────────────────────────────────┐ │
│  │ Household Wealth View │ │ Investor Profile & API  │ │ Order Ticket + Pre-Trade Guardrails  │ │
│  │ Member Rollups / UBO  │ │ 5-Dim Suitability Form  │ │ Soft Attestation / Hard Approval Q   │ │
│  └───────────────────────┘ └─────────────────────────┘ └──────────────────────────────────────┘ │
├────────────────────────────────────────┬────────────────────────────────────────────────────────┤
│                                        │ HTTPS / JSON (Bearer JWT / Idempotency-Key)            │
│                                        ▼                                                        │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                  FASTIFY API (apps/api)                                         │
│  Fastify 5 + Drizzle ORM 0.39 + postgres.js + Node.js 24                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │ ROUTE SLICES:                                                                              │ │
│  │ • /api/crm/households     • /api/crm/kyc           • /api/crm/suitability                  │ │
│  │ • /api/crm/interactions   • /api/trading/orders    • /api/compliance/overrides             │ │
│  └────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                        │                                                        │
│                                        ▼                                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │ PRE-TRADE COMPLIANCE PIPELINE (evaluatePreTradeCompliance)                                 │ │
│  │ 1. KYC/AML Status ──> 2. Restricted List ──> 3. Suitability ──> 4. Concentration ──> 5.Lock │ │
│  └────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                        │                                                        │
│                                        ▼                                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │ DOUBLE-ENTRY LEDGER & ESCROW ENGINE (postLedgerTransaction)                                │ │
│  │ SELECT ... FOR UPDATE (sorted ASC) | sum(DEBITS) === sum(CREDITS) | locked_balance_cents    │ │
│  └────────────────────────────────────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────┬────────────────────────────────────────────────────────┤
│                                        │ PostgreSQL Protocol (Port 5432)                        │
│                                        ▼                                                        │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│                             POSTGRESQL 17 DATABASE ENGINE                                       │
│  • accounts, users, portfolios, trade_orders, ledger_transactions, ledger_entries               │
│  • households, household_members, party_relationships, kyc_profiles, financial_account_roles    │
│  • suitability_profiles, restricted_securities, compliance_overrides, compliance_audit_logs     │
│  • interaction_logs, person_life_events                                                         │
│  • dynamic_household_net_worth (SQL View)                                                       │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schemas: Drizzle ORM & PostgreSQL DDL

### 3.1 Drizzle ORM Schema Extensions (`apps/api/src/db/schema.ts`)

The CRM and compliance schema extends AegisFintech's existing core financial tables (`users`, `accounts`, `assets`, `portfolios`, `tradeOrders`, `ledgerTransactions`, `ledgerEntries`).

> **Core Table Schema Extension (`tradeOrders`):** To support the 27-character `'PENDING_COMPLIANCE_APPROVAL'` status enum, the `status` column on `tradeOrders` is widened from `length: 16` to `length: 32` (`varchar('status', { length: 32 }).notNull().default('OPEN')`).

```typescript
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
import { users, accounts, assets, tradeOrders } from './schema.js';

// ============================================================================
// 1. Households & Multi-Party Members (Party Model)
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
// 2. Party Role Relationships (Peer Links & UBO Graph)
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
    // 'SPOUSE' | 'PARENT_CHILD' | 'TRUSTEE_BENEFICIARY' | 'BUSINESS_PARTNER' | 'UBO_CONTROLLER'
    reciprocalType: varchar('reciprocal_type', { length: 40 }).notNull(),
    ownershipPercentageBps: integer('ownership_percentage_bps').default(0).notNull(), // 2500 = 25.00%
    isUbo: boolean('is_ubo').default(false).notNull(), // True if >= 25% or significant managerial control
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
// 3. Due Diligence: KYC Tiers & PEP Surveillance
// ============================================================================
export const kycProfiles = pgTable(
  'kyc_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tier: varchar('tier', { length: 24 }).notNull().default('TIER_1_SIMPLIFIED'),
    // 'TIER_0_UNVERIFIED' | 'TIER_1_SIMPLIFIED' | 'TIER_2_STANDARD' | 'TIER_3_ENHANCED'
    status: varchar('status', { length: 16 }).notNull().default('VERIFIED'),
    // 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED'
    isPep: boolean('is_pep').default(false).notNull(),
    pepCategory: varchar('pep_category', { length: 32 }),
    // 'HEAD_OF_STATE' | 'SENIOR_GOV' | 'JUDICIAL_MILITARY' | 'FAMILY_MEMBER' | 'CLOSE_ASSOCIATE'
    pepDescription: text('pep_description'),
    dailyTransferLimitCents: bigint('daily_transfer_limit_cents', { mode: 'number' })
      .notNull()
      .default(500_000), // 5,000.00 default for Tier 1
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).defaultNow().notNull(),
    nextReviewDueAt: timestamp('next_review_due_at', { withTimezone: true }).notNull(),
    verifiedBy: uuid('verified_by').references(() => users.id),
  },
  (table) => [uniqueIndex('kyc_user_unique_idx').on(table.userId)]
);

// ============================================================================
// 4. Financial Account Roles (Multi-Party Joint & Fiduciary Ownership)
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
    // 'PRIMARY_OWNER' | 'JOINT_OWNER' | 'BENEFICIARY' | 'TRUSTEE' | 'POWER_OF_ATTORNEY' | 'AUTHORIZED_TRADER'
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
// 5. Investor Profiling & Suitability (FINRA 2111 / Reg BI / CVM 30/35)
// ============================================================================
export const suitabilityProfiles = pgTable(
  'suitability_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    riskTier: varchar('risk_tier', { length: 24 }).notNull(),
    // 'CONSERVATIVE' | 'MODERATE' | 'BALANCED_GROWTH' | 'AGGRESSIVE_SPECULATIVE'
    score: integer('score').notNull(), // 0 to 100
    horizonMonths: integer('horizon_months').notNull(),
    maxStockConcentrationBps: integer('max_stock_concentration_bps').notNull().default(2000), // 2000 = 20.00%
    maxSingleTradeCents: bigint('max_single_trade_cents', { mode: 'number' }).notNull(),
    questionnaireAnswers: jsonb('questionnaire_answers').notNull(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('suitability_user_expires_idx').on(table.userId, table.expiresAt),
  ]
);

// ============================================================================
// 6. Interaction Summaries & Life Events (Compliant Data Sharing)
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
    channel: varchar('channel', { length: 24 }).notNull(), // 'PHONE' | 'VIDEO' | 'IN_PERSON' | 'CHAT' | 'EMAIL'
    subject: varchar('subject', { length: 160 }).notNull(),
    notes: text('notes').notNull(),
    redactedNotes: text('redacted_notes'),
    confidentialityLevel: varchar('confidentiality_level', { length: 20 }).default('STANDARD').notNull(),
    // 'STANDARD' | 'CONFIDENTIAL' | 'RESTRICTED_MNPI'
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
    // 'MARRIAGE' | 'DIVORCE' | 'CHILD_BIRTH' | 'HOME_PURCHASE' | 'CAREER_CHANGE' | 'RETIREMENT' | 'INHERITANCE'
    title: varchar('title', { length: 120 }).notNull(),
    description: text('description'),
    eventDate: timestamp('event_date', { withTimezone: true }).notNull(),
    financialImpactCents: bigint('financial_impact_cents', { mode: 'number' }).default(0).notNull(),
    requiresSuitabilityReview: boolean('requires_suitability_review').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('person_life_events_user_idx').on(table.userId, table.eventDate)]
);

// ============================================================================
// 7. Trading Compliance: Restricted Lists, Overrides & Audit Log
// ============================================================================
export const restrictedSecurities = pgTable(
  'restricted_securities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    symbol: varchar('symbol', { length: 12 })
      .notNull()
      .references(() => assets.symbol, { onDelete: 'restrict' }),
    restrictionType: varchar('restriction_type', { length: 24 }).notNull(),
    // 'RESTRICTED_ALL' | 'RESTRICTED_BUY_ONLY' | 'RESTRICTED_SELL_ONLY' | 'WATCH_LIST_ONLY'
    reason: varchar('reason', { length: 40 }).notNull(),
    // 'MNPI_INSIDER' | 'M_AND_A_ADVISORY' | 'UNDERWRITING_BLACKOUT' | 'SANCTION_REGULATORY'
    notes: text('notes'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }).notNull(),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('restricted_symbol_active_idx').on(table.symbol, table.isActive),
  ]
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
    // 'CLIENT_ATTESTATION' | 'COMPLIANCE_OFFICER_APPROVAL'
    status: varchar('status', { length: 16 }).notNull(),
    // 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
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
    // 'PRE_TRADE_CHECK_PASSED' | 'PRE_TRADE_CHECK_FAILED' | 'RESTRICTED_LIST_BLOCK' | 'OVERRIDE_REQUESTED' | 'OVERRIDE_APPROVED' | 'OVERRIDE_REJECTED'
    userId: uuid('user_id').references(() => users.id),
    operatorId: uuid('operator_id').references(() => users.id),
    ruleEvaluated: varchar('rule_evaluated', { length: 80 }).notNull(),
    decision: varchar('decision', { length: 16 }).notNull(), // 'ALLOW' | 'BLOCK' | 'PENDING'
    payloadSnapshot: jsonb('payload_snapshot').notNull(),
    recordHash: varchar('record_hash', { length: 64 }).notNull(), // SHA-256 integrity hash
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('compliance_audit_created_idx').on(table.createdAt),
    index('compliance_audit_user_idx').on(table.userId),
  ]
);
```

---

### 3.2 Pure PostgreSQL DDL Migration (`apps/api/drizzle/migrations/0002_crm_and_compliance.sql`)

```sql
-- Migration: 0002_crm_and_compliance.sql
-- Enforces Zone 1 Invariants: BIGINT minor units, Foreign Key Constraints, and B-Tree Indexes

-- 0. Expand trade_orders status column from VARCHAR(16) to VARCHAR(32)
-- Accommodates the 27-character 'PENDING_COMPLIANCE_APPROVAL' status enum without database truncation
ALTER TABLE trade_orders ALTER COLUMN status TYPE VARCHAR(32);

CREATE TABLE IF NOT EXISTS households (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    tax_identifier VARCHAR(32),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS households_name_idx ON households(name);

CREATE TABLE IF NOT EXISTS household_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    is_decision_maker BOOLEAN NOT NULL DEFAULT FALSE,
    include_in_rollup BOOLEAN NOT NULL DEFAULT TRUE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT household_user_unique UNIQUE (household_id, user_id)
);
CREATE INDEX IF NOT EXISTS household_members_user_idx ON household_members(user_id);

CREATE TABLE IF NOT EXISTS party_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relationship_type VARCHAR(40) NOT NULL,
    reciprocal_type VARCHAR(40) NOT NULL,
    ownership_percentage_bps INTEGER NOT NULL DEFAULT 0,
    is_ubo BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT party_rel_unique UNIQUE (source_user_id, target_user_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS party_rel_target_idx ON party_relationships(target_user_id);

CREATE TABLE IF NOT EXISTS kyc_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    tier VARCHAR(24) NOT NULL DEFAULT 'TIER_1_SIMPLIFIED',
    status VARCHAR(16) NOT NULL DEFAULT 'VERIFIED',
    is_pep BOOLEAN NOT NULL DEFAULT FALSE,
    pep_category VARCHAR(32),
    pep_description TEXT,
    daily_transfer_limit_cents BIGINT NOT NULL DEFAULT 500000,
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_review_due_at TIMESTAMPTZ NOT NULL,
    verified_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS financial_account_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_type VARCHAR(32) NOT NULL,
    can_trade BOOLEAN NOT NULL DEFAULT FALSE,
    can_withdraw BOOLEAN NOT NULL DEFAULT FALSE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fin_acc_role_unique UNIQUE (account_id, user_id, role_type)
);
CREATE INDEX IF NOT EXISTS financial_acc_role_user_idx ON financial_account_roles(user_id);

CREATE TABLE IF NOT EXISTS suitability_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    risk_tier VARCHAR(24) NOT NULL,
    score INTEGER NOT NULL,
    horizon_months INTEGER NOT NULL,
    max_stock_concentration_bps INTEGER NOT NULL DEFAULT 2000,
    max_single_trade_cents BIGINT NOT NULL,
    questionnaire_answers JSONB NOT NULL,
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS suitability_user_expires_idx ON suitability_profiles(user_id, expires_at);

CREATE TABLE IF NOT EXISTS interaction_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    advisor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    channel VARCHAR(24) NOT NULL,
    subject VARCHAR(160) NOT NULL,
    notes TEXT NOT NULL,
    redacted_notes TEXT,
    confidentiality_level VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS interaction_logs_client_idx ON interaction_logs(client_id, created_at);

CREATE TABLE IF NOT EXISTS person_life_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL,
    title VARCHAR(120) NOT NULL,
    description TEXT,
    event_date TIMESTAMPTZ NOT NULL,
    financial_impact_cents BIGINT NOT NULL DEFAULT 0,
    requires_suitability_review BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS person_life_events_user_idx ON person_life_events(user_id, event_date);

CREATE TABLE IF NOT EXISTS restricted_securities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(12) NOT NULL REFERENCES assets(symbol) ON DELETE RESTRICT,
    restriction_type VARCHAR(24) NOT NULL,
    reason VARCHAR(40) NOT NULL,
    notes TEXT,
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ NOT NULL,
    added_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS restricted_symbol_active_idx ON restricted_securities(symbol, is_active);

CREATE TABLE IF NOT EXISTS compliance_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES trade_orders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    override_type VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    risk_violation_reason TEXT NOT NULL,
    client_attestation_text TEXT,
    reviewer_id UUID REFERENCES users(id),
    reviewer_rationale TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS compliance_overrides_status_idx ON compliance_overrides(status);
CREATE INDEX IF NOT EXISTS compliance_overrides_order_idx ON compliance_overrides(order_id);

CREATE TABLE IF NOT EXISTS compliance_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(48) NOT NULL,
    user_id UUID REFERENCES users(id),
    operator_id UUID REFERENCES users(id),
    rule_evaluated VARCHAR(80) NOT NULL,
    decision VARCHAR(16) NOT NULL,
    payload_snapshot JSONB NOT NULL,
    record_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS compliance_audit_created_idx ON compliance_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS compliance_audit_user_idx ON compliance_audit_logs(user_id);
```

---

### 3.3 Dynamic Household Net Worth: PostgreSQL View Specification

To eliminate the write-amplification and stale-cache risks of Salesforce RBL triggers, consolidated wealth is evaluated dynamically through a clean database view:

```sql
CREATE OR REPLACE VIEW view_household_net_worth AS
WITH member_cash AS (
    SELECT 
        hm.household_id,
        hm.user_id,
        COALESCE(SUM(
            CASE 
                WHEN a.currency = 'BRL' THEN a.balance_cents
                WHEN a.currency = 'USD' THEN (a.balance_cents * 58000) / 10000 -- Commercial FX reference: 5.80 BRL per USD
                WHEN a.currency = 'EUR' THEN (a.balance_cents * 62500) / 10000 -- Commercial FX reference: 6.25 BRL per EUR
                ELSE a.balance_cents
            END
        ), 0)::BIGINT AS total_cash_cents,
        COALESCE(SUM(
            CASE 
                WHEN a.currency = 'BRL' THEN a.locked_balance_cents
                WHEN a.currency = 'USD' THEN (a.locked_balance_cents * 58000) / 10000
                WHEN a.currency = 'EUR' THEN (a.locked_balance_cents * 62500) / 10000
                ELSE a.locked_balance_cents
            END
        ), 0)::BIGINT AS total_locked_cash_cents
    FROM household_members hm
    LEFT JOIN accounts a ON a.user_id = hm.user_id
    WHERE hm.include_in_rollup = TRUE
    GROUP BY hm.household_id, hm.user_id
),
member_equities AS (
    SELECT
        hm.household_id,
        hm.user_id,
        COALESCE(SUM(p.quantity * ast.current_price_cents), 0)::BIGINT AS total_equity_cents
    FROM household_members hm
    LEFT JOIN portfolios p ON p.user_id = hm.user_id
    LEFT JOIN assets ast ON ast.symbol = p.symbol
    WHERE hm.include_in_rollup = TRUE
    GROUP BY hm.household_id, hm.user_id
)
SELECT 
    h.id AS household_id,
    h.name AS household_name,
    COUNT(DISTINCT hm.user_id) AS member_count,
    COALESCE(SUM(mc.total_cash_cents), 0)::BIGINT AS total_cash_cents,
    COALESCE(SUM(mc.total_locked_cash_cents), 0)::BIGINT AS total_locked_cash_cents,
    COALESCE(SUM(me.total_equity_cents), 0)::BIGINT AS total_equity_cents,
    (COALESCE(SUM(mc.total_cash_cents), 0) + COALESCE(SUM(me.total_equity_cents), 0))::BIGINT AS consolidated_net_worth_cents
FROM households h
LEFT JOIN household_members hm ON hm.household_id = h.id AND hm.include_in_rollup = TRUE
LEFT JOIN member_cash mc ON mc.household_id = h.id AND mc.user_id = hm.user_id
LEFT JOIN member_equities me ON me.household_id = h.id AND me.user_id = hm.user_id
GROUP BY h.id, h.name;
```

---

## 4. 5-Gate Synchronous Pre-Trade Compliance Engine

The pre-trade compliance engine executes synchronously inside the caller's database transaction (`tx`) *before* an order is accepted or escrow is settled.

### 4.1 Pre-Trade Compliance Engine (`apps/api/src/modules/trading/compliance-engine.ts`)

```typescript
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHmac } from 'node:crypto';
import type { CurrencyCode } from '@aegis/shared';
import { AppError } from '../../core/errors.js';
import {
  restrictedSecurities,
  suitabilityProfiles,
  kycProfiles,
  portfolios,
  assets,
  accounts,
  tradeOrders,
  householdMembers,
  complianceAuditLogs,
} from '../../db/schema.js';
import { getFxRateScaled1e4 } from '../fx/rates.js';

export interface PreTradeEvaluationResult {
  allowed: boolean;
  status: 'APPROVED' | 'REQUIRES_CLIENT_ATTESTATION' | 'REQUIRES_COMPLIANCE_APPROVAL';
  reason?: string;
  ruleViolated?: string;
  auditPayload?: Record<string, unknown>;
}

export async function evaluatePreTradeCompliance(
  tx: Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0],
  params: {
    userId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT';
    quantity: number;
    limitPriceCents?: number;
    grossCents: number;
    feeCents: number;
    hasClientAttestation?: boolean;
    attestationText?: string;
  }
): Promise<PreTradeEvaluationResult> {
  const now = new Date();

  // ==========================================================================
  // GATE 1: KYC Status & Verification Tier Check (Strict Tier >= 2 Enforcement)
  // ==========================================================================
  const [kyc] = await tx
    .select()
    .from(kycProfiles)
    .where(eq(kycProfiles.userId, params.userId))
    .limit(1);

  // Strictly enforce KYC Tier >= 2 (TIER_2_STANDARD or TIER_3_ENHANCED) for equities trading
  if (!kyc || kyc.status !== 'VERIFIED' || kyc.tier === 'TIER_0_UNVERIFIED' || kyc.tier === 'TIER_1_SIMPLIFIED') {
    await logComplianceDecision(tx, {
      eventType: 'KYC_TIER_BLOCK',
      userId: params.userId,
      ruleEvaluated: 'GATE_1_KYC_VERIFICATION_TIER_CHECK',
      decision: 'BLOCK',
      payload: { currentTier: kyc?.tier ?? 'NONE', requiredTier: 'TIER_2_STANDARD_OR_ABOVE' },
    });

    throw new AppError(
      'FORBIDDEN',
      'Equities trading requires an active, verified KYC profile at Tier 2 (Standard Verification) or higher. Tier 1 profiles are restricted to basic payments and savings.',
      403
    );
  }

  // ==========================================================================
  // GATE 2: Restricted Securities List Check (Short-Circuit Hard Block)
  // ==========================================================================
  const [restriction] = await tx
    .select()
    .from(restrictedSecurities)
    .where(
      and(
        eq(restrictedSecurities.symbol, params.symbol),
        eq(restrictedSecurities.isActive, true),
        lte(restrictedSecurities.effectiveFrom, now),
        gte(restrictedSecurities.effectiveTo, now)
      )
    )
    .limit(1);

  if (restriction) {
    const isBlocked =
      restriction.restrictionType === 'RESTRICTED_ALL' ||
      (params.side === 'BUY' && restriction.restrictionType === 'RESTRICTED_BUY_ONLY') ||
      (params.side === 'SELL' && restriction.restrictionType === 'RESTRICTED_SELL_ONLY');

    if (isBlocked) {
      // Record immutable audit failure log
      await logComplianceDecision(tx, {
        eventType: 'RESTRICTED_LIST_BLOCK',
        userId: params.userId,
        ruleEvaluated: 'GATE_2_RESTRICTED_SECURITIES_CHECK',
        decision: 'BLOCK',
        payload: { symbol: params.symbol, restrictionReason: restriction.reason, side: params.side },
      });

      throw new AppError(
        'FORBIDDEN',
        `Asset "${params.symbol}" is currently restricted from trading due to compliance restrictions (${restriction.reason}).`,
        403
      );
    }
  }

  // ==========================================================================
  // GATE 3: Quantitative Suitability & Volatility Matching Check
  // ==========================================================================
  const [suitability] = await tx
    .select()
    .from(suitabilityProfiles)
    .where(eq(suitabilityProfiles.userId, params.userId))
    .limit(1);

  if (!suitability || suitability.expiresAt < now) {
    throw new AppError(
      'PRECONDITION_FAILED',
      'Your investor suitability profile has expired or is unassessed. Complete the suitability questionnaire before trading.',
      412
    );
  }

  const [asset] = await tx
    .select()
    .from(assets)
    .where(eq(assets.symbol, params.symbol))
    .limit(1);

  if (!asset) {
    throw new AppError('NOT_FOUND', `Asset "${params.symbol}" not found in market catalogue.`, 404);
  }

  // Volatility evaluation: if asset volatility > 150 bps and profile is CONSERVATIVE
  const isHighVolatility = asset.volatilityBps > 150;
  if (suitability.riskTier === 'CONSERVATIVE' && isHighVolatility && params.side === 'BUY') {
    if (!params.hasClientAttestation) {
      return {
        allowed: false,
        status: 'REQUIRES_CLIENT_ATTESTATION',
        ruleViolated: 'GATE_3_SUITABILITY_VOLATILITY_MISMATCH',
        reason: `Asset "${params.symbol}" exhibits high volatility (${(asset.volatilityBps / 100).toFixed(2)}%) which exceeds your Conservative risk profile.`,
        auditPayload: { assetVolatilityBps: asset.volatilityBps, userRiskTier: suitability.riskTier },
      };
    }
  }

  // ==========================================================================
  // GATE 4: Single-Stock Concentration Limit Calculation (Household & Multi-Currency)
  // ==========================================================================
  if (params.side === 'BUY') {
    // 1. Household Profiling Integration: Check if user belongs to an active household rollup
    const [householdMember] = await tx
      .select({
        householdId: householdMembers.householdId,
        includeInRollup: householdMembers.includeInRollup,
      })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.userId, params.userId),
          eq(householdMembers.includeInRollup, true)
        )
      )
      .limit(1);

    let totalLiquidNetWorthCents = 0n;
    let targetUserIds: string[] = [params.userId];

    if (householdMember) {
      // Utilize Household consolidated liquid net worth from view_household_net_worth
      const [householdRollup] = await tx
        .select({
          consolidatedNetWorthCents: sql<string>`consolidated_net_worth_cents`,
        })
        .from(sql`view_household_net_worth`)
        .where(sql`household_id = ${householdMember.householdId}`)
        .limit(1);

      if (householdRollup && householdRollup.consolidatedNetWorthCents) {
        totalLiquidNetWorthCents = BigInt(householdRollup.consolidatedNetWorthCents);
      }

      // Group all household members included in rollup for portfolio holdings & pending orders
      const members = await tx
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdMember.householdId),
            eq(householdMembers.includeInRollup, true)
          )
        );
      targetUserIds = members.map((m) => m.userId);
    } else {
      // Individual User: Aggregate multi-currency cash normalized to asset settlement currency (e.g. BRL)
      const userAccounts = await tx
        .select({
          currency: accounts.currency,
          balanceCents: accounts.balanceCents,
        })
        .from(accounts)
        .where(eq(accounts.userId, params.userId));

      let totalCashCents = 0n;
      for (const acc of userAccounts) {
        const bal = BigInt(acc.balanceCents);
        if (acc.currency === asset.currency) {
          totalCashCents += bal;
        } else {
          // Normalize non-settlement currency to asset currency using integer scaled FX rate
          const rateScaled1e4 = BigInt(
            getFxRateScaled1e4(acc.currency as CurrencyCode, asset.currency as CurrencyCode)
          );
          totalCashCents += (bal * rateScaled1e4) / 10_000n;
        }
      }

      // Calculate portfolio equity market value in asset settlement currency
      const userPortfolios = await tx
        .select({
          quantity: portfolios.quantity,
          currentPriceCents: assets.currentPriceCents,
        })
        .from(portfolios)
        .innerJoin(assets, eq(portfolios.symbol, assets.symbol))
        .where(eq(portfolios.userId, params.userId));

      let totalEquityCents = 0n;
      for (const p of userPortfolios) {
        totalEquityCents += BigInt(p.quantity) * BigInt(p.currentPriceCents);
      }

      totalLiquidNetWorthCents = totalCashCents + totalEquityCents;
    }

    // Zero-division and non-positive net worth guard (Zone 1 Invariant)
    if (totalLiquidNetWorthCents <= 0n) {
      throw new AppError(
        'UNPROCESSABLE_ENTITY',
        'Liquid net worth must be positive to assess concentration limits.',
        422
      );
    }

    // 2. Calculate existing filled holding for this symbol across target user(s)
    const existingHoldings = await tx
      .select({
        quantity: portfolios.quantity,
      })
      .from(portfolios)
      .where(
        and(
          inArray(portfolios.userId, targetUserIds),
          eq(portfolios.symbol, params.symbol)
        )
      );

    let existingAssetHoldingCents = 0n;
    for (const h of existingHoldings) {
      existingAssetHoldingCents += BigInt(h.quantity) * BigInt(asset.currentPriceCents);
    }

    // 3. Include pending buy orders (OPEN and PENDING_COMPLIANCE_APPROVAL) to prevent sequential evasion
    const pendingOrders = await tx
      .select({
        quantity: tradeOrders.quantity,
        limitPriceCents: tradeOrders.limitPriceCents,
      })
      .from(tradeOrders)
      .where(
        and(
          inArray(tradeOrders.userId, targetUserIds),
          eq(tradeOrders.symbol, params.symbol),
          eq(tradeOrders.side, 'BUY'),
          inArray(tradeOrders.status, ['OPEN', 'PENDING_COMPLIANCE_APPROVAL'])
        )
      );

    let pendingOrderHoldingCents = 0n;
    for (const po of pendingOrders) {
      const price = BigInt(po.limitPriceCents ?? asset.currentPriceCents);
      pendingOrderHoldingCents += BigInt(po.quantity) * price;
    }

    // 4. Calculate total projected commitment in minor units (BigInt cents)
    const commitGrossCents = existingAssetHoldingCents + pendingOrderHoldingCents + BigInt(params.grossCents);

    // 5. Pure Integer Basis Point calculation: (commit * 10,000n) / net_worth
    const concentrationBps = Number((commitGrossCents * 10_000n) / totalLiquidNetWorthCents);

    if (concentrationBps > suitability.maxStockConcentrationBps) {
      return {
        allowed: false,
        status: 'REQUIRES_COMPLIANCE_APPROVAL',
        ruleViolated: 'GATE_4_CONCENTRATION_LIMIT_EXCEEDED',
        reason: `Order would result in a ${(concentrationBps / 100).toFixed(1)}% concentration in ${params.symbol} (including pending orders and household holdings), exceeding the allowed maximum of ${(suitability.maxStockConcentrationBps / 100).toFixed(1)}%.`,
        auditPayload: {
          projectedConcentrationBps: concentrationBps,
          maxAllowedBps: suitability.maxStockConcentrationBps,
          existingHoldingCents: Number(existingAssetHoldingCents),
          pendingOrderHoldingCents: Number(pendingOrderHoldingCents),
          newOrderGrossCents: params.grossCents,
          totalCommitGrossCents: Number(commitGrossCents),
          liquidNetWorthCents: Number(totalLiquidNetWorthCents),
          isHouseholdRollup: !!householdMember,
        },
      };
    }
  }

  // ==========================================================================
  // GATE 5: Escrow Verification / Locking Prerequisite
  // ==========================================================================
  // Verified clean; caller proceeds to acquire row-level lock and reserve funds
  return {
    allowed: true,
    status: 'APPROVED',
  };
}

// Helper: Append-Only Immutable Compliance Audit Log with SHA-256 Hash
export async function logComplianceDecision(
  tx: Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0],
  entry: {
    eventType: string;
    userId?: string;
    operatorId?: string;
    ruleEvaluated: string;
    decision: 'ALLOW' | 'BLOCK' | 'PENDING';
    payload: Record<string, unknown>;
  }
) {
  const timestamp = new Date().toISOString();
  const rawData = `${entry.eventType}|${entry.userId ?? ''}|${entry.ruleEvaluated}|${entry.decision}|${JSON.stringify(entry.payload)}|${timestamp}`;
  const recordHash = createHmac('sha256', 'aegis-compliance-secret').update(rawData).digest('hex');

  await tx.insert(complianceAuditLogs).values({
    eventType: entry.eventType,
    userId: entry.userId,
    operatorId: entry.operatorId,
    ruleEvaluated: entry.ruleEvaluated,
    decision: entry.decision,
    payloadSnapshot: entry.payload,
    recordHash,
  });
}
```

---

## 5. Compliance Override Workflows

### 5.1 Soft Override vs. Hard Override Life Cycle

```
                       Client Order Placement Request
                                     │
                      [ 5-Gate Compliance Evaluation ]
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           ▼                         ▼                         ▼
        CLEAN                 SOFT VIOLATION            HARD VIOLATION
   (Gate 1-5 Pass)        (Conservative vs Volatile) (Concentration > Cap)
           │                         │                         │
           ▼                         ▼                         ▼
   Execute / Book         Client Attestation?        Lock Escrow (Cash / Stock)
   Status: OPEN/FILLED               │               Status: PENDING_COMPLIANCE_APPROVAL
                             ┌───────┴───────┐                 │
                             ▼               ▼                 ▼
                          Signed         Declined     Compliance Officer Review
                     Status: OPEN        Cancel/400            │
                     (Audit Logged)                       ┌────┴────┐
                                                          ▼         ▼
                                                       APPROVE    REJECT
                                                          │         │
                                              ┌───────────┴───┐     ▼
                                              ▼               ▼  Release Escrow
                                           MARKET          LIMIT (Cash: locked_balance_cents
                                          Immediate       Status:  Stock: locked_quantity)
                                          Clearing &       OPEN   Status: CANCELLED
                                          Ledger Fill     (Book)
                                          Status: FILLED
```

### 5.2 Hard Override Escrow Invariant & Supervisory Execution

When an order requires compliance approval (`PENDING_COMPLIANCE_APPROVAL`):
1. **Escrow Reservation:**
   - **BUY Orders:** `totalGrossCents + feeCents` is locked in the matching currency checking account (`accounts.locked_balance_cents`) using row-level pessimistic locking (`SELECT ... FOR UPDATE`).
   - **SELL Orders:** `quantity` shares are locked in custody (`portfolios.locked_quantity`) using row-level pessimistic locking.
2. **Double-Spending Immunity:** The user cannot withdraw, transfer, or double-commit reserved cash or custody shares. Any subsequent withdrawal verifies `balance_cents - locked_balance_cents >= debit`, rejecting overdraft attempts.
3. **Supervisory Sign-Off Handler (`apps/api/src/modules/compliance/routes.ts`):**

```typescript
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { CurrencyCode } from '@aegis/shared';
import { AppError } from '../../core/errors.js';
import {
  accounts,
  assets,
  portfolios,
  tradeOrders,
  restrictedSecurities,
  complianceOverrides,
  complianceAuditLogs,
} from '../../db/schema.js';
import {
  calculateBrokerageFee,
  calculatePortfolioAfterBuy,
  calculatePortfolioAfterSell,
} from '../../domain/money/financial-math.js';
import { postLedgerTransaction } from '../../domain/ledger/post-ledger-transaction.js';
import { getOrCreateSystemAccount } from '../../domain/ledger/system-accounts.js';
import { matchOpenLimitOrdersForSymbol } from '../market/engine.js';
import { logComplianceDecision } from '../trading/compliance-engine.js';

export async function processComplianceOverride(
  db: NodePgDatabase,
  params: {
    orderId: string;
    complianceOfficerId: string;
    action: 'APPROVE' | 'REJECT';
    rationale: string;
  }
) {
  return await db.transaction(async (tx) => {
    // 1. Fetch compliance override record
    const [override] = await tx
      .select()
      .from(complianceOverrides)
      .where(and(eq(complianceOverrides.orderId, params.orderId), eq(complianceOverrides.status, 'PENDING')))
      .limit(1);

    if (!override) {
      throw new AppError('NOT_FOUND', 'Pending compliance override record not found.', 404);
    }

    // 2. Fetch order with deterministic row-level lock
    const [order] = await tx
      .select()
      .from(tradeOrders)
      .where(eq(tradeOrders.id, params.orderId))
      .for('update')
      .limit(1);

    if (!order || order.status !== 'PENDING_COMPLIANCE_APPROVAL') {
      throw new AppError('BAD_REQUEST', 'Order is not awaiting compliance approval.', 400);
    }

    // 3. Multi-Currency Matching: Fetch matching cash account by userId AND currency = order.currency
    const [account] = await tx
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, order.userId),
          eq(accounts.currency, order.currency),
          eq(accounts.accountType, 'CHECKING')
        )
      )
      .for('update')
      .limit(1);

    if (!account) {
      throw new AppError(
        'NOT_FOUND',
        `Checking account in settlement currency "${order.currency}" not found for user.`,
        404
      );
    }

    const now = new Date();

    if (params.action === 'APPROVE') {
      // 4. Restricted List Re-Check immediately before approval
      const [currentRestriction] = await tx
        .select()
        .from(restrictedSecurities)
        .where(
          and(
            eq(restrictedSecurities.symbol, order.symbol),
            eq(restrictedSecurities.isActive, true),
            lte(restrictedSecurities.effectiveFrom, now),
            gte(restrictedSecurities.effectiveTo, now)
          )
        )
        .limit(1);

      if (currentRestriction) {
        const isBlocked =
          currentRestriction.restrictionType === 'RESTRICTED_ALL' ||
          (order.side === 'BUY' && currentRestriction.restrictionType === 'RESTRICTED_BUY_ONLY') ||
          (order.side === 'SELL' && currentRestriction.restrictionType === 'RESTRICTED_SELL_ONLY');

        if (isBlocked) {
          throw new AppError(
            'FORBIDDEN',
            `Cannot approve order: Asset "${order.symbol}" became restricted (${currentRestriction.reason}) while awaiting review.`,
            403
          );
        }
      }

      // 5. Fetch asset record with pessimistic lock
      const [asset] = await tx
        .select()
        .from(assets)
        .where(eq(assets.symbol, order.symbol))
        .for('update')
        .limit(1);

      if (!asset) {
        throw new AppError('NOT_FOUND', `Asset "${order.symbol}" not found in catalogue.`, 404);
      }

      // 6. Branch on Order Type Lifecycle: MARKET vs LIMIT
      if (order.orderType === 'MARKET') {
        // Execute immediately against current market price through clearing engine
        const executedPriceCents = asset.currentPriceCents;
        const executedGrossCents = order.quantity * executedPriceCents;
        const feeCents = calculateBrokerageFee(executedGrossCents);
        const totalExecutedCommitCents = executedGrossCents + feeCents;

        let receiptId: string;

        if (order.side === 'BUY') {
          // Release reserved escrow cash
          const reservedCents = order.totalGrossCents + order.feeCents;
          await tx
            .update(accounts)
            .set({
              lockedBalanceCents: sql`GREATEST(0, ${accounts.lockedBalanceCents} - ${reservedCents})`,
            })
            .where(eq(accounts.id, account.id));

          // Post ledger transaction: Debit user cash, Credit clearing account
          const clearingAcc = await getOrCreateSystemAccount(
            tx,
            'SYS-MARKET-CLEARING',
            order.currency as CurrencyCode
          );
          const receipt = await postLedgerTransaction(tx, {
            category: 'TRADE_BUY',
            description: `Market Buy Fill: ${order.quantity} ${order.symbol} @ ${executedPriceCents} cents (Supervisory Override)`,
            currency: order.currency as CurrencyCode,
            postings: [
              {
                accountId: account.id,
                direction: 'DEBIT',
                amountCents: totalExecutedCommitCents,
                currency: order.currency as CurrencyCode,
              },
              {
                accountId: clearingAcc.id,
                direction: 'CREDIT',
                amountCents: totalExecutedCommitCents,
                currency: order.currency as CurrencyCode,
              },
            ],
            metadata: {
              orderId: order.id,
              symbol: order.symbol,
              quantity: order.quantity,
              executedPriceCents,
              feeCents,
            },
          });
          receiptId = receipt.transactionId;

          // Update user portfolio holding with weighted average cost basis
          const [existingPortfolio] = await tx
            .select()
            .from(portfolios)
            .where(and(eq(portfolios.userId, order.userId), eq(portfolios.symbol, order.symbol)))
            .limit(1);

          const updatedHolding = calculatePortfolioAfterBuy({
            existingQuantity: existingPortfolio?.quantity ?? 0,
            existingAveragePriceCents: existingPortfolio?.averagePriceCents ?? 0,
            buyQuantity: order.quantity,
            buyPriceCents: executedPriceCents,
          });

          if (existingPortfolio) {
            await tx
              .update(portfolios)
              .set({
                quantity: updatedHolding.quantity,
                averagePriceCents: updatedHolding.averagePriceCents,
                updatedAt: new Date(),
              })
              .where(eq(portfolios.id, existingPortfolio.id));
          } else {
            await tx.insert(portfolios).values({
              userId: order.userId,
              symbol: order.symbol,
              quantity: updatedHolding.quantity,
              averagePriceCents: updatedHolding.averagePriceCents,
            });
          }
        } else {
          // SELL side market execution
          const [portfolio] = await tx
            .select()
            .from(portfolios)
            .where(and(eq(portfolios.userId, order.userId), eq(portfolios.symbol, order.symbol)))
            .for('update')
            .limit(1);

          if (!portfolio || portfolio.quantity < order.quantity) {
            throw new AppError('BAD_REQUEST', 'Insufficient custody shares available for sell settlement.', 400);
          }

          // Release sell-side custody escrow
          await tx
            .update(portfolios)
            .set({
              lockedQuantity: sql`GREATEST(0, ${portfolios.lockedQuantity} - ${order.quantity})`,
            })
            .where(eq(portfolios.id, portfolio.id));

          // Calculate realized P&L and remaining cost basis
          const sellResult = calculatePortfolioAfterSell({
            existingQuantity: portfolio.quantity,
            existingAveragePriceCents: portfolio.averagePriceCents,
            sellQuantity: order.quantity,
            sellPriceCents: executedPriceCents,
          });

          await tx
            .update(portfolios)
            .set({
              quantity: sellResult.remainingQuantity,
              updatedAt: new Date(),
            })
            .where(eq(portfolios.id, portfolio.id));

          // Post ledger transaction: Debit clearing account, Credit user cash account
          const netProceedsCents = executedGrossCents - feeCents;
          const clearingAcc = await getOrCreateSystemAccount(
            tx,
            'SYS-MARKET-CLEARING',
            order.currency as CurrencyCode
          );
          const receipt = await postLedgerTransaction(tx, {
            category: 'TRADE_SELL',
            description: `Market Sell Fill: ${order.quantity} ${order.symbol} @ ${executedPriceCents} cents (Supervisory Override)`,
            currency: order.currency as CurrencyCode,
            postings: [
              {
                accountId: clearingAcc.id,
                direction: 'DEBIT',
                amountCents: netProceedsCents,
                currency: order.currency as CurrencyCode,
              },
              {
                accountId: account.id,
                direction: 'CREDIT',
                amountCents: netProceedsCents,
                currency: order.currency as CurrencyCode,
              },
            ],
            metadata: {
              orderId: order.id,
              symbol: order.symbol,
              quantity: order.quantity,
              executedPriceCents,
              feeCents,
              realizedPnLCents: sellResult.realizedPnLCents,
            },
          });
          receiptId = receipt.transactionId;
        }

        // Transition order to FILLED
        await tx
          .update(tradeOrders)
          .set({
            status: 'FILLED',
            executedPriceCents,
            executedGrossCents,
            feeCents,
            executedAt: new Date(),
            ledgerTransactionId: receiptId,
          })
          .where(eq(tradeOrders.id, order.id));

        // Update compliance override record
        await tx
          .update(complianceOverrides)
          .set({
            status: 'APPROVED',
            reviewerId: params.complianceOfficerId,
            reviewerRationale: params.rationale,
            reviewedAt: new Date(),
          })
          .where(eq(complianceOverrides.id, override.id));

        await logComplianceDecision(tx, {
          eventType: 'OVERRIDE_APPROVED',
          userId: order.userId,
          operatorId: params.complianceOfficerId,
          ruleEvaluated: 'SUPERVISORY_OVERRIDE_SIGN_OFF',
          decision: 'ALLOW',
          payload: {
            orderId: order.id,
            rationale: params.rationale,
            executionType: 'MARKET_IMMEDIATE_FILL',
            executedPriceCents,
            ledgerTransactionId: receiptId,
          },
        });

        return { success: true, orderStatus: 'FILLED', executedPriceCents };
      } else {
        // LIMIT Order: Transition to OPEN and enter order book
        await tx
          .update(tradeOrders)
          .set({ status: 'OPEN' })
          .where(eq(tradeOrders.id, order.id));

        await tx
          .update(complianceOverrides)
          .set({
            status: 'APPROVED',
            reviewerId: params.complianceOfficerId,
            reviewerRationale: params.rationale,
            reviewedAt: new Date(),
          })
          .where(eq(complianceOverrides.id, override.id));

        // Invoke limit matcher against current market price
        await matchOpenLimitOrdersForSymbol(tx, order.symbol, asset.currentPriceCents);

        await logComplianceDecision(tx, {
          eventType: 'OVERRIDE_APPROVED',
          userId: order.userId,
          operatorId: params.complianceOfficerId,
          ruleEvaluated: 'SUPERVISORY_OVERRIDE_SIGN_OFF',
          decision: 'ALLOW',
          payload: {
            orderId: order.id,
            rationale: params.rationale,
            executionType: 'LIMIT_BOOK_ENTERED',
          },
        });

        return { success: true, orderStatus: 'OPEN' };
      }
    } else {
      // REJECT: Release Escrow (branching on BUY cash vs SELL custody shares)
      if (order.side === 'BUY') {
        const reservedCents = order.totalGrossCents + order.feeCents;
        await tx
          .update(accounts)
          .set({
            lockedBalanceCents: sql`GREATEST(0, ${accounts.lockedBalanceCents} - ${reservedCents})`,
          })
          .where(eq(accounts.id, account.id));
      } else {
        // Unlock sell-side portfolio custody shares
        await tx
          .update(portfolios)
          .set({
            lockedQuantity: sql`GREATEST(0, ${portfolios.lockedQuantity} - ${order.quantity})`,
          })
          .where(and(eq(portfolios.userId, order.userId), eq(portfolios.symbol, order.symbol)));
      }

      await tx
        .update(tradeOrders)
        .set({ status: 'CANCELLED' })
        .where(eq(tradeOrders.id, order.id));

      await tx
        .update(complianceOverrides)
        .set({
          status: 'REJECTED',
          reviewerId: params.complianceOfficerId,
          reviewerRationale: params.rationale,
          reviewedAt: new Date(),
        })
        .where(eq(complianceOverrides.id, override.id));

      await logComplianceDecision(tx, {
        eventType: 'OVERRIDE_REJECTED',
        userId: order.userId,
        operatorId: params.complianceOfficerId,
        ruleEvaluated: 'SUPERVISORY_OVERRIDE_SIGN_OFF',
        decision: 'BLOCK',
        payload: {
          orderId: order.id,
          side: order.side,
          rationale: params.rationale,
        },
      });

      return { success: true, orderStatus: 'CANCELLED' };
    }
  });
}
```

---

## 6. Frontend CRM & Trading UI Architecture

### 6.1 Component Hierarchy Extensions (`apps/web/src/features/crm`)

```
apps/web/src/
├── features/
│   ├── crm/                                # NEW: CRM & Wealth Management Domain Slice
│   │   ├── HouseholdOverviewCard.tsx       # Dynamic net worth aggregate, member roster, role badges
│   │   ├── UboHierarchyDrawer.tsx          # Recursive beneficial ownership tree (FinCEN/BACEN)
│   │   ├── InvestorSuitabilityModal.tsx    # 5-dimension questionnaire, live score meter, risk tier badge
│   │   ├── InteractionTimelineCard.tsx     # Unified temporal stream: trades, transfers, interactions
│   │   ├── LifeEventLoggerModal.tsx        # Milestone modal with automated suitability trigger
│   │   └── useCrmQueries.ts                # React Query hooks for CRM state
│   ├── compliance/                         # NEW: Compliance Officer Review Queue
│   │   ├── ComplianceApprovalQueueModal.tsx# Pending override review table with approve/reject actions
│   │   ├── RestrictedSecuritiesTable.tsx   # Active MNPI / M&A blackout asset management
│   │   └── ComplianceAuditDrawer.tsx       # Cryptographic SHA-256 audit log viewer
│   └── trading/                            # ENHANCED: Pre-Trade Compliance Guardrails
│       ├── TradingView.tsx                 # Injected with pre-trade warning banners & concentration meters
│       └── OrderAttestationModal.tsx       # Soft override digital risk waiver modal
```

### 6.2 Pre-Trade Order Ticket Guardrail Integration

When a trader inputs an order in `TradingView.tsx`:
1. **Live Concentration Preview:** As the user adjusts quantity, a pre-trade badge dynamically displays:
   $$\text{Projected Concentration} = \frac{\text{Current Holding} + (\text{Qty} \times \text{Price})}{\text{Liquid Net Worth}} \times 100\%$$
   If this exceeds the client's tier maximum (e.g. $20\%$), the badge turns **Amber** (`Requires Compliance Sign-Off`).
2. **Restricted Symbol Indicator:** If the selected ticker is in `restrictedSecurities`, the `BUY` button is disabled, replaced with an institutional badge: `Trading Restricted: MNPI/Blackout`.
3. **Soft Attestation Modal:** If the asset is high-volatility and the user is `CONSERVATIVE`, clicking "Place Order" launches `OrderAttestationModal` displaying the mandatory regulatory text before firing the API request with `hasClientAttestation: true`.

---

## 7. Phased Implementation Roadmap

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               PHASED IMPLEMENTATION ROADMAP                                      │
├────────────────────┬─────────────────────────────────────────────────────┬───────────────────────┤
│ PHASE              │ DELIVERABLES & TECHNICAL SCOPE                      │ ACCEPTANCE CRITERIA   │
├────────────────────┼─────────────────────────────────────────────────────┼───────────────────────┤
│ Phase 1:           │ • Drizzle schema migration (`0002_crm_compliance`) │ • Migration applies   │
│ CRM & Compliance   │ • TypeScript shared schemas (`@aegis/shared`)       │   cleanly on Postgres │
│ Database Schemas   │ • Database seed data for households, KYC,           │ • Zod validation for  │
│                    │   suitability profiles, and restricted assets       │   all 10 new tables   │
├────────────────────┼─────────────────────────────────────────────────────┼───────────────────────┤
│ Phase 2:           │ • Pre-Trade Engine (`evaluatePreTradeCompliance`)   │ • 5 gates pass        │
│ Pre-Trade Engine & │ • Fastify routes (`/api/crm/*`, `/api/compliance/*`)│ • Concurrency attacks │
│ Fastify Integration│ • Order escrow locking for pending overrides        │   verify zero double  │
│                    │ • Integration with `postLedgerTransaction.ts`       │   spending in escrow  │
├────────────────────┼─────────────────────────────────────────────────────┼───────────────────────┤
│ Phase 3:           │ • Frontend Household & Suitability Views            │ • Zero UI layout shift│
│ Frontend CRM Views │ • Order ticket concentration meters & modals        │ • 100% WCAG 2.1 AA    │
│ & UI Guardrails    │ • Skeletons for high-density tables                 │ • Bundle size stays   │
│                    │ • Compliance Officer approval queue drawer          │   <135 kB gzip        │
├────────────────────┼─────────────────────────────────────────────────────┼───────────────────────┤
│ Phase 4:           │ • Automated integration concurrency suite           │ • 100% test pass rate │
│ E2E Verification & │ • SEC 17a-4 cryptographic log verification          │ • Zero regressions    │
│ Concurrency Tests  │ • Full Turborepo pipeline validation                │ • Ledger zero-sum ok  │
└────────────────────┴─────────────────────────────────────────────────────┴───────────────────────┘
```

### Detailed Phase Specifications

#### Phase 1: CRM & Compliance Database Schemas
- Apply migration `0002_crm_and_compliance.sql` on the PostgreSQL 17 test container.
- Export Zod schemas in `packages/shared/src/schemas/crm.ts`.
- Seed test records:
  - 1 Household ("Silva Wealth Family Office") with 2 members.
  - 1 Tier 2 Standard KYC profile and 1 Tier 1 Simplified profile.
  - 1 Conservative suitability profile and 1 Balanced Growth profile.
  - 1 Active Restricted Asset (`PETR4` restricted due to `M_AND_A_ADVISORY`).
- **Verification Gate:** `npm run typecheck` passes with zero errors; Drizzle schema matches PostgreSQL introspection.

#### Phase 2: Pre-Trade Engine & Fastify Integration
- Implement `evaluatePreTradeCompliance` in `apps/api/src/modules/trading/compliance-engine.ts`.
- Wire compliance gates into `apps/api/src/modules/trading/routes.ts` (`POST /api/trading/orders`).
- Implement `/api/compliance/overrides` with supervisory `APPROVE` and `REJECT` actions.
- **Verification Gate:** Integration tests verify:
  1. Restricted asset buy orders throw `403 FORBIDDEN`.
  2. Conservative buy order of volatile stock returns `REQUIRES_CLIENT_ATTESTATION`.
  3. Excessive concentration buy order transitions to `PENDING_COMPLIANCE_APPROVAL` with `locked_balance_cents` locked.
  4. Concurrent withdrawal during pending approval is rejected with `422 INSUFFICIENT_FUNDS`.

#### Phase 3: Frontend CRM Views & UI Guardrails
- Create `HouseholdOverviewCard.tsx` and `InvestorSuitabilityModal.tsx`.
- Integrate pre-trade risk warning and soft attestation modal into `TradingView.tsx`.
- Create `ComplianceApprovalQueueModal.tsx` for Compliance Officer roles.
- Ensure all loading states use geometric skeleton rows rather than centered spinners.
- **Verification Gate:** `npm run build` passes with bundle size $< 135\text{ kB}$ gzip; zero console warnings; WCAG 2.2.2 pause control functions cleanly.

#### Phase 4: E2E Verification & Concurrency Stress Testing
- Run complete test suite: `npm run typecheck`, `npm run build`, `npm run test:unit`, `npm run test:integration`, `npm test`.
- Stress test 10 concurrent orders attempting to breach concentration caps simultaneously, verifying that row-level pessimistic locking (`SELECT ... FOR UPDATE`) serializes execution and prevents limit breach.
- Verify that every audit log entry in `compliance_audit_logs` matches its SHA-256 fingerprint.
- **Verification Gate:** 100% test pass rate across all workspace packages with zero regressions.

---

## 8. Conclusion

This architecture plan provides an end-to-end blueprint for embedding institutional Salesforce FSC-inspired CRM capabilities and real-time trading compliance rules directly into AegisFintech.

By anchoring the design in `AGENTS.md`:
1. We deliver **Zone 1 High Engineering Rigor**: Row-level pessimistic locking (`SELECT ... FOR UPDATE`), escrow fund isolation (`locked_balance_cents`), double-entry ledger balance invariants, and immutable cryptographic audit logging.
2. We enforce **Zone 2 Anti-Overengineering Simplicity**: Dynamic SQL views for household net worth, direct Fastify vertical slices, zero duplicate DTOs, and retention of our lean, high-density React 19 + Tailwind CSS v4 frontend stack.
