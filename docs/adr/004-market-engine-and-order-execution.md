# ADR-004: Live Market Simulation, Limit Order Locking & Weighted Average Cost

## Status
Accepted

## Context
A Stock Exchange & FX platform needs realistic market dynamics (live price ticks, Market vs. Limit orders, and accurate Portfolio P&L) while remaining 100% deterministic during automated tests and working offline without paid market data subscriptions.

## Decision
1. **Live Market Engine with Server-Sent Events (SSE):**
   - Assets (`PETR4`, `VALE3`, `ITUB4`, `WEGE3`, `AAPL`, `NVDA`, `IVVB11`) are stored in PostgreSQL and ticked by a bounded random-walk generator (Geometric Brownian Motion step) every 2.5 seconds in development, streaming updates via `GET /api/market/stream` (`text/event-stream`).
2. **Escrow / Locked Balance for Open Limit Orders:**
   - When a user places a `LIMIT BUY` order, we immediately lock `quantity * limit_price + fee` in `accounts.locked_balance_cents` inside a row-locked transaction so the user cannot spend those reserved funds elsewhere.
   - When a user places a `LIMIT SELL` order, we immediately lock `quantity` in `portfolios.locked_quantity` so they cannot sell the same shares twice.
   - Whenever the market price crosses an open limit order's threshold (`market_price <= limit_price` for `BUY`, `market_price >= limit_price` for `SELL`), the Order Matching Engine atomically unlocks the escrow, settles the cash against `SYSTEM_MARKET_CLEARING` via the Double-Entry Ledger, and updates the portfolio.
3. **Weighted Average Price (`Preço Médio`) & Realized P&L:**
   - On `BUY`: New Average Price = $\lfloor \frac{(\text{currentQty} \times \text{currentAvg}) + (\text{buyQty} \times \text{buyPrice}) + \text{fee}}{\text{currentQty} + \text{buyQty}} \rfloor$.
   - On `SELL`: Average Price remains unchanged; Realized P&L increases by $(\text{sellPrice} - \text{currentAvg}) \times \text{sellQty} - \text{fee}$.

## Consequences
- **Positive:** Demonstrates real brokerage accounting (order escrow + settlement + weighted average cost + live SSE streaming) in a self-contained study case.
