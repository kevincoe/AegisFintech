# AegisFintech: State-of-the-Art UX/UI Research & Benchmark Analysis

**Document Identifier:** `docs/UX_UI_RESEARCH.md`  
**Classification:** Research, Benchmark Analysis & Interaction Heuristics  
**Status:** Approved Architectural Baseline  
**Target Systems:** Digital Banking Systems, Stock Market Order Execution & Foreign Currency Exchange (FX Desk)  
**Authors:** Principal Software Engineer, Senior Financial UX/UI Specialist & Pragmatic Architect  
**Core Frameworks & Tools:** React 19, Tailwind CSS v4, TanStack Query v5, Lucide React, TypeScript 5.8  

---

## 1. Executive Summary & Problem Space

AegisFintech operates an institutional-grade, ACID-compliant Double-Entry Bookkeeping ledger backend implemented in Node.js 24, Fastify 5, Drizzle ORM, and PostgreSQL 17. The backend strictly guarantees financial invariants: zero-sum balance mutations (`sum(DEBITS) === sum(CREDITS)`), deterministic row-level pessimistic locking (`SELECT ... FOR UPDATE` sorted by `account_id ASC`) to eliminate AB-BA deadlocks, integer minor-unit accounting (`BIGINT` cents), and cryptographic idempotency hashing.

However, the current web client (`apps/web/src/App.tsx`) is structured as an unmodularized **2,204-line monolithic component**. While functioning correctly as a prototype, static audits and UX heuristics reveal severe interaction vulnerabilities, ergonomic friction, and accessibility shortcomings:

1. **Catastrophic Double-Debit Vulnerability:** Transfer submissions generate an `Idempotency-Key` dynamically inside the click handler without latching or button-disabled states (`apps/web/src/App.tsx:365-385`), permitting rapid double-clicks to fire two distinct HTTP requests and double-spend funds.
2. **Zero Pre-Flight Recipient Identity Resolution:** In P2P/Pix transfers, recipient names are resolved only *after* ledger commitment, exposing users to irreversible fund loss from minor typographical mistakes.
3. **Absence of Transaction Confirmation Contracts:** Banking transfers, FX conversions, and stock market orders execute on a single raw click, violating the foundational fintech principle of "The Last Honest Moment".
4. **Data Density & Visualization Deficits:** Market assets are rendered in plain text HTML tables without sparklines, candlestick charts, 24h range sliders, or order book depth ladders. Rates and prices mutate silently without transient visual tick-flashes.
5. **Stateless FX Slippage Exposure:** FX conversions execute at current market rates without a guaranteed rate lock window (30-second TTL), exposing users to live SSE market drift between quote preview and ledger posting.
6. **Accessibility Violations (WCAG 2.1 AA):** Critical text colors fail contrast ratios (`text-slate-500` against `bg-slate-950` yields 4.1:1, failing the 4.5:1 standard); financial direction is conveyed through color alone without dual-encoding; and real-time SSE streaming silently mutates React Query cache without screen-reader live region announcements or a WCAG 2.2.2 pause mechanism.

This research document analyzes industry benchmarks across modern digital banking (Mercury, Revolut, Monzo, Wise, Linear), stock market trading (TradingView, Robinhood, Interactive Brokers, Bloomberg Web, Coinbase Advanced), and currency exchange (Wise, Revolut FX, OANDA, Banco Central do Brasil VET), establishing the empirical foundation for AegisFintech's next-generation user interface.

---

## 2. Industry Benchmark Analysis

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             FINANCIAL UX/UI BENCHMARK ECOSYSTEM                                 │
├───────────────────────────────┬───────────────────────────────┬─────────────────────────────────┤
│ MODERN DIGITAL BANKING        │ STOCK TRADING SYSTEMS         │ FOREIGN CURRENCY EXCHANGE (FX)  │
│ • Mercury (B2B Treasury)      │ • TradingView (Charts)        │ • Wise (Transparent Remittance) │
│ • Revolut (Multi-Currency)    │ • Robinhood (Retail Ergonomics│ • Revolut FX (Interbank Desk)   │
│ • Monzo (Consumer Payments)   │ • IBKR TWS/Portal (Level 2)   │ • OANDA (Institutional Bounds)  │
│ • Wise (Fee Transparency)     │ • Bloomberg Web (Tick Flash)  │ • BACEN VET (Brazil Regulation) │
│ • Linear (Craft & Polish)     │ • Coinbase Advanced (Depth)   │                                 │
└───────────────────────────────┴───────────────────────────────┴─────────────────────────────────┘
```

### 2.1 Modern Digital Banking Systems

#### A. Mercury (The B2B & Treasury Gold Standard)

- **Net Cash Verdict Row:** Mercury avoids fragmented metrics by anchoring the top of the interface with a single authoritative "Net Cash Verdict" in high-contrast tabular typography. It explicitly segregates immediately available operating cash from yielding treasury vaults and escrow-reserved funds.
- **Liquidity Hierarchy Segmentation:** Capital is visually partitioned into three functional tiers:
  1. *Immediate Operational Liquidity:* Checking account funds with zero withdrawal latency.
  2. *Near-Cash Yield Vaults:* Fixed-income CDB/treasury instruments redeemable at T+0 or T+1.
  3. *Escrow-Restricted Capital:* Balances held in escrow for open limit orders, pending clearing, or disputed holds.
- **Linear-Level Craftsmanship:** Mercury utilizes precise micro-interactions: sub-millisecond keyboard shortcuts, mono-spaced tabular numerals (`font-variant-numeric: tabular-nums`), high-density data tables without pagination bloat, and slide-over inspection drawers that maintain background scroll position.

#### B. Revolut (The Multi-Currency & Consumer Pioneer)

- **Multi-Currency Wallet Architecture:** Rather than sprawling three separate account cards across the viewport, Revolut presents a unified multi-currency wallet. A prominent active currency display is paired with interactive pill chips (`[🇧🇷 BRL]`, `[🇺🇸 USD]`, `[🇪🇺 EUR]`) allowing rapid currency switching.
- **Contextual Action Anchors:** Primary actions (`Send`, `Add Money`, `Exchange`, `Details`) remain fixed directly below the active balance, ensuring the user's focus remains aligned with their active currency context.
- **Safety Overlays:** Critical account numbers and sensitive tax IDs are masked by default (`•••• 8821`), revealing details only upon deliberate user interaction or biometric verification.

#### C. Monzo (Frictionless Domestic Rails & Pre-Flight Feedback)

- **Pre-Flight Identity Resolution:** Monzo treats recipient resolution as an asynchronous prerequisite to money movement. Typing a phone number, account number, or email immediately queries the central payment directory (Pay.UK / Confirmation of Payee), displaying the verified legal name of the counterparty before any funds are debited.
- **Immediate Receipt Verification:** Upon transaction completion, Monzo delivers an interactive, downloadable digital receipt displaying the clearing network identifier, exact timestamp to the millisecond, and debit/credit ledger breakdown.

#### D. Wise (The Transparent Fee Benchmark)

- **"The Last Honest Moment" Paradigm:** Wise coined the interaction standard wherein every deduction, fee, tax, and exchange spread is explicitly laid bare before the final authorization click. No financial math is concealed behind "zero-fee" marketing facades.
- **Radical Cost Transparency:** Itemizes transfer fees, intermediate correspondent fees, government levies (e.g. Brazilian IOF tax), and guaranteed delivery timelines.

---

### 2.2 Stock Market Order Execution Systems

#### A. TradingView (Visualization Craft & Lightweight Graphics)

- **Interactive Candlestick Architecture:** TradingView represents the benchmark for charting financial instruments: high/low wicks, open/close rectangular bodies (emerald for upward candles, rose for downward candles), bottom-aligned volume histograms, and high-precision hover crosshairs.
- **Timeframe Granularity:** Rapid switching between interval tabs (`1m`, `5m`, `15m`, `1h`, `1D`) without jarring layout shifts or full-page refreshes.
- **Crosshair Hover Invariants:** Moving across the canvas projects instantaneous Cartesian coordinates onto both axes, displaying precise asset price on the Y-axis and timestamp on the X-axis.

#### B. Robinhood (Retail Ergonomics & Buying Power Integration)

- **Intraday 24h Range Micro-Sliders:** Robinhood condenses market context by displaying a compact horizontal progress slider showing the asset's current price positioned relative to its 24-hour low and 24-hour high.
- **Tactile Buying Power Presets:** Order tickets eliminate manual mental arithmetic by supplying tactical percentage buttons (`25%`, `50%`, `75%`, `100%` of available purchasing power). Clicking `100%` computes the maximum integer shares purchasable, automatically factoring in brokerage fees.
- **Slide-to-Confirm / Two-Tap Friction:** Irreversible market orders cannot be submitted by an inadvertent tap; users are required to execute a deliberate two-step review or vertical swipe gesture.

#### C. Interactive Brokers (IBKR TWS & Portal - High-Density Level 2 Depth)

- **Level 2 Market Depth (DOM Ladder):** IBKR provides professional market transparency through a continuous bid/ask ladder:
  - Top 5 Ask (Sell) tiers stacked in descending order.
  - Top 5 Bid (Buy) tiers stacked in ascending order.
  - Mid-Market Spread row displaying the spread in both minor units and basis points.
- **Cumulative Depth Bars:** Horizontal background bars sized proportionally to cumulative volume at each tier, allowing immediate visual perception of institutional support and resistance zones.
- **Click-to-Trade Integration:** Clicking any price level in the depth ladder instantly populates the limit price field of the active order ticket.

#### D. Bloomberg Web & Terminal (Tick Flashing & Information Hierarchy)

- **Sub-Second Tick Flashing:** In active trading markets, numbers do not simply change; they flash. When an asset's price increases, the table cell or quote card flashes emerald green (`bg-emerald-500/20`) for 800ms before smoothly transitioning back to neutral slate. Downward ticks flash crimson rose (`bg-rose-500/20`). This directs visual attention immediately to market momentum.
- **High Data Density:** Rows are compressed to 32px–36px heights with tabular monospace typography, displaying symbol, company name, currency, bid, ask, last, 24h delta, and volume without horizontal scrolling.

#### E. Coinbase Advanced (Modern Crypto & Equities Hybrid)

- **Connection Health State Pill:** Real-time financial applications must explicitly report WebSocket/SSE connection health. Coinbase displays a prominent pulsing badge: `Live` (green pulse), `Reconnecting` (amber spin), or `Stale/Disconnected` (red alert).
- **Embedded Escrow Markers:** Active limit orders placed by the user are highlighted directly on the order book ladder with an unmistakable marker (`You: 100 shares 🔒`), indicating their position in the queue.

---

### 2.3 Foreign Currency Exchange (FX Desk) Systems

#### A. Wise & Revolut FX (Dual Synchronization & Interactive Calculators)

- **Synchronized Dual-Input Calculator:** In modern FX, users think in two distinct modalities:
  1. *Source-Centric:* "I have R$ 5.000,00 to spend; how many US Dollars do I receive?"
  2. *Target-Centric:* "I need exactly US$ 1.000,00 to pay an invoice; how many Reais must I convert?"
- **Single-Click Pair Inversion:** A tactile `[ ⇄ ]` button instantly flips source and target currencies, recalculating all spreads and inverted rates (`1 USD = 5.8000 BRL` becomes `1 BRL = 0.1724 USD`) without clearing user inputs.

#### B. Guaranteed Quote Locking (Wise / OANDA Benchmark)

- **The Stale Execution Threat:** Because foreign currency rates fluctuate continuously (in AegisFintech, the backend market engine nudges rates by up to ±20 bps every 2.5 seconds), executing an exchange against an uncommitted rate creates significant financial slippage.
- **30-Second Rate Lock Window:** When a user requests a quote, the system locks that commercial rate and spread for exactly 30 seconds, indicated by a depleting linear or circular progress timer (`Expires in: 24s ▓▓▓▓▓▓▓▓░░`).
- **State Transition to Requote:** If the countdown reaches zero, the action button immediately shifts from *"Review & Confirm"* to *"🔄 Rate Expired — Refresh Quote"*, blocking stale executions.

#### C. Institutional Slippage Bounds (OANDA / FXCM Benchmark)

- **Configurable Slippage Tolerance:** Professional FX desks allow users to establish maximum acceptable rate drift in basis points:
  - `Auto`: Default tight bound (10 bps).
  - `Custom`: User-defined bound (1 to 50 bps).
- If the live execution rate at settlement exceeds this threshold, the transaction is rejected, and a requote confirmation is required.

#### D. Brazilian BACEN VET Compliance (Banco Central do Brasil)

- **VET (Valor Efetivo Total):** Brazilian financial regulations mandate that all foreign exchange transactions disclose the Total Effective Value per currency unit:
  $$\text{VET} = \frac{\text{Total Source Currency Expended (including fees and taxes)}}{\text{Net Foreign Currency Acquired}}$$
- **Progressive Fee Disclosure:** The interface must explicitly itemize:
  1. *Commercial Mid-Market Exchange Rate* (e.g. `1 USD = 5.8000 BRL`).
  2. *Aegis Desk Spread* (e.g. 100 bps / 1.00%, deducted from source).
  3. *IOF Tax (Imposto sobre Operações Financeiras)* (mandated at 110 bps / 1.10% for transfers between accounts of the same titularity).
  4. *Net Converted Amount* and *Effective Rate (VET)*.

---

### 2.4 Comprehensive Benchmarking Matrix

| Feature Dimension | Modern Digital Banking (Mercury / Wise / Monzo) | Stock Market Trading (TradingView / Robinhood / IBKR) | FX Currency Desk (Wise / Revolut FX / OANDA) | Current AegisFintech (`apps/web`) | Target AegisFintech Architecture |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Component Layout** | Modular domain feature directories | Modular tiled panels & widgets | Standalone swap card & rate board | Monolithic 2,204-line `App.tsx` | Domain slices under `src/features/` with thin App shell |
| **Data Density** | High-density tables, tabular numbers, slide-over sheets | Ultra-dense Level 2 ladders, compact tick rows | Dual synced inputs, expandable fee accordions | Mixed-density unfilterable tables, inline accordions | Compact 36px tables, tabular mono fonts, slide-over inspection drawers |
| **Data Visualization** | Asset allocation bars, liquidity tier charts | Native SVG candlesticks, sparklines, 24h range bars | Live commercial rate tickers, countdown progress rings | None (raw unadorned text numbers) | Native SVG charts (<200 lines TS), 24h range sliders, depth ladders |
| **Real-Time Feedback** | Instant balance push, optimistic receipt | Keyframe tick flash (green/red), Level 2 depth changes | Active countdown timer (30s), live rate updates | Static text re-render on SSE push | CSS keyframe background flash (`bg-emerald-500/20`), SSE status pill |
| **Error Prevention** | Latched submit button, pre-flight payee lookup | Fat-finger limit alerts (>5%), large order warnings | 30s quote lock, auto/custom slippage bounds | Unlatched button, single-click POST, no payee check | Single idempotency key per modal, 2-tap confirmation, guardrails |
| **Confirmation Pattern** | "Last Honest Moment" 2-step review modal | Plain-English recap drawer, slide-to-confirm | Side-by-side debit/credit balance review | Zero review step (direct immediate HTTP POST) | Standardized accessible confirmation drawer across all 3 modules |
| **Regulatory / Fee Math** | Itemized rails, free internal transfers | 15 bps brokerage fee itemized upfront | BACEN VET breakdown, 100 bps spread, 110 bps IOF | Spread & IOF partially displayed, brokerage fee hidden | Full VET disclosure, pre-trade fee calculation, minor-unit integer math |
| **Accessibility (WCAG)** | WCAG 2.1 AA certified, ARIA live regions | High contrast themes, stream pause controls | Accessible forms, screen-reader tax summaries | Failing text contrast (4.1:1), color-only cues, no ARIA live | 6.2:1+ contrast, dual-encoding (▲/▼, +/-), throttled ARIA announcer, pause toggle |

---

## 3. Financial Error Prevention & Usability Heuristics

High-stakes financial systems cannot treat user errors as mere client-side validation failures. When real capital is committed to an immutable Double-Entry Ledger, every user error risks irreversible financial harm, operational disputes, and legal liabilities. We map Jakob Nielsen's 10 Usability Heuristics directly to AegisFintech's financial interactions:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          HEURISTIC-DRIVEN FINANCIAL ERROR DEFENSE                               │
├───────────────────────────────┬───────────────────────────────┬─────────────────────────────────┤
│ 1. DOUBLE-DEBIT LATCHING      │ 2. PRE-FLIGHT VERIFICATION    │ 3. FAT-FINGER GUARDRAILS        │
│ Idempotency key generated on  │ Payee name & masked CPF       │ Limit price deviation alerts    │
│ modal open; button latched    │ resolved before debit         │ and large notional warnings     │
├───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ 4. GUARANTEED RATE LOCKING    │ 5. "LAST HONEST MOMENT"       │ 6. STREAM HEALTH & PAUSE        │
│ 30s TTL timer; execution      │ Two-step contract review      │ SSE status pill and WCAG 2.2.2  │
│ halted upon expiration        │ before ledger commit          │ live stream pause toggle        │
└───────────────────────────────┴───────────────────────────────┴─────────────────────────────────┘
```

### 3.1 The Double-Debit Latching Failure Mode

#### Root Cause Analysis in Existing Codebase

In `apps/web/src/App.tsx:365-385`, the P2P transfer submission handler is implemented as follows:

```typescript
const handleP2PTransfer = async (e: React.FormEvent) => {
  e.preventDefault();
  try {
    const amountCents = parseDecimalToCents(transferAmountStr);
    const key = generateIdempotencyKey('pix'); // <-- FATAL FLAW: Generated inside callback!
    const payload = {
      recipientIdentifier: recipientInput,
      currency: transferCurrency,
      amountCents,
      description: transferDesc,
    };
    setLastTransferRecord({ key, payload });

    const res = await apiRequest<{ ... }>('/api/transfers/p2p', {
      method: 'POST',
      body: payload,
      idempotencyKey: key, // <-- Different key per rapid click!
    });
    // ...
  } catch (err) { ... }
};
```

Furthermore, the submit button is rendered without a disabled condition:

```tsx
<button type="submit" className="...">
  Send Instant Transfer
</button>
```

#### The Concurrency Exploit

1. A user enters `R$ 500,00` and clicks the submit button twice within 150 milliseconds (a common reflex on slow mobile networks or unresponsive devices).
2. Click #1 executes `handleP2PTransfer`, generating key `pix-1731451200000-abc1`.
3. Click #2 executes `handleP2PTransfer` concurrently, generating key `pix-1731451200150-def2`.
4. Two concurrent HTTP POST requests arrive at the Fastify backend with *different* idempotency keys.
5. In `apps/api/src/core/idempotency.ts`, each request checks `SELECT * FROM idempotency_keys WHERE key = $1`. Because both keys are unique, both requests acquire separate row locks, pass balance verification, and execute two distinct Double-Entry transactions.
6. The user is debited `R$ 1.000,00` instead of `R$ 500,00`.

#### The Architectural Solution: Latched State Machine

1. **Single Key Generation per Review Lifecycle:** The `Idempotency-Key` must be generated when the user opens the confirmation drawer—*never* inside the execution click handler.
2. **Synchronous Button Latching:** The moment the user clicks "Confirm & Send", the client synchronously sets `isSubmitting = true`. The button receives `disabled={isSubmitting}`, sets `aria-busy="true"`, renders an animated spinner (`RefreshCw className="animate-spin"`), and replaces the label with `"Authorizing Ledger Posting..."`.
3. **Form Freeze:** All input fields are rendered `readOnly` or `disabled` until the mutation either settles or is explicitly dismissed.

---

### 3.2 Asynchronous Pre-Flight Recipient Identity Resolution

#### The Problem of Blind Transfers

In the current implementation, a user enters an arbitrary string (`recipientInput = 'bob@aegis.bank'`) and submits. The backend attempts to find the recipient in `apps/api/src/modules/transfers/routes.ts:60-70`. If the user mistypes a single character (e.g. `bob1@aegis.bank`), the transfer either crashes with an unhelpful 404/422 error or, far worse, transfers money to an unintended registered user with no possibility of automated reversal.

#### The Pre-Flight Interaction Pattern

Borrowing from the Brazilian Pix DICT (Diretório de Identificadores de Contas Transacionais) and UK Confirmation of Payee standards:

1. **Debounced Lookup (300ms):** As the user enters an email, CPF, or account number, a debounced query checks format and queries `GET /api/transfers/recipient-preview?identifier={input}&currency={currency}`.
2. **Verified Payee Identity Card:** The UI transitions from empty to an unambiguous verification state:
   - Verified Legal Name in bold (e.g. `Roberto Santos`).
   - Masked Tax ID / CPF (e.g. `***.492.108-**`).
   - Financial Institution (e.g. `Aegis Bank S.A. (ISPB: 099)`).
   - Account Number (e.g. `Agência 0001 • Conta 1002-8`).
   - Verification Badge: An emerald `CheckCircle2` icon with text `"Verified Counterparty"`.
3. **Negative State Barrier:** If the identifier cannot be resolved, the card renders an amber alert: `"Unregistered Recipient — Review identifier to prevent lost funds"`, and strictly disables the transfer initiation button.

---

### 3.3 Trading Fat-Finger Safeguards & Buying Power Guardrails

In stock market trading, typing errors ("fat-finger" errors) have historically triggered major market anomalies. AegisFintech introduces two distinct client-side guardrails:

#### Guardrail 1: Out-of-Market Limit Deviation Warnings

- **Trigger:** When placing a `LIMIT` order, the user's `limitPriceStr` is compared against `currentPriceCents`:
  - For `BUY` orders: $\text{Deviation} = \frac{\text{Limit Price} - \text{Market Price}}{\text{Market Price}} \times 100$
  - For `SELL` orders: $\text{Deviation} = \frac{\text{Market Price} - \text{Limit Price}}{\text{Market Price}} \times 100$
- **Amber Warning Threshold (> 5%):** If a user sets a Limit Buy > 5% above the market price (or Limit Sell > 5% below), the order entry ticket immediately renders an amber caution card:
  > ⚠️ **Aggressive Price Deviation Warning:** Your limit price ($42.00) is **9.1% higher** than the market price ($38.50). Because your price exceeds the best ask, this order will fill immediately as an aggressive market order.
- **Red Barrier Threshold (> 20%):** If the limit price deviates by > 20%, the standard submit button is locked, requiring the user to explicitly tick a checkbox: `[x] I understand this order deviates significantly from market price`.

#### Guardrail 2: Large Capital Concentration Warning

- **Trigger:** If the estimated total required cash for a buy order exceeds **50% of the user's total available cash** in that currency:
  > ⚠️ **High Allocation Notice:** This trade commits **68.4%** of your total available BRL cash (`R$ 8.520,00` of `R$ 12.450,00`).

#### Guardrail 3: Buying Power Percentage Presets

Tactile percentage buttons (`25%`, `50%`, `75%`, `100%`) eliminate division mistakes:

- For `BUY`:
  $$\text{Max Shares} = \left\lfloor \frac{\text{Available Cents} \times \text{Percent}}{\text{Price Cents} \times \left(1 + \frac{15}{10000}\right)} \right\rfloor$$
  where $\frac{15}{10000}$ accounts for the 15 bps brokerage fee.
- For `SELL`:
  $$\text{Max Shares} = \lfloor \text{Available Custody Quantity} \times \text{Percent} \rfloor$$

---

### 3.4 FX Guaranteed Quote Locking & Dynamic Slippage Bounds

#### The 30-Second Quote State Machine

To guarantee rate certainty while respecting the backend's continuous Brownian motion rate nudging, the FX Desk implements a client-side state machine:

```
┌─────────┐   Keystroke   ┌────────────┐   Quote Arrived   ┌──────────┐
│  IDLE   │ ────────────► │  FETCHING  │ ────────────────► │  ACTIVE  │ (30s Countdown)
└─────────┘               └────────────┘                   └────┬─────┘
                                                                │
                                                         TTL <= 5s
                                                                ▼
┌─────────┐            Requote Click                       ┌──────────┐
│ EXPIRED │ ◄───────────────────────────────────────────── │ EXPIRING │ (Amber Pulse)
└────┬────┘                  TTL === 0s                    └──────────┘
     │
     └────────────────► Returns to FETCHING
```

1. **Active State:** The quote remains locked for 30 seconds. A progress track depletes from 100% to 0%.
2. **Expiring State (Last 5 seconds):** The progress bar turns amber, and an animated pulse indicates impending expiration.
3. **Expired State:** The timer reaches 0s. The action button changes to *"🔄 Rate Expired — Refresh Quote"*, and the previous target amount is dimmed. Clicking refresh issues a new `POST /api/fx/quote`.
4. **Slippage Bounds Check:** The user can toggle between `Auto (10 bps)` and `Custom (1–50 bps)`. When confirming the exchange, if the live SSE commercial rate has moved against the quoted rate by more than the tolerance, the execution is paused with an alert prompting acceptance of the new rate.

---

## 4. Unambiguous Transaction Confirmation Patterns

The foundational principle of fintech UX is **"The Last Honest Moment"**: the interaction boundary where the application presents the exact, binding financial contract to the user, allowing them to verify every parameter before immutable state mutation.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 THE "LAST HONEST MOMENT" CONFIRMATION DRAWER                │
├─────────────────────────────────────────────────────────────────────────────┤
│  DEBIT (Source Wallet)                    CREDIT (Destination / Asset)     │
│  Account: #1001-BRL (Alice Checking)      Account: #1002-BRL (Bob Santos)   │
│  Amount:  -R$ 250,00                      Amount:  +R$ 250,00               │
│  Balance After: R$ 24.750,00              Balance After: [Counterparty]     │
├─────────────────────────────────────────────────────────────────────────────┤
│  TRANSACTION DETAILS:                                                       │
│  • Clearing Rail: Pix Instant (Double-Entry Ledger Settled)                 │
│  • Transfer Fee:  R$ 0,00 (Free)                                            │
│  • Settlement:    Immediate (T+0, < 1 second)                               │
│  • Protection:    Idempotency-Key pix-1731451200000-883a (Latched)          │
├─────────────────────────────────────────────────────────────────────────────┤
│  [ Cancel / Return ]                 [ ⚡ Authorize & Send R$ 250,00 ]      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Two-Step Review Drawers vs Disruptive Full-Page Modals

- **Spatial Continuity:** Full-page redirects disorient users and break context. In contrast, accessible slide-over drawers (or centered non-disruptive dialogs with backdrop blur) maintain spatial awareness by preserving the user's view of the originating screen behind a dark overlay (`bg-slate-950/80 backdrop-blur-xs`).
- **Focus Management:** Upon opening, keyboard focus is trapped within the drawer. Pressing `Escape` or clicking the backdrop dismisses the review without submitting.

### 4.2 Integer Minor-Unit Formatting Invariants

Floating-point arithmetic in JavaScript (`0.1 + 0.2 === 0.30000000000000004`) is strictly forbidden in financial interfaces.

- **In-Memory Representation:** All monetary values are transported and stored as integer cents (`BIGINT` or integer `number`).
- **Display Representation:** Formatters must use localized minor units via `@aegis/shared`:
  - Brazilian Real: `formatCents(25000, 'BRL')` $\rightarrow$ `R$ 250,00`
  - US Dollar: `formatCents(22850, 'USD')` $\rightarrow$ `US$ 228.50`
  - Euro: `formatCents(10000, 'EUR')` $\rightarrow$ `€ 100,00`
- **Decimal Parsing:** User inputs are parsed via `parseDecimalToCents(str)` using clean integer multiplication, completely eliminating floating-point rounding errors.

### 4.3 Side-by-Side Double-Entry Balance Preview

Every confirmation drawer presents a dual-column ledger audit preview:

- **Debit Side:** Sender Account Number, Currency, Exact Debit Amount (prefixed with `-`), and Resulting Balance After Debit.
- **Credit Side:** Destination Account Number, Counterparty Name, Exact Credit Amount (prefixed with `+`), and Resulting Balance After Credit.
- **Audit Verification:** Proves to the user that total debits equal total credits, reinforcing trust in the system's ledger integrity.

---

## 5. High-Density Financial Data Visualization (Zero-Bloat)

In accordance with `AGENTS.md` Zone 2 (Dependency Economy and Anti-Overengineering Laws), importing heavy multi-megabyte charting libraries (e.g. `chart.js`, `recharts`, `lightweight-charts`) for standard micro-charts is strictly prohibited. Lean, accessible, responsive SVG components can be authored directly in pure React 19 and Tailwind CSS v4 in under 200 lines of code.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                      HIGH-DENSITY NATIVE SVG DATA VISUALIZATION ENGINE                          │
├───────────────────────────────┬───────────────────────────────┬─────────────────────────────────┤
│ 1. NATIVE SVG CANDLESTICK     │ 2. INLINE SVG SPARKLINES      │ 3. 5-TIER DEPTH LADDER          │
│ High/Low wicks, Open/Close    │ Intraday trajectory paths,    │ Cumulative volume depth bars,   │
│ emerald/rose candle bodies,   │ normalized min/max bounds,    │ mid-market spread indicator,    │
│ bottom volume histograms      │ zero bundle bloat             │ user order pinning (You: 50🔒)  │
└───────────────────────────────┴───────────────────────────────┴─────────────────────────────────┘
```

### 5.1 Native SVG Candlestick & Volume Micro-Chart

#### Geometric Model

A candlestick is defined by four core price points: Open ($O$), High ($H$), Low ($L$), and Close ($C$).
Given an SVG canvas of width $W$ and height $H_{\text{chart}}$, and minimum price $P_{\min}$ and maximum price $P_{\max}$:

1. **Vertical Coordinate Transform:**
   $$y(P) = H_{\text{chart}} - \left( \frac{P - P_{\min}}{P_{\max} - P_{\min}} \right) \times H_{\text{chart}}$$
2. **Wick Geometry:** A 1-pixel vertical line spanning from $(x_{\text{center}}, y(H))$ to $(x_{\text{center}}, y(L))$.
3. **Candle Body Geometry:** A rectangle spanning horizontally from $x_{\text{center}} - \frac{w_{\text{candle}}}{2}$ with width $w_{\text{candle}}$, and vertically from $\min(y(O), y(C))$ with height $\max(|y(C) - y(O)|, 2)$ (ensuring doji candles maintain a visible 2px bar).
4. **Color Dual-Encoding:**
   - Bullish candle ($C \ge O$): `fill-emerald-400 stroke-emerald-500`
   - Bearish candle ($C < O$): `fill-rose-400 stroke-rose-500`
5. **Volume Sub-Panel:** A bottom-aligned volume histogram occupying the lower 25% of the canvas height, where bar height is normalized to maximum trading volume.

#### Zero-Bloat Candlestick SVG Implementation Pattern

```tsx
export function NativeCandlestickChart({ candles, width = 600, height = 280 }: Props) {
  const minPrice = Math.min(...candles.map(c => c.lowCents));
  const maxPrice = Math.max(...candles.map(c => c.highCents)) || minPrice + 1;
  const candleWidth = Math.max(4, Math.floor((width - 40) / candles.length) - 3);

  const getY = (priceCents: number) =>
    height - 30 - ((priceCents - minPrice) / (maxPrice - minPrice)) * (height - 60);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none">
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((pct) => (
        <line
          key={pct}
          x1={0}
          y1={height * pct}
          x2={width}
          y2={height * pct}
          className="stroke-slate-800/60"
          strokeDasharray="4 4"
        />
      ))}
      {/* Candles */}
      {candles.map((c, i) => {
        const x = 20 + i * (candleWidth + 3);
        const isUp = c.closeCents >= c.openCents;
        const color = isUp ? '#34d399' : '#fb7185';
        const bodyY = Math.min(getY(c.openCents), getY(c.closeCents));
        const bodyHeight = Math.max(2, Math.abs(getY(c.closeCents) - getY(c.openCents)));

        return (
          <g key={c.timestamp} className="transition-all hover:opacity-80">
            {/* Wick */}
            <line x1={x + candleWidth / 2} y1={getY(c.highCents)} x2={x + candleWidth / 2} y2={getY(c.lowCents)} stroke={color} strokeWidth={1.5} />
            {/* Body */}
            <rect x={x} y={bodyY} width={candleWidth} height={bodyHeight} fill={color} rx={1} />
          </g>
        );
      })}
    </svg>
  );
}
```

---

### 5.2 Native SVG Sparklines

For high-density tables (watchlist rows, asset allocation summaries), a 60px $\times$ 20px inline sparkline provides instant historical trajectory without slowing DOM rendering.

- Points are mapped to an SVG `<path d="M x0 y0 L x1 y1 ...">`.
- Gradients are applied via `<linearGradient>` with subtle vertical fade, giving polish comparable to Linear and TradingView.

---

### 5.3 5-Tier Order Book Depth Ladder

```text
+-------------------------------------------------------------------------+
| ASKS (SELL ORDERS)                     PRICE (BRL)    SIZE    CUMULATIVE|
| [====================================]   38.65         400        1,150 |
| [===========================]            38.60         250          750 |
| [=================]                      38.55         200          500 |
| [=============]                          38.52         150          300 |
| [======]                                 38.50         150          150 |
+-------------------------------------------------------------------------+
| SPREAD: R$ 0,02 (5.2 bps)               MID-MARKET: R$ 38,49            |
+-------------------------------------------------------------------------+
| BIDS (BUY ORDERS)                      PRICE (BRL)    SIZE    CUMULATIVE|
| [=======]                                38.48         180          180 |
| [============== You: 50🔒 ==]            38.45         220          400 |
| [====================]                   38.40         300          700 |
| [===========================]            38.35         250          950 |
| [====================================]   38.30         350        1,300 |
+-------------------------------------------------------------------------+
```

1. **Mid-Market Spread:** Displays the numerical difference between the lowest ask and highest bid (`Spread: R$ 0,02 (5 bps)`).
2. **Proportional Depth Bars:** Behind each row, a semi-transparent colored bar (`bg-rose-500/15` for asks, `bg-emerald-500/15` for bids) expands horizontally based on cumulative volume relative to total depth.
3. **Interactive Click-to-Fill:** Clicking any price level instantly populates the order ticket's limit price input.
4. **User Order Pinning:** Any active limit order belonging to the logged-in user is tagged with an amber badge (`You: 50🔒`), displaying queue position.

---

### 5.4 Multi-Currency Liquidity Hierarchy & Asset Allocation Bar

To solve the lack of visual liquidity categorization on the main dashboard, AegisFintech adopts a dual visualizer:

1. **Asset Allocation Distribution Track:** A multi-colored segmented horizontal bar:

   ```tsx
   <div className="h-2 w-full flex rounded-full overflow-hidden bg-slate-800 mt-3" role="progressbar" aria-label="Asset Allocation">
     <div style={{ width: `${checkingPct}%` }} className="bg-emerald-400 transition-all duration-500" title={`Checking Cash: ${checkingPct}%`} />
     <div style={{ width: `${savingsPct}%` }} className="bg-amber-400 transition-all duration-500" title={`Yield Vaults: ${savingsPct}%`} />
     <div style={{ width: `${stocksPct}%` }} className="bg-sky-400 transition-all duration-500" title={`Equities: ${stocksPct}%`} />
   </div>
   ```

2. **Liquidity Hierarchy Metrics:**
   - *Operating Cash (Checking)*: Liquid funds available for immediate Pix and settlement.
   - *Near-Cash Yield (CDB Vaults)*: Earning 105% CDI daily yield, redeemable at T+0.
   - *Escrow Capital*: Reserved for open limit orders.

---

## 6. Accessibility (WCAG 2.1 AA) in Financial Systems

Financial interfaces carry a legal and ethical mandate to be accessible to all individuals, including those with visual, motor, or cognitive impairments. AegisFintech targets full **WCAG 2.1 AA** compliance.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           WCAG 2.1 AA FINANCIAL COMPLIANCE PILLARS                              │
├───────────────────────────────┬───────────────────────────────┬─────────────────────────────────┤
│ 1. COLOR INDEPENDENCE         │ 2. CONTRAST REMEDIATION       │ 3. FOCUS MANAGEMENT             │
│ Dual-encoding: symbols (+/-), │ Normal text >= 4.5:1          │ role="dialog", focus trapping,  │
│ glyphs (▲/▼), sr-only prefixes│ UI components >= 3:1          │ Escape listener, restore focus  │
├───────────────────────────────┼───────────────────────────────┼─────────────────────────────────┤
│ 4. STREAM MANAGEMENT          │ 5. ARIA LIVE REGIONS          │ 6. KEYBOARD NAVIGATION          │
│ WCAG 2.2.2 Live feed pause    │ Throttled off-screen polite   │ Full table navigation via Tab   │
│ and resume stream toggle      │ announcers for price ticks    │ and Enter/Space row selection   │
└───────────────────────────────┴───────────────────────────────┴─────────────────────────────────┘
```

### 6.1 Color Independence & Dual-Encoding (WCAG 1.4.1)

- **Violation in Traditional Fintech:** Indicating profit/loss or debit/credit solely through green (`#10b981`) and red (`#ef4444`) renders the interface unusable for the ~8% of males with red-green color blindness (deuteranopia / protanopia).
- **Dual-Encoding Mandate:**
  1. *Directional Icons:* Every credit or upward price movement must pair color with an upward icon (`▲` or Lucide `TrendingUp`). Every debit or downward movement pairs with a downward icon (`▼` or Lucide `TrendingDown`).
  2. *Explicit Math Signs:* Positive changes require an explicit `+` prefix; negative changes require an explicit `-` prefix.
  3. *Screen-Reader Text:* Badges must inject off-screen screen-reader prefixes:

     ```tsx
     <span className="font-mono font-bold text-rose-400">
       <span className="sr-only">Debit outflow: </span>
       -{formatCents(amountCents, currency)}
     </span>
     ```

### 6.2 Contrast Ratios & Semantic Color Tokens (WCAG 1.4.3 & 1.4.11)

- **Contrast Remediation:** In dark mode interfaces, low-contrast slate text is a frequent failure point.
  - `text-slate-500` (`#64748b`) against `bg-slate-950` (`#020617`) produces a contrast ratio of **4.1:1**, failing WCAG AA (minimum 4.5:1).
  - Remediation: Replace all secondary body and meta text with `text-slate-400` (`#94a3b8`, **6.2:1**) or `text-slate-300` (`#cbd5e1`, **9.8:1**).
- **Interactive Component Contrast:** Buttons, form input borders, and toggle indicators must maintain at least **3.0:1** contrast against adjacent backgrounds (WCAG 1.4.11).

### 6.3 Focus Trapping & Accessible Dialogs (WCAG 2.4.3 & 2.4.7)

All modals and drawers (`ConfirmationModal`, `EngineeringXRayDrawer`) must satisfy:

1. `role="dialog"` and `aria-modal="true"`.
2. `aria-labelledby="dialog-title"` and `aria-describedby="dialog-description"`.
3. **Focus Trapping:** When the modal mounts, focus moves to the primary action or close button. Pressing `Tab` cycles exclusively within the dialog.
4. **Escape Key Listener:** Pressing `Escape` triggers immediate dismissal.
5. **Focus Restoration:** Upon closing, focus is restored to the triggering element.
6. **Focus Rings:** High-visibility focus indicators on all interactive elements:
   `focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950`.

### 6.4 Dynamic Updates & Throttled ARIA Live Regions (WCAG 2.2.2 & 4.1.3)

- **The Screen-Reader Churn Hazard:** If real-time SSE market streams (arriving every 2.5s) trigger raw `aria-live="assertive"` announcements, screen-reader users are bombarded with continuous audio interruptions, rendering the system unusable.
- **Throttled Polite Announcer:**
  - Market price ticks are filtered through a debounced, throttled polite announcer (`aria-live="polite"` with `aria-atomic="false"`).
  - Deltas are announced at a maximum frequency of once every 10 seconds, summarizing significant movements (e.g. *"PETR4 updated to R$ 38,50, up 2.4%"*).
  - High-priority events (e.g. an open limit order filling or transfer completing) use immediate assertive announcements (`role="alert"`).
- **WCAG 2.2.2 Pause/Resume Toggle:** Users can pause live market ticker animations and price updates via a dedicated toggle: `[⏸ Pause Live Updates]`.

---

## 7. Synthesis & Strategic Recommendations

To transform AegisFintech's web interface into an industry benchmark while strictly respecting the architectural constraints of `AGENTS.md` (Zero Ceremony, React 19, Tailwind CSS v4, TanStack Query v5), the following concrete implementation principles are mandated:

1. **Modular Feature Slicing:** Decompose the 2,204-line monolithic `App.tsx` into clean, vertical domain directories under `apps/web/src/features/` (`auth/`, `dashboard/`, `transfers/`, `savings/`, `fx/`, `trading/`, `statement/`).
2. **Unified Confirmation Engine:** Standardize all financial authorizations across banking, FX, and trading through a single, accessible, two-step confirmation drawer (`ConfirmationModal.tsx`) enforcing latch-locking and single idempotency key generation.
3. **Native SVG Visualization:** Implement sparklines, candlesticks, and order book depth ladders using pure React 19 SVG rendering, eliminating external chart dependencies.
4. **State Machine Quote Locking:** Enforce 30-second TTL countdowns and slippage tolerance boundaries on all currency conversions.
5. **Rigorous WCAG 2.1 AA Compliance:** Apply dual-encoding, 6.2:1+ contrast ratios, focus-trapped drawers, and throttled ARIA live announcers across all screens.

This research establishes the exact requirements for the architectural blueprint detailed in `docs/UX_UI_ARCHITECTURE_PLAN.md`.
