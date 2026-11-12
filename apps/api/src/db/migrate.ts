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
      status VARCHAR(12) NOT NULL,
      ledger_transaction_id UUID REFERENCES ledger_transactions(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      executed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS trade_orders_user_idx ON trade_orders (user_id, created_at);
    CREATE INDEX IF NOT EXISTS trade_orders_open_symbol_idx ON trade_orders (status, symbol);
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
