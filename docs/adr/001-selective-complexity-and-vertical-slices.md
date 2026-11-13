# ADR-001: Pragmatic Vertical Slices + Rich Domain Core (Selective Complexity)

## Status

Accepted

## Context

Traditional enterprise tutorials often apply 6 layers of ceremony (`Controller -> UseCaseInterface -> UseCaseImpl -> DomainService -> RepositoryInterface -> RepositoryImpl -> ORMMapper -> Entity`) to every endpoint—even simple reads or CRUD operations. Conversely, naive CRUD apps put raw `UPDATE accounts SET balance = ...` queries directly inside route handlers without transactional invariants.

## Decision

We adopt a **Pragmatic Modular Monolith** structured around two distinct zones defined in `AGENTS.md`:

1. **Rich Domain Core (`apps/api/src/domain/`):**
   - Pure financial math (`domain/money/financial-math.ts`) with zero I/O dependencies, making it 100% unit-testable in milliseconds.
   - The Atomic Double-Entry Ledger Engine (`domain/ledger/post-ledger-transaction.ts`) that enforces zero-sum accounting and deterministic row-level locking (`SELECT ... FOR UPDATE`).
2. **Vertical Feature Slices (`apps/api/src/modules/*`):**
   - Each domain module (`auth`, `accounts`, `transfers`, `savings`, `fx`, `market`, `trading`) contains its Fastify routes and business orchestration directly.
   - Read queries use Drizzle ORM directly without intermediate repository interfaces or pass-through DTO mappers.
   - Write operations validate inputs with shared `Zod` schemas (`@aegis/shared`), enforce `Idempotency-Key`, and delegate balance mutations to `postLedgerTransaction` inside an ACID database transaction.

## Consequences

- **Positive:** Zero boilerplate files; high readability; strict financial safety where bugs are expensive; fast onboarding.
- **Trade-off:** Drizzle ORM is coupled to the service layer for read queries, which is deliberate because swapping PostgreSQL in a banking ledger is a theoretical rarity (YAGNI).
