# SPEC.md — Architectural Contract: Aegis FinTech Study Case

## 1. Consolidated Tech Stack
- **Monorepo:** `Turborepo v2` + `npm workspaces` (`packages/shared`, `apps/api`, `apps/web`)
- **Shared Contracts (`@aegis/shared`):** `TypeScript 5.8` + `Zod` schemas + Integer Cents (`BIGINT` / `number`) utilities
- **Backend (`@aegis/api`):** `Node.js 24` + `Fastify 5` + `Drizzle ORM` + `PostgreSQL 17` + `Vitest`
- **Frontend (`@aegis/web`):** `React 19` + `Vite 6` + `@tanstack/react-query` + `Tailwind CSS v4` + `lucide-react`

## 2. Directory Structure
```text
studies/
├── AGENTS.md
├── SPEC.md
├── turbo.json
├── docker-compose.yml
├── docs/adr/
│   ├── 001-selective-complexity-and-vertical-slices.md
│   ├── 002-double-entry-ledger-and-integer-money.md
│   ├── 003-concurrency-locks-and-idempotency.md
│   └── 004-market-engine-and-order-execution.md
├── packages/shared/
│   └── src/
│       ├── money.ts
│       ├── schemas/
│       └── index.ts
├── apps/api/
│   └── src/
│       ├── config/env.ts
│       ├── core/ (errors.ts, auth.ts, idempotency.ts)
│       ├── db/ (index.ts, schema.ts, seed.ts)
│       ├── domain/
│       │   ├── money/financial-math.ts
│       │   └── ledger/post-ledger-transaction.ts
│       └── modules/
│           ├── auth/
│           ├── accounts/
│           ├── transfers/
│           ├── savings/
│           ├── fx/
│           ├── market/
│           └── trading/
└── apps/web/
    └── src/
        ├── api/client.ts
        ├── components/ (AppShell.tsx, EngineeringXRayDrawer.tsx)
        └── features/ (auth, dashboard, transfers, savings, fx, trading)
```

## 3. Complexity Budget Map
- **Maximum Rigor:**
  - `domain/ledger/post-ledger-transaction.ts`: Double-Entry accounting (`DEBIT` == `CREDIT`), `SELECT ... FOR UPDATE` in sorted `account_id ASC` order, atomic balance updates.
  - `domain/money/financial-math.ts`: Integer minor-unit (`cents`) math, basis points (`bps`), weighted average stock price, compound interest (252 business days).
  - `core/idempotency.ts`: `Idempotency-Key` + SHA-256 request fingerprint inside PostgreSQL.
  - `core/auth.ts`: `scrypt` password hashing, HMAC-SHA256 JWT tokens, anti-IDOR ownership checks.
- **Zero Ceremony (KISS):**
  - Read endpoints (`GET /api/accounts/summary`, `GET /api/accounts/statement`, `GET /api/trading/portfolio`) query Drizzle directly in the vertical slice without pass-through repositories or mappers.
