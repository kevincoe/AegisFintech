import { sql } from 'drizzle-orm';
import { db, queryClient } from './index.js';

/**
 * Ensures all database tables, constraints, and indexes exist idempotently.
 */
export async function ensureSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(120) NOT NULL,
      email VARCHAR(160) NOT NULL,
      document_number VARCHAR(20) NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);
    CREATE UNIQUE INDEX IF NOT EXISTS users_document_idx ON users (document_number);

    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      account_number VARCHAR(32) NOT NULL,
      currency VARCHAR(3) NOT NULL,
      account_type VARCHAR(24) NOT NULL,
      label VARCHAR(80) NOT NULL,
      balance_cents BIGINT NOT NULL DEFAULT 0,
      locked_balance_cents BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS accounts_number_currency_idx ON accounts (account_number, currency);
    CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts (user_id);

    CREATE TABLE IF NOT EXISTS ledger_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      idempotency_key VARCHAR(128),
      category VARCHAR(32) NOT NULL,
      description VARCHAR(240) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ledger_tx_created_at_idx ON ledger_transactions (created_at);

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      direction VARCHAR(6) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
      amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
      currency VARCHAR(3) NOT NULL,
      balance_after_cents BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries (account_id, created_at);
    CREATE INDEX IF NOT EXISTS ledger_entries_tx_idx ON ledger_entries (transaction_id);

    CREATE TABLE IF NOT EXISTS idempotency_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idempotency_key VARCHAR(128) NOT NULL,
      endpoint VARCHAR(120) NOT NULL,
      request_hash VARCHAR(64) NOT NULL,
      status_code INTEGER NOT NULL,
      response_body JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idempotency_user_key_idx ON idempotency_records (user_id, idempotency_key, endpoint);

    CREATE TABLE IF NOT EXISTS savings_vaults (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      backing_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      name VARCHAR(80) NOT NULL,
      product_type VARCHAR(40) NOT NULL,
      currency VARCHAR(3) NOT NULL,
      annual_rate_bps INTEGER NOT NULL,
      cdi_percentage INTEGER NOT NULL,
      principal_cents BIGINT NOT NULL DEFAULT 0,
      accrued_yield_cents BIGINT NOT NULL DEFAULT 0,
      simulated_days_elapsed INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS savings_vaults_user_idx ON savings_vaults (user_id);

    CREATE TABLE IF NOT EXISTS assets (
      symbol VARCHAR(12) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      sector VARCHAR(60) NOT NULL,
      exchange VARCHAR(16) NOT NULL,
      currency VARCHAR(3) NOT NULL,
      current_price_cents BIGINT NOT NULL,
      open_price_cents BIGINT NOT NULL,
      high_price_cents BIGINT NOT NULL,
      low_price_cents BIGINT NOT NULL,
      volatility_bps INTEGER NOT NULL DEFAULT 120,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS portfolios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol VARCHAR(12) NOT NULL REFERENCES assets(symbol) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL DEFAULT 0,
      locked_quantity INTEGER NOT NULL DEFAULT 0,
      average_price_cents BIGINT NOT NULL DEFAULT 0,
      realized_pnl_cents BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS portfolios_user_symbol_idx ON portfolios (user_id, symbol);

    CREATE TABLE IF NOT EXISTS trade_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol VARCHAR(12) NOT NULL REFERENCES assets(symbol) ON DELETE RESTRICT,
      side VARCHAR(4) NOT NULL,
      order_type VARCHAR(8) NOT NULL,
      quantity INTEGER NOT NULL,
      limit_price_cents BIGINT,
      executed_price_cents BIGINT,
      total_gross_cents BIGINT NOT NULL,
      fee_cents BIGINT NOT NULL,
      currency VARCHAR(3) NOT NULL,
      status VARCHAR(32) NOT NULL,
      ledger_transaction_id UUID REFERENCES ledger_transactions(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      executed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS trade_orders_user_idx ON trade_orders (user_id, created_at);
    CREATE INDEX IF NOT EXISTS trade_orders_open_symbol_idx ON trade_orders (status, symbol);

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
      tier VARCHAR(24) NOT NULL DEFAULT 'TIER_2_STANDARD',
      status VARCHAR(16) NOT NULL DEFAULT 'VERIFIED',
      is_pep BOOLEAN NOT NULL DEFAULT FALSE,
      pep_category VARCHAR(32),
      pep_description TEXT,
      daily_transfer_limit_cents BIGINT NOT NULL DEFAULT 5000000,
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

    CREATE OR REPLACE VIEW view_household_net_worth AS
    WITH member_cash AS (
      SELECT 
        hm.household_id,
        hm.user_id,
        COALESCE(SUM(
          CASE 
            WHEN a.currency = 'BRL' THEN a.balance_cents
            WHEN a.currency = 'USD' THEN (a.balance_cents * 58000) / 10000
            WHEN a.currency = 'EUR' THEN (a.balance_cents * 62500) / 10000
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
  `);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSchema()
    .then(async () => {
      console.log('✅ Database schema applied successfully.');
      await queryClient.end();
    })
    .catch(async (err) => {
      console.error('❌ Failed to apply database schema:', err);
      await queryClient.end();
      process.exit(1);
    });
}
