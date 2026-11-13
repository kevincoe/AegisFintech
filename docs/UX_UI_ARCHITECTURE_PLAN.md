# AegisFintech: Comprehensive Frontend Architectural Plan
**Document Identifier:** `docs/UX_UI_ARCHITECTURE_PLAN.md`  
**Classification:** Frontend Architecture, Feature Slicing & Engineering Blueprint  
**Status:** Approved Architectural Specification  
**Target Application:** `@aegis/web` (`apps/web`)  
**Core Frameworks:** React 19, Vite 6, Tailwind CSS v4, TanStack Query v5, Lucide React, TypeScript 5.8  
**Constitutional Compliance:** `AGENTS.md` (Selective Complexity Budget: Zone 1 High Engineering & Zone 2 Anti-Overengineering)  

---

## 1. Architectural Vision & Core Objectives

The AegisFintech web application must deliver an institutional-grade, high-density user experience matching the craft of modern leaders (Mercury, TradingView, Wise, Linear) while maintaining complete alignment with the project's engineering constitution in `AGENTS.md`.

### Core Engineering Invariants
1. **Zero-Overengineering (Zone 2 Law):** No generic abstractions, no redundant repository wrappers, no intermediate mappers that simply clone DTOs, and zero heavy third-party UI libraries (no Radix, no Headless UI, no Recharts/Chart.js). All components rely purely on native HTML5 semantics, React 19 hooks, and Tailwind CSS v4.
2. **Absolute Financial Integrity (Zone 1 Law):** All monetary values are processed and stored as integer cents (`BIGINT` or integer `number`). No floating-point arithmetic is permitted in financial calculations.
3. **Pessimistic Double-Entry Alignment:** Because all backend balance mutations execute through atomic Double-Entry Ledger transactions (`sum(DEBITS) === sum(CREDITS)`) with sorted row-level pessimistic locks (`SELECT ... FOR UPDATE`), the frontend strictly avoids reckless optimistic balance updates that could display illusory liquidity to the user.
4. **The "Last Honest Moment" Pattern:** Every money movement, stock trade, and currency exchange requires an explicit, unambiguous two-step confirmation drawer displaying exact minor-unit deductions, credits, fees, and resulting account balances before committing the transaction.

---

## 2. Modular Feature Slicing Blueprint

The current single-file monolith (`apps/web/src/App.tsx`, 2,204 lines) will be systematically decomposed into domain-driven feature slices under `apps/web/src/features/` and shared layout components under `apps/web/src/components/`, fulfilling the architectural contract defined in `SPEC.md:44-49`.

```
apps/web/src/
├── api/
│   └── client.ts                       # Authenticated fetch wrapper, Idempotency generator & X-Ray logger
├── components/
│   ├── AppShell.tsx                    # Header, Navigation Tabs, Demo User Switcher, SSE Status Pill
│   ├── ConfirmationModal.tsx           # Standardized, accessible, focus-trapped 2-step confirmation drawer
│   ├── EngineeringXRayDrawer.tsx       # Interactive ledger audit trail & ADR inspection drawer
│   └── ToastBanner.tsx                 # Accessible toast notification banner (role="status", aria-live)
├── features/
│   ├── auth/                           # Authentication, Login, Register & Session Token Handling
│   │   ├── AuthForm.tsx                # Tabbed Login / Register form with minor-unit balance provisioning
│   │   └── useAuthSession.ts           # Encapsulates ['auth-me'] and session storage logic
│   ├── dashboard/                      # Consolidated Net Worth, Liquidity Hierarchy & Multi-Currency Cards
│   │   ├── NetWorthVerdictCard.tsx     # Consolidated net worth, operational vs near-cash vs escrow split
│   │   ├── AssetAllocationBar.tsx      # SVG/CSS horizontal asset distribution bar (Cash / Vaults / Equities)
│   │   ├── MultiCurrencyWallet.tsx     # Revolut-style multi-currency wallet with active pill switcher
│   │   └── EscrowWatchBanner.tsx       # Live banner displaying escrow funds locked in open limit orders
│   ├── transfers/                      # P2P Instant Transfers, Pix Rails, Recipient Preview & Concurrency Lab
│   │   ├── P2PTransferCard.tsx         # Pre-flight payee lookup, formatted input, quick amount chips
│   │   ├── RecipientPreviewCard.tsx    # Asynchronous payee verification card (Name, Masked CPF, ISPB)
│   │   ├── BillPaymentCard.tsx         # Utility bill barcode payment form with 15-minute clearance badge
│   │   ├── ConcurrencyStressLab.tsx    # Didactic race condition tester & idempotency replay suite
│   │   └── useTransferMutation.ts      # Latched transfer mutation hook preventing double-clicks
│   ├── savings/                        # High-Yield Fixed Income CDB Vaults & Compound Interest Simulator
│   │   ├── SavingsVaultGrid.tsx        # 105% CDI Daily Liquidity Vault cards with accrued yield meters
│   │   ├── VaultDepositModal.tsx       # Deposit / Withdrawal drawer with instant T+0 settlement preview
│   │   └── TimeTravelSimulator.tsx     # Didactic 30-day time-jump controller for yield accrual
│   ├── fx/                             # Foreign Currency Exchange Desk, 30s Quote Lock & BACEN VET
│   │   ├── FxSwapCard.tsx              # Interactive swap card with dual inputs & quick invert button
│   │   ├── FxQuoteTimer.tsx            # 30-second TTL countdown bar & requote transition handler
│   │   ├── FxSlippageSelector.tsx      # Segmented control: Auto (10 bps) vs Custom (1–50 bps)
│   │   ├── FxFeeBreakdown.tsx          # BACEN VET compliant accordion (Spread 100 bps, IOF 110 bps)
│   │   ├── FxLiveRatesBoard.tsx        # Live commercial exchange rate board with tick flash animations
│   │   └── useFxQuoteMachine.ts        # Quote lifecycle state machine (IDLE -> FETCHING -> ACTIVE -> EXPIRED)
│   ├── trading/                        # Stock Terminal, SVG Candlestick Charts, Depth Ladder & Order Ticket
│   │   ├── TradingTerminal.tsx         # Responsive grid container coordinating market data & order ticket
│   │   ├── MarketWatchlist.tsx         # High-density quote table with SVG sparklines & 24h range micro-sliders
│   │   ├── CandlestickChartCard.tsx    # Native SVG candlestick & volume chart with timeframe tabs (1m/5m/1h/1D)
│   │   ├── OrderBookDepth.tsx          # 5-tier Level 2 Bid/Ask depth ladder with cumulative volume bars
│   │   ├── OrderEntryTicket.tsx        # Buy/Sell, Market/Limit ticket with 25/50/75/100% buying power presets
│   │   ├── FatFingerAlertBanner.tsx    # Amber alert for limit price > 5% deviation or > 50% cash allocation
│   │   ├── PortfolioCustodyTable.tsx   # Holdings table: average cost (Preço Médio), realized & unrealized P&L
│   │   ├── OrderHistoryManager.tsx     # Order execution history with 1-click limit order cancellation
│   │   └── StreamConnectionBadge.tsx   # SSE connection status pill with WCAG 2.2.2 pause/resume toggle
│   └── statement/                      # High-Density Transaction Grid, Search, Filter & CSV Export
│       ├── StatementFilterToolbar.tsx  # Search input, date range picker, category & currency filter chips
│       ├── HighDensityStatementTable.tsx # Tabular 36px rows with dual-encoded debit/credit indicators
│       ├── StatementCsvExporter.ts     # Client-side minor-unit CSV generator and download trigger
│       └── TransactionAuditDrawer.tsx  # Slide-over sheet detailing balanced Double-Entry ledger legs
├── App.tsx                             # Thin orchestrator coordinating activeSection, auth, and global queries
├── main.tsx                            # React 19 root with QueryClientProvider
└── index.css                           # Tailwind CSS v4 directives & keyframe price-flash animations
```

---

## 3. Screen Layouts & Visual Hierarchy (ASCII Wireframes)

### 3.1 Banking Dashboard & High-Density Statement Grid

```text
+-----------------------------------------------------------------------------------------------------------------------+
|  🛡️ AEGIS FINTECH   [ Dashboard ] [ Transfers ] [ Savings ] [ FX Desk ] [ Stock Terminal ]   [● Live SSE]  [Alice Santos v]|
+-----------------------------------------------------------------------------------------------------------------------+
|                                                                                                                       |
|  CONSOLIDATED NET WORTH VERDICT (MERCURY-TIER)                                                                        |
|  +-----------------------------------------------------------------------------------------------------------------+  |
|  |  TOTAL CONSOLIDATED NET WORTH                                                                 [ Currency: BRL v ]|  |
|  |  R$ 142.850,00                                                                                                  |  |
|  |  +-----------------------------------------------------------------------------------------------------------+  |  |
|  |  | [■ Checking Cash: 42%]           [■ Fixed-Income Vaults: 38%]         [■ Stock Equities: 20%]            |  |  |
|  |  +-----------------------------------------------------------------------------------------------------------+  |  |
|  |                                                                                                                 |  |
|  |  • Operating Cash (Checking): R$ 60.000,00   • Near-Cash Yield (CDB): R$ 54.250,00   • Equities: R$ 28.600,00    |  |
|  |  • Escrow Reserved (Open Limit Orders): R$ 3.850,00 [View Orders ->]                                            |  |
|  +-----------------------------------------------------------------------------------------------------------------+  |
|                                                                                                                       |
|  MULTI-CURRENCY WALLET (REVOLUT-TIER)                                                                                 |
|  +-----------------------------------------------------------------------------------------------------------------+  |
|  |  [🇧🇷 BRL - Brazilian Real (Active)]        [🇺🇸 USD - US Dollar]                     [🇪🇺 EUR - Euro]             |  |
|  |  Available: R$ 56.150,00                     Available: US$ 2.450,00                  Available: € 1.200,00      |  |
|  |  Escrow:    R$  3.850,00                     Escrow:    US$     0,00                  Escrow:    €     0,00      |  |
|  |  [ + Transfer Pix ] [ ⇄ Convert FX ]        [ + Transfer Wire ] [ ⇄ Convert FX ]     [ + Transfer SEPA ]        |  |
|  +-----------------------------------------------------------------------------------------------------------------+  |
|                                                                                                                       |
|  HIGH-DENSITY STATEMENT & LEDGER EXPLORER (LINEAR-TIER)                                                               |
|  +-----------------------------------------------------------------------------------------------------------------+  |
|  |  [🔍 Search description, counterparty, UUID... ]  [Date: This Month v]  [Type: All v]  [Currency: All v] [📥 CSV] |  |
|  |-----------------------------------------------------------------------------------------------------------------|  |
|  | DATE & TIME      | CATEGORY | DESCRIPTION / COUNTERPARTY           | CURRENCY | AMOUNT         | LEDGER AUDIT      |  |
|  |------------------+----------+--------------------------------------+----------+----------------+-------------------|  |
|  | Nov 13, 14:22:05 | PIX_P2P  | Pix Transfer to Roberto Santos       | BRL      | -R$   250,00 ▼ | [ 2 Legs: Audit ] |  |
|  | Nov 13, 11:05:12 | FX_SWAP  | FX Swap: BRL to USD (1 USD = 5.80)   | BRL      | -R$ 2.500,00 ▼ | [ 4 Legs: Audit ] |  |
|  | Nov 13, 11:05:12 | FX_SWAP  | FX Conversion Credited               | USD      | +US$  421,94 ▲ | [ 4 Legs: Audit ] |  |
|  | Nov 12, 16:40:00 | TRADING  | Limit Buy Fill: 100 PETR4 @ R$ 38,50 | BRL      | -R$ 3.855,78 ▼ | [ 3 Legs: Audit ] |  |
|  | Nov 12, 09:00:00 | YIELD    | CDB Vault Daily Yield (105% CDI)     | BRL      | +R$    18,42 ▲ | [ 2 Legs: Audit ] |  |
|  +-----------------------------------------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------------------------------------+
```

---

### 3.2 P2P Money Movement & Accessible Review Modal

```text
+-----------------------------------------------------------------------------------------------------------------------+
|  💸 INSTANT MONEY MOVEMENT & P2P TRANSFERS                                                                             |
|  Double-Entry ACID Guaranteed • Pre-Flight Identity Verification • Zero Duplicate Debit Protection                   |
+-----------------------------------------------------------------------------------------------------------------------+
|                                                                                                                       |
|  [ LEFT: TRANSFER INITIATION FORM ]                                                                                   |
|  +-----------------------------------------------------------------------------------------------------------------+  |
|  | 1. RECIPIENT IDENTIFIER (PIX KEY / EMAIL / CPF / ACCOUNT NUMBER)                                                |  |
|  | [ bob@aegis.bank                                                                ] [🔍 Auto-Resolving Payee...]   |  |
|  |                                                                                                                 |  |
|  | +-------------------------------------------------------------------------------------------------------------+ |  |
|  | | [✓] VERIFIED COUNTERPARTY (PRE-FLIGHT RESOLUTION)                                                           | |  |
|  | | Name: Roberto "Bob" Santos       • Tax ID: ***.492.108-**                                                   | |  |
|  | | Bank: Aegis Bank S.A. (099)      • Account: Agência 0001 • Conta #1002-8                                    | |  |
|  | +-------------------------------------------------------------------------------------------------------------+ |  |
|  |                                                                                                                 |  |
|  | 2. TRANSFER AMOUNT & CURRENCY                                                                                   |  |
|  | [ Currency: BRL (Brazilian Real) v ]   Available Balance: R$ 56.150,00                                          |  |
|  | [ R$ 250,00                                                                     ] (Parsed: 25000 minor cents)   |  |
|  | Quick Amount Chips: [ +R$ 50 ]  [ +R$ 100 ]  [ +R$ 500 ]  [ +R$ 1.000 ]  [ Max Available ]                      |  |
|  |                                                                                                                 |  |
|  | 3. PAYMENT DESCRIPTION & CLEARING RAIL                                                                          |  |
|  | [ Pix Instant Settlement                                                        ]                               |  |
|  | Rail: ⚡ Banco Central do Brasil (Pix) • Fee: R$ 0,00 (Free) • Settlement: Instant T+0 (< 2 seconds)            |  |
|  |                                                                                                                 |  |
|  | [ Review Transfer Details -> ] (Triggers "Last Honest Moment" Confirmation Drawer)                              |  |
|  +-----------------------------------------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------------------------------------+

                                  ▼ [ Review Transfer Details Clicked ] ▼

+-----------------------------------------------------------------------------------------------------------------------+
|  🛡️ REVIEW TRANSACTION CONTRACT ("THE LAST HONEST MOMENT")                                      [ role="dialog" ]    |
|  Please review and authorize this irreversible Double-Entry transfer.                                                 |
+-----------------------------------------------------------------------------------------------------------------------+
|                                                                                                                       |
|   DEBIT (YOUR ACCOUNT)                               CREDIT (DESTINATION ACCOUNT)                                     |
|   Alice Santos (Checking Account)                    Roberto "Bob" Santos (Verified Payee)                           |
|   Account: #1001-BRL                                 Account: #1002-BRL (Aegis Bank 099)                              |
|   -R$ 250,00                                         +R$ 250,00                                                       |
|   Current Balance: R$ 56.150,00                      Masked Tax ID: ***.492.108-**                                    |
|   Balance After:   R$ 55.900,00                      Cleared via: Instant Pix Rail                                    |
|                                                                                                                       |
|   -----------------------------------------------------------------------------------------------------------------   |
|   • Transfer Amount:    R$ 250,00 (Exact 25,000 minor units)                                                          |
|   • Transfer Network:   Banco Central do Brasil Pix Instant                                                           |
|   • Network Fee:        R$ 0,00 (100% Free)                                                                           |
|   • Ledger Guarantee:   Atomic ACID Transaction (Balanced Debit/Credit)                                               |
|   • Idempotency Latch:  pix-1731451200000-883a (Latched: Double-debit impossible)                                    |
|                                                                                                                       |
|   [ Dismiss / Cancel ]                  [ ⚡ Confirm & Authorize Transfer (R$ 250,00) ] (Latched Submit Button)         |
+-----------------------------------------------------------------------------------------------------------------------+
```

---

### 3.3 Stock Trading Terminal (High-Density Multi-Panel Grid)

```text
+-----------------------------------------------------------------------------------------------------------------------+
|  📈 STOCK TRADING TERMINAL                                                     [● SSE: Live Engine] [Pause Stream ⏸]  |
+-----------------------------------------------------------------------------------------------------------------------+
|  [ LEFT: MARKET WATCHLIST ]        | [ CENTER: CANDLESTICK CHART & DEPTH ]    | [ RIGHT: ORDER ENTRY TICKET ]         |
|  High-Density Tickers & Sparklines | Native SVG Chart & Level 2 Order Book    | Buy/Sell, Guardrails & Cost Breakdown |
|------------------------------------+------------------------------------------+---------------------------------------|
| TICKER | LAST   | 24H DELTA | TRK  | PETR4 • Petrobras PN • B3 (BRL)          | [  BUY (Emerald)  ] [  SELL (Rose)  ] |
|--------+--------+-----------+------| Price: R$ 38,50  ▲ +R$ 1,20 (+3.22%)     |---------------------------------------|
| PETR4  | 38,50  | +3.22% ▲  | ~/\_ | [1m] [5m] [15m] [1h] [1D]    Vol: 14.2M  | [ MARKET ]            [ LIMIT ]       |
| VALE3  | 62,10  | -0.85% ▼  | \_/\ | +--------------------------------------+ | Available Cash: R$ 56.150,00 (BRL)    |
| ITUB4  | 34,80  | +1.15% ▲  | _/~~ | | SVG Candlestick Canvas               | |                                       |
| WEGE3  | 54,20  | +0.45% ▲  | ~\_/ | | High: R$ 38,90 | Low: R$ 37,20       | | Shares Quantity:                      |
| IVVB11 | 312,00 | +0.80% ▲  | __/~ | | ┌┐    ┌┐       ┌┐      [Wicks]       | | [ 100                           ]     |
| AAPL   | 228,50 | -0.40% ▼  | \_/~ | | ││ ┌┐ ││ ┌┐ ┌┐ ││                    | | Quick Presets:                        |
| NVDA   | 135,20 | +4.10% ▲  | _/~~ | | └┘ ││ └┘ ││ ││ └┘                    | | [ 25% ]   [ 50% ]   [ 75% ]  [ 100% ] |
|------------------------------------| |────┴┘────┴┘─┴┘───────────────────────| |                                       |
| 24H Range Slider (PETR4):          | | Volume Bars: █ ▄ █ ▇ █ ▄ █ ▅         | | Limit Price (BRL):                    |
| Low: 37.20 [====●=====] High: 38.90| +--------------------------------------+ | [ 38.00                           ]     |
|                                    |                                          |                                       |
|                                    | 5-TIER LEVEL 2 ORDER BOOK DEPTH          | +-----------------------------------+ |
|                                    | ASKS (SELL)      PRICE   SIZE  CUMUL     | | ⚠️ AGGRESSIVE LIMIT WARNING:      | |
|                                    | [========]       38.65    400  1.150     | | Limit price is 5.2% below market. | |
|                                    | [======]         38.60    250    750     | +-----------------------------------+ |
|                                    | [====]           38.55    200    500     |                                       |
|                                    | [==]             38.52    150    300     | PRE-TRADE COST ESTIMATION:            |
|                                    | [=]              38.50    150    150     | • Gross Notional:     R$ 3.800,00     |
|                                    | ---------------------------------------  | • Brokerage Fee (15bps): -R$    5,70  |
|                                    | SPREAD: R$ 0,02 (5.2 bps)  MID: R$ 38,49 | • Total Cash Required: R$ 3.805,70    |
|                                    | ---------------------------------------  |                                       |
|                                    | BIDS (BUY)       PRICE   SIZE  CUMUL     | [ Review & Submit Buy Order -> ]      |
|                                    | [=]              38.48    180    180     | (Opens Accessible Order Review Sheet) |
|                                    | [=== You: 50🔒=] 38.45    220    400     +---------------------------------------+
|                                    | [=====]          38.40    300    700                                             |
|                                    | [=======]        38.35    250    950                                             |
|                                    | [==========]     38.30    350  1.300                                             |
+------------------------------------+------------------------------------------+---------------------------------------+
```

---

### 3.4 Foreign Currency Exchange (FX Desk) & BACEN VET Calculator

```text
+-----------------------------------------------------------------------------------------------------------------------+
|  🌐 FOREIGN CURRENCY EXCHANGE DESK (FX)                                             [ Live SSE Feed: 🟢 Pulsing ]     |
|  Guaranteed 30s Quote Lock • Slippage Bounded • BACEN VET (Valor Efetivo Total) Transparent Disclosure                |
+-----------------------------------------------------------------------------------------------------------------------+
|                                                                                                                       |
|  [ LEFT PANEL: INTERACTIVE FX SWAP CARD ]                   [ RIGHT PANEL: LIVE COMMERCIAL MARKET BOARD ]             |
|  +-------------------------------------------------------+  +------------------------------------------------------+  |
|  | 1. YOU SEND (SOURCE CURRENCY)                         |  | PAIR    | COMMERCIAL RATE | 24H DELTA | QUICK ACTION |  |
|  | [🇧🇷 BRL - Brazilian Real v]  Available: R$ 56.150,00  |  |---------+-----------------+-----------+--------------|  |
|  | [ 2,500.00                   ] (Integer: 250000 cents)|  | USD/BRL | 5.8000          | +0.12% ▲  | [ Trade -> ] |  |
|  +-------------------------------------------------------+  | EUR/BRL | 6.2500          | -0.08% ▼  | [ Trade -> ] |  |
|                             │                               | EUR/USD | 1.0776          | +0.04% ▲  | [ Trade -> ] |  |
|                   [ ⇄ Quick Invert Pair ]                   +------------------------------------------------------+  |
|                             │                                                                                         |
|  +-------------------------------------------------------+                                                            |
|  | 2. RECIPIENT GETS (TARGET CURRENCY)                   |  SLIPPAGE TOLERANCE SETTINGS:                              |
|  | [🇺🇸 USD - US Dollar v]     Available: US$  2.450,00   |  (•) Auto (10 bps)   ( ) 25 bps   ( ) Custom: [ 15 ] bps   |
|  | [ 421.94                     ] (Integer: 42194 cents) |                                                            |
|  +-------------------------------------------------------+                                                            |
|                                                                                                                       |
|  ⏱️ 30-SECOND GUARANTEED QUOTE LOCK                                                                                   |
|  +-----------------------------------------------------------------------------------------------------------------+  |
|  | Guaranteed Rate: 1 USD = 5.8000 BRL   |   Rate Locks For: [ 22s ▓▓▓▓▓▓▓▓░░░░░░ ] (Auto-Requote on Expire)        |  |
|  +-----------------------------------------------------------------------------------------------------------------+  |
|                                                                                                                       |
|  ℹ️ BANCO CENTRAL DO BRASIL VET & REGULATORY FEE DISCLOSURE                                                           |
|  +-----------------------------------------------------------------------------------------------------------------+  |
|  | • Commercial Mid-Market Rate:        1 USD = 5.8000 BRL                                                         |  |
|  | • Aegis Desk Spread (100 bps / 1.0%): -R$ 25,00                                                                 |  |
|  | • Brazilian IOF Tax (110 bps / 1.1%): -R$ 27,50 (Law 14.286/2021)                                               |  |
|  | • Net Amount Converted:               R$ 2.447,50                                                                |  |
|  | • Valor Efetivo Total (VET):          1 USD = 5.9250 BRL (Total Effective Rate)                                  |  |
|  | • Settlement Speed:                   Instantaneous ACID Double-Entry Ledger Commitment                          |  |
|  +-----------------------------------------------------------------------------------------------------------------+  |
|                                                                                                                       |
|  [ Review & Confirm FX Conversion (R$ 2.500,00 -> US$ 421,94) ] (Opens Side-by-Side Balance Review Drawer)            |
+-----------------------------------------------------------------------------------------------------------------------+
```

---

## 4. State Management & Data Flow Architecture

The state architecture is engineered to guarantee zero data divergence between React's component tree and PostgreSQL's Double-Entry Ledger.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                       TANSTACK QUERY V5 RECONCILIATION ARCHITECTURE                             │
├───────────────────────────────┬───────────────────────────────┬─────────────────────────────────┤
│ CACHE HIERARCHY               │ REAL-TIME SSE PIPELINE        │ MUTATION LIFECYCLE              │
│ • ['auth-me']                 │ Server-Sent Events (2.5s)     │ Synchronous Latched State       │
│ • ['accounts-summary']        │ EventSource('/api/market/str')│ Single Idempotency Key          │
│ • ['accounts-statement']      │ -> setQueryData (Market)      │ Pessimistic Ledger Settlement   │
│ • ['savings-vaults']          │ -> invalidateQueries (Fills)  │ -> refreshAllFinancialData()    │
│ • ['market-assets']           │ -> Throttled ARIA Announcer   │ Toast Notification              │
│ • ['trading-portfolio']       │                               │                                 │
└───────────────────────────────┴───────────────────────────────┴─────────────────────────────────┘
```

### 4.1 TanStack Query v5 Cache Keys & Invalidation Policy
All queries use explicit, immutable array keys:
- `['auth-me']`: User profile, document number, checking account numbers.
- `['accounts-summary']`: Consolidated net worth and per-currency liquidities (`staleTime: 5000`).
- `['accounts-statement', { limit, offset, filter }]`: Filtered transaction ledger history.
- `['savings-vaults']`: Yield vaults, accrued daily yield, simulated elapsed days.
- `['market-assets']`: Listed equities and FX pair quotes (continuously hydrated by SSE).
- `['trading-portfolio']`: Custody positions, Preço Médio, realized/unrealized P&L, recent orders.

#### The Rejection of Optimistic Balance Updates
In generic CRUD applications, optimistic updates improve perceived speed. In **Double-Entry Financial Systems**, optimistic updates are an architectural defect. If the frontend decrements `R$ 250,00` optimistically while PostgreSQL encounters a pessimistic row lock serialization failure or an insufficient funds barrier, the user perceives phantom debits and contradictory balances.
*Architectural Policy:* All mutations (`useTransferMutation`, `useOrderMutation`, `useFxMutation`) execute strictly through pessimistic ledger confirmation. Upon HTTP 200/201 response, `refreshAllFinancialData()` invalidates all affected queries concurrently via `Promise.all`:
```typescript
export const refreshAllFinancialData = (queryClient: QueryClient) => {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['accounts-summary'] }),
    queryClient.invalidateQueries({ queryKey: ['accounts-statement'] }),
    queryClient.invalidateQueries({ queryKey: ['savings-vaults'] }),
    queryClient.invalidateQueries({ queryKey: ['trading-portfolio'] }),
    queryClient.invalidateQueries({ queryKey: ['market-assets'] }),
  ]);
};
```

---

### 4.2 Real-Time SSE Stream Reconciliation & Connection State Machine

The client subscribes to `/api/market/stream` via native `EventSource`. The stream lifecycle is governed by an explicit state machine:

```typescript
export type SseConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'STALE' | 'PAUSED';
```

1. **Reconciliation Logic:**
   - When an asset update arrives, the client calls `queryClient.setQueryData(['market-assets'], ...)`.
   - Transient visual tick flash: The delta between previous price and current price triggers an 800ms CSS animation:
     - Positive change: `bg-emerald-500/20 text-emerald-400`
     - Negative change: `bg-rose-500/20 text-rose-400`
2. **Filled Order Detection:**
   - If `payload.filledOrdersCount > 0`, the market engine has matched an open limit order. The client immediately invokes `refreshAllFinancialData()` and fires an assertive toast notification:
     `"⚡ Market Engine matched 1 open Limit Order! Double-Entry Ledger Settled."`
3. **WCAG 2.2.2 Pause/Resume Toggle:**
   - Users can pause incoming DOM updates. When paused, the `EventSource` message listener buffers incoming ticks in memory without triggering React state updates or DOM repaints. Resuming flushes the latest snapshot immediately.

---

### 4.3 30-Second FX Quote Lock & Slippage State Machine

```typescript
export interface FxQuoteState {
  status: 'IDLE' | 'FETCHING' | 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'SLIPPAGE_BREACH';
  quote: FxQuoteResponse | null;
  ttlSeconds: number;
  quotedRate: number | null;
  maxSlippageBps: number;
}
```

1. **Debounced Fetch (300ms):** When `sourceAmountCents` changes, status moves to `FETCHING`.
2. **Lock Initialization:** Upon receiving quote, status transitions to `ACTIVE`, and a 1000ms `setInterval` decrements `ttlSeconds` from 30 down to 0.
3. **Expiring Transition:** At `ttlSeconds <= 5`, status changes to `EXPIRING_SOON` (amber progress bar).
4. **Expired Transition:** At `ttlSeconds === 0`, status changes to `EXPIRED`. The execution button is disabled and replaced by *"🔄 Refresh Expired Quote"*.
5. **Slippage Enforcement:** Before posting to `/api/fx/exchange`, the client reads the latest live SSE rate for that currency pair. If:
   $$\frac{|\text{Live Rate} - \text{Quoted Rate}|}{\text{Quoted Rate}} \times 10000 > \text{maxSlippageBps}$$
   the modal transitions to `SLIPPAGE_BREACH`, alerting the user of the exact rate movement in basis points and requesting explicit consent.

---

## 5. Component Contracts & Interfaces

### 5.1 Shared Confirmation Modal (`components/ConfirmationModal.tsx`)

```typescript
export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  badgeText?: string;
  badgeType?: 'emerald' | 'amber' | 'sky';
  debitDetails: {
    accountLabel: string;
    accountNumber: string;
    amountCents: number;
    currency: CurrencyCode;
    balanceAfterCents: number;
  };
  creditDetails: {
    accountLabel: string;
    accountNumber: string;
    amountCents: number;
    currency: CurrencyCode;
    balanceAfterCents?: number;
  };
  contractItems: Array<{
    label: string;
    value: string;
    highlight?: boolean;
    mono?: boolean;
  }>;
  idempotencyKey: string;
  isSubmitting: boolean;
  onConfirm: () => Promise<void>;
  confirmButtonText: string;
}
```

---

### 5.2 Stock Order Entry Ticket (`features/trading/OrderEntryTicket.tsx`)

```typescript
export interface OrderEntryTicketProps {
  selectedAsset: MarketAsset;
  availableCashCents: number;
  custodyShares: number;
  onOrderSubmitted: () => void;
}

export interface PreTradeEstimation {
  grossAmountCents: number;
  brokerageFeeCents: number;
  estimatedTotalCents: number;
  deviationPercent: number;
  isDeviated: boolean;
  isHighAllocation: boolean;
}
```

---

### 5.3 FX Swap Card (`features/fx/FxSwapCard.tsx`)

```typescript
export interface FxSwapCardProps {
  availableBalances: Record<CurrencyCode, number>;
  onExchangeCompleted: () => void;
}
```

---

## 6. Accessibility (WCAG 2.1 AA) Implementation Standards

### 6.1 Contrast Tokens
All UI elements must satisfy strict contrast boundaries in accordance with WCAG 2.1 AA:
- **Normal Text (Contrast $\ge$ 4.5:1):**
  - Primary text: `text-white` (`#ffffff` on `#020617` $\rightarrow$ 21:1).
  - Secondary metadata: `text-slate-400` (`#94a3b8` on `#020617` $\rightarrow$ 6.2:1) or `text-slate-300` (`#cbd5e1` on `#020617` $\rightarrow$ 9.8:1).
  - *Deprecated:* `text-slate-500` (`#64748b` on `#020617` $\rightarrow$ 4.1:1, strictly forbidden for body copy).
- **UI Components & Borders (Contrast $\ge$ 3.0:1):**
  - Input borders: `border-slate-700` (`#334155` on `#020617` $\rightarrow$ 3.4:1).
  - Active focus ring: `focus-visible:ring-2 focus-visible:ring-emerald-500` (8.3:1).

### 6.2 Dual-Encoding Utilities
No state may be conveyed by color alone:
```tsx
// Helper component for accessible financial deltas
export function FinancialDeltaBadge({ cents, percent, currency }: Props) {
  const isPositive = cents >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono font-bold ${
        isPositive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
      }`}
      aria-label={`${isPositive ? 'Positive increase' : 'Negative decrease'} of ${formatCents(Math.abs(cents), currency)}`}
    >
      {isPositive ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
      <span>
        {isPositive ? '+' : '-'}{formatCents(Math.abs(cents), currency)} ({percent > 0 ? `+${percent.toFixed(2)}` : percent.toFixed(2)}%)
      </span>
    </span>
  );
}
```

### 6.3 Focus Trapping & Keyboard Invariants
All modal containers must bind an `onKeyDown` handler:
```typescript
export const useDialogKeyboardTrap = (isOpen: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
};
```

---

## 7. Quality Assurance & Verification Matrix

To ensure that the sliced architecture functions flawlessly and adheres strictly to `AGENTS.md` and `SPEC.md`, the following verification criteria are established:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                VERIFICATION & TEST PIPELINE                                     │
├───────────────────────────────┬───────────────────────────────┬─────────────────────────────────┤
│ 1. TYPECHECK INTEGRITY        │ 2. VITE BUILD INTEGRITY       │ 3. CONSTITUTIONAL AUDIT         │
│ `npm run typecheck`           │ `npm run build`               │ Zero external chart bloat       │
│ 0 compiler errors across      │ Clean production bundle       │ Integer minor units only        │
│ @aegis/shared, api & web      │ transformed under 1.5s        │ Pure React 19 + Tailwind v4     │
└───────────────────────────────┴───────────────────────────────┴─────────────────────────────────┘
```

### 7.1 Automated Validation Commands
1. **Monorepo TypeScript Verification:**
   ```bash
   npm run typecheck
   ```
   Must pass across all workspaces (`@aegis/shared`, `@aegis/api`, `@aegis/web`) with zero errors.
2. **Production Bundle Compilation:**
   ```bash
   npm run build
   ```
   Must compile the Vite frontend bundle and API TypeScript bundle with zero warnings or chunk resolution errors.
3. **Domain Math & Concurrency Tests:**
   ```bash
   npm test
   ```
   Must verify that all backend ACID ledger tests, deadlock prevention tests, and integer currency formatting tests pass cleanly.

### 7.2 Constitution Checklist (`AGENTS.md`)
- [x] **Zone 1: Security by Default:** Zod boundary validation on all inputs, anti-IDOR checks, zero exposed tokens.
- [x] **Zone 1: Financial Invariants:** Integer minor units (`BIGINT` or integer cents), Double-Entry zero-sum balance mutations, deterministic row-level locks, single `Idempotency-Key` per lifecycle.
- [x] **Zone 2: Anti-Overengineering (YAGNI):** No generic repositories, no mapper bloat, no intermediate DTO layers.
- [x] **Zone 2: Dependency Economy:** Pure SVG charts (<200 lines TS) without installing external charting libraries.
- [x] **Zone 2: Pragmatic Testing:** Zero tautological mock tests; verification anchored in real financial math and real PostgreSQL ledger invariants.

---

## 8. Summary & Next Steps

This architectural plan establishes the exact blueprint for decomposing the 2,204-line monolithic `apps/web/src/App.tsx` into clean, maintainable, domain-driven feature slices while upgrading the user experience across digital banking, stock market trading, and foreign currency exchange to world-class standards.
