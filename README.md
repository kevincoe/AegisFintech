# Aegis FinTech — Digital Banking & Stock Market Study Case

A full-stack **Banking & Capital Markets Platform** built as a software engineering and software architecture study case. Designed strictly around the **Selective Complexity Budget (`AGENTS.md`)** and **Spec-Driven Development (`SPEC.md`)**.

---

## 1. What You Will Learn & Practice Here

| Engineering Pillar | Where to Study It in the Codebase |
| :--- | :--- |
| **Double-Entry Bookkeeping (`∑ DEBIT = ∑ CREDIT`)** | [`apps/api/src/domain/ledger/post-ledger-transaction.ts`](./apps/api/src/domain/ledger/post-ledger-transaction.ts) |
| **Integer Minor-Unit Arithmetic (`BIGINT` cents & Basis Points)** | [`packages/shared/src/money.ts`](./packages/shared/src/money.ts) & [`apps/api/src/domain/money/financial-math.ts`](./apps/api/src/domain/money/financial-math.ts) |
| **Concurrency Control (`SELECT ... FOR UPDATE`) & Deadlock Avoidance (`ORDER BY id ASC`)** | [`apps/api/src/domain/ledger/post-ledger-transaction.ts`](./apps/api/src/domain/ledger/post-ledger-transaction.ts) & [`docs/adr/003-concurrency-locks-and-idempotency.md`](./docs/adr/003-concurrency-locks-and-idempotency.md) |
| **Idempotency Keys (`Idempotency-Key` + Transactional Advisory Lock + Payload Hash)** | [`apps/api/src/core/idempotency.ts`](./apps/api/src/core/idempotency.ts) |
| **Stock Order Book Escrow & Weighted Average Cost (`Preço Médio`)** | [`apps/api/src/modules/market/engine.ts`](./apps/api/src/modules/market/engine.ts) & [`apps/api/src/modules/trading/routes.ts`](./apps/api/src/modules/trading/routes.ts) |
| **Real PostgreSQL Concurrency & Race-Condition Attack Tests** | [`apps/api/tests/integration/banking-and-market.integration.test.ts`](./apps/api/tests/integration/banking-and-market.integration.test.ts) |

---

## 2. Quick Start

```bash
# 1. Install dependencies across all workspaces (@aegis/shared, @aegis/api, @aegis/web)
npm install

# 2. Start PostgreSQL 17 via Docker Compose
npm run db:up

# 3. Push schema and seed Demo Users (Alice & Bob) + Stock Market Assets
npm run db:push
npm run db:seed

# 4. Run Unit + Real PostgreSQL Integration & Concurrency Tests
npm test

# 5. Start the API (port 3333) and Web UI (port 5173)
npm run dev
```

### Pre-Seeded Demo Accounts
- **Alice Silva:** `alice@aegis.bank` / `password123` (Account `1001-1`)
- **Bob Santos:** `bob@aegis.bank` / `password123` (Account `1002-9`)
*(You can switch between Alice and Bob with a single click in the top navigation bar!)*
