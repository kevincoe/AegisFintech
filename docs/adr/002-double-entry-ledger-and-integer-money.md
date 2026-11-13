# ADR-002: Double-Entry Bookkeeping & Integer Minor Units (Cents)

## Status

Accepted

## Context

1. **Floating-Point Hazard:** In IEEE 754 floating-point arithmetic, `0.1 + 0.2 === 0.30000000000000004`. Over thousands of transactions, currency conversions, or interest accruals, floating-point rounding drift corrupts account balances.
2. **Single-Entry Mutation Hazard:** Updating an account balance with a standalone `UPDATE accounts SET balance = balance - 100` leaves no self-verifying audit trail of *where* the money went or *where* it came from.

## Decision

1. **Integer Minor Units (`cents`):**
   - Every monetary value in PostgreSQL (`BIGINT`), API payloads (`number` integer cents), and domain math (`bigint` / safe integer cents) is expressed in minor units (`1 BRL = 100 cents`, `R$ 150,25 = 15025`).
   - Percentages and spreads are expressed in **Basis Points (`bps`)**, where `100 bps = 1.00%` and `10_000 bps = 100.00%`.
2. **Double-Entry Ledger Engine:**
   - Every financial movement creates one `ledger_transaction` and at least two `ledger_entries` (`DEBIT` and `CREDIT`).
   - **Fundamental Invariant:** Within any transaction, for every currency involved:
     $$\sum \text{DEBIT}_{\text{currency}} = \sum \text{CREDIT}_{\text{currency}}$$
   - In our customer-centric liability ledger convention:
     - `DEBIT` (`-`): Decreases an account's available balance (outflow from source account).
     - `CREDIT` (`+`): Increases an account's available balance (inflow to destination account).
   - System liquidity accounts (`SYSTEM_TREASURY`, `SYSTEM_FX_POOL`, `SYSTEM_MARKET_CLEARING`) act as the counterparty for initial deposits, bill payments, FX conversions, savings yields, and stock trades so the entire database remains a closed zero-sum accounting loop.

## Consequences

- **Positive:** Mathematically impossible to create or destroy money accidentally; every balance can be reconstructed by summing its `ledger_entries`.
