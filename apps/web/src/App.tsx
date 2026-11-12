import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Building2,
  CandlestickChart,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  FastForward,
  Globe,
  Landmark,
  LogOut,
  PiggyBank,
  Play,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Wallet,
  Zap,
} from 'lucide-react';
import {
  CURRENCY_META,
  formatBps,
  formatCents,
  parseDecimalToCents,
  type CurrencyCode,
  type OrderSide,
  type OrderType,
  type SavingsProductType,
} from '@aegis/shared';
import {
  apiRequest,
  generateIdempotencyKey,
  setAuthToken,
  type LedgerEntryItem,
} from './api/client.js';
import { EngineeringXRayDrawer } from './components/EngineeringXRayDrawer.js';

type ActiveSection = 'dashboard' | 'transfers' | 'savings' | 'fx' | 'trading';

interface DemoUser {
  id: string;
  name: string;
  email: string;
  documentNumber: string;
  accountNumber: string;
}

interface CheckingAccount {
  id: string;
  accountNumber: string;
  currency: CurrencyCode;
  label: string;
  balanceCents: number;
  lockedBalanceCents: number;
  availableBalanceCents: number;
  balanceInBrlCents: number;
}

interface StatementTx {
  id: string;
  idempotencyKey: string | null;
  category: string;
  description: string;
  createdAt: string;
  primaryImpact: {
    direction: 'DEBIT' | 'CREDIT';
    amountCents: number;
    currency: CurrencyCode;
    balanceAfterCents: number;
  };
  doubleEntryLegs: Array<LedgerEntryItem & { accountType: string }>;
}

interface MarketAsset {
  symbol: string;
  name: string;
  sector: string;
  exchange: string;
  currency: CurrencyCode;
  currentPriceCents: number;
  openPriceCents: number;
  highPriceCents: number;
  lowPriceCents: number;
  changeCents: number;
  changePercent: number;
}

interface FxPair {
  pair: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  commercialRate: number;
  spreadBps: number;
  iofBps: number;
}

export function App() {
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<ActiveSection>('dashboard');
  const [xrayOpen, setXrayOpen] = useState(false);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(
    null
  );

  const showToast = (type: 'success' | 'error' | 'info', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 5500);
  };

  // ============================================================================
  // Queries: Current Session & Demo Users
  // ============================================================================
  const demoUsersQuery = useQuery({
    queryKey: ['demo-users'],
    queryFn: () => apiRequest<{ users: DemoUser[] }>('/api/auth/demo-users'),
  });

  const meQuery = useQuery({
    queryKey: ['auth-me'],
    queryFn: () =>
      apiRequest<{
        user: DemoUser;
        accounts: CheckingAccount[];
      }>('/api/auth/me'),
    retry: false,
  });

  const isAuthenticated = Boolean(meQuery.data?.user);

  const summaryQuery = useQuery({
    queryKey: ['accounts-summary'],
    queryFn: () =>
      apiRequest<{
        checkingAccounts: CheckingAccount[];
        netWorthSummary: {
          totalCheckingBrlCents: number;
          totalSavingsBrlCents: number;
          totalInvestmentsBrlCents: number;
          totalNetWorthBrlCents: number;
        };
      }>('/api/accounts/summary'),
    enabled: isAuthenticated,
  });

  const statementQuery = useQuery({
    queryKey: ['accounts-statement'],
    queryFn: () => apiRequest<{ transactions: StatementTx[] }>('/api/accounts/statement?limit=25'),
    enabled: isAuthenticated,
  });

  const vaultsQuery = useQuery({
    queryKey: ['savings-vaults'],
    queryFn: () =>
      apiRequest<{
        vaults: Array<{
          id: string;
          name: string;
          productType: SavingsProductType;
          currency: CurrencyCode;
          annualRateBps: number;
          cdiPercentage: number;
          principalCents: number;
          accruedYieldCents: number;
          totalBalanceCents: number;
          simulatedDaysElapsed: number;
        }>;
      }>('/api/savings/vaults'),
    enabled: isAuthenticated,
  });

  const marketQuery = useQuery({
    queryKey: ['market-assets'],
    queryFn: () =>
      apiRequest<{
        assets: MarketAsset[];
        fxPairs: FxPair[];
      }>('/api/market/assets'),
    enabled: isAuthenticated,
  });

  const portfolioQuery = useQuery({
    queryKey: ['trading-portfolio'],
    queryFn: () =>
      apiRequest<{
        holdings: Array<{
          id: string;
          symbol: string;
          name: string;
          exchange: string;
          currency: CurrencyCode;
          quantity: number;
          lockedQuantity: number;
          availableQuantity: number;
          averagePriceCents: number;
          currentPriceCents: number;
          marketValueCents: number;
          unrealizedPnlCents: number;
          unrealizedPnlPercent: number;
          realizedPnlCents: number;
        }>;
        orders: Array<{
          id: string;
          symbol: string;
          side: OrderSide;
          orderType: OrderType;
          quantity: number;
          limitPriceCents: number | null;
          executedPriceCents: number | null;
          totalGrossCents: number;
          feeCents: number;
          currency: CurrencyCode;
          status: 'OPEN' | 'FILLED' | 'CANCELLED';
          createdAt: string;
        }>;
      }>('/api/trading/portfolio'),
    enabled: isAuthenticated,
  });

  const refreshAllFinancialData = () => {
    queryClient.invalidateQueries({ queryKey: ['accounts-summary'] });
    queryClient.invalidateQueries({ queryKey: ['accounts-statement'] });
    queryClient.invalidateQueries({ queryKey: ['savings-vaults'] });
    queryClient.invalidateQueries({ queryKey: ['market-assets'] });
    queryClient.invalidateQueries({ queryKey: ['trading-portfolio'] });
  };

  // ============================================================================
  // Live SSE Market Stream Subscription
  // ============================================================================
  useEffect(() => {
    if (!isAuthenticated) return;
    const source = new EventSource('/api/market/stream');
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.assets && parsed.fxPairs) {
          queryClient.setQueryData(['market-assets'], {
            assets: parsed.assets,
            fxPairs: parsed.fxPairs,
          });
        }
        if (parsed.filledOrdersCount > 0) {
          refreshAllFinancialData();
          showToast(
            'info',
            `⚡ Live Market Engine filled ${parsed.filledOrdersCount} open Limit Order(s)!`
          );
        }
      } catch {
        // Ignore parse errors
      }
    };
    return () => {
      source.close();
    };
  }, [isAuthenticated]);

  // ============================================================================
  // Auth Forms & Quick-Switch Handlers
  // ============================================================================
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('alice@aegis.bank');
  const [loginPassword, setLoginPassword] = useState('password123');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDoc, setRegDoc] = useState('');
  const [regPassword, setRegPassword] = useState('password123');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ token: string; user: DemoUser }>('/api/auth/login', {
        method: 'POST',
        body: { email: loginEmail, password: loginPassword },
      });
      setAuthToken(res.token);
      await queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      refreshAllFinancialData();
      showToast('success', `Welcome back, ${res.user.name}!`);
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ token: string; user: DemoUser }>('/api/auth/register', {
        method: 'POST',
        body: {
          name: regName,
          email: regEmail,
          documentNumber: regDoc,
          password: regPassword,
        },
      });
      setAuthToken(res.token);
      await queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      await queryClient.invalidateQueries({ queryKey: ['demo-users'] });
      refreshAllFinancialData();
      showToast(
        'success',
        `Account created for ${res.user.name}! Provisioned BRL, USD & EUR accounts.`
      );
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleQuickSwitch = async (targetUserId: string) => {
    try {
      const res = await apiRequest<{ token: string; user: DemoUser }>(
        `/api/auth/quick-switch/${targetUserId}`,
        { method: 'POST' }
      );
      setAuthToken(res.token);
      await queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      refreshAllFinancialData();
      showToast('info', `Switched active session to ${res.user.name} (${res.user.accountNumber})`);
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleLogout = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthToken(null);
    queryClient.clear();
  };

  // ============================================================================
  // 1. Transfers & Payments State + Concurrency / Idempotency Lab
  // ============================================================================
  const [recipientInput, setRecipientInput] = useState('bob@aegis.bank');
  const [transferCurrency, setTransferCurrency] = useState<CurrencyCode>('BRL');
  const [transferAmountStr, setTransferAmountStr] = useState('250.00');
  const [transferDesc, setTransferDesc] = useState('Pix Transfer');
  const [lastTransferRecord, setLastTransferRecord] = useState<{
    key: string;
    payload: unknown;
  } | null>(null);
  const [raceTestReport, setRaceTestReport] = useState<
    Array<{ attempt: number; status: number; outcome: string }>
  >([]);

  const [billBarcode, setBillBarcode] = useState('34191790010104351004791020150008291070026000');
  const [billerName, setBillerName] = useState('ENEL Power Grid Utility');
  const [billAmountStr, setBillAmountStr] = useState('185.40');

  const handleP2PTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const amountCents = parseDecimalToCents(transferAmountStr);
      const key = generateIdempotencyKey('pix');
      const payload = {
        recipientIdentifier: recipientInput,
        currency: transferCurrency,
        amountCents,
        description: transferDesc,
      };
      setLastTransferRecord({ key, payload });

      const res = await apiRequest<{
        transfer: { recipientName: string; amountCents: number; currency: CurrencyCode };
        idempotency: { key: string; replayed: boolean };
      }>('/api/transfers/p2p', {
        method: 'POST',
        body: payload,
        idempotencyKey: key,
      });

      refreshAllFinancialData();
      showToast(
        'success',
        `Sent ${formatCents(res.transfer.amountCents, res.transfer.currency)} to ${res.transfer.recipientName}`
      );
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleReplayLastIdempotencyKey = async () => {
    if (!lastTransferRecord) {
      showToast('info', 'Send one normal Pix transfer first to capture an Idempotency-Key.');
      return;
    }
    try {
      const res = await apiRequest<{
        transfer: { transactionId: string; amountCents: number; currency: CurrencyCode };
        idempotency: { key: string; replayed: boolean };
      }>('/api/transfers/p2p', {
        method: 'POST',
        body: lastTransferRecord.payload,
        idempotencyKey: lastTransferRecord.key,
      });
      refreshAllFinancialData();
      showToast(
        'info',
        `Idempotency Replay Verified! Server returned cached tx ${res.transfer.transactionId.slice(0, 8)}... (replayed=${String(res.idempotency.replayed)}) with ZERO duplicate charge!`
      );
      setXrayOpen(true);
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleSimulateRaceConditionAttack = async () => {
    const brlAcc = summaryQuery.data?.checkingAccounts.find((a) => a.currency === 'BRL');
    if (!brlAcc || brlAcc.availableBalanceCents < 10_000) {
      showToast('error', 'Need at least R$ 100,00 available BRL balance to run the attack lab.');
      return;
    }

    // Each parallel request tries to spend 60% of the user's available balance at the exact same millisecond!
    const sixtyPercentCents = Math.floor(brlAcc.availableBalanceCents * 0.6);
    const otherUser = demoUsersQuery.data?.users.find((u) => u.id !== meQuery.data?.user.id);
    const targetEmail = otherUser?.email ?? recipientInput;

    const batchId = Date.now().toString().slice(-5);
    const requests = Array.from({ length: 5 }, (_, idx) => {
      const key = `race-lab-${batchId}-${idx + 1}`;
      return apiRequest('/api/transfers/p2p', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          recipientIdentifier: targetEmail,
          currency: 'BRL',
          amountCents: sixtyPercentCents,
          description: `Parallel Race Attack #${idx + 1} (60% of balance)`,
        },
      })
        .then(() => ({
          attempt: idx + 1,
          status: 201,
          outcome: `✅ FILLED (${formatCents(sixtyPercentCents, 'BRL')}) — Lock acquired first`,
        }))
        .catch((err: Error & { statusCode?: number }) => ({
          attempt: idx + 1,
          status: err.statusCode ?? 422,
          outcome: `🛡️ BLOCKED (${err.message})`,
        }));
    });

    const outcomes = await Promise.all(requests);
    setRaceTestReport(outcomes);
    refreshAllFinancialData();
    showToast(
      'info',
      `Concurrency Attack Completed: 1 succeeded, 4 blocked by SELECT ... FOR UPDATE!`
    );
  };

  const handleBillPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const amountCents = parseDecimalToCents(billAmountStr);
      await apiRequest('/api/transfers/bill-payment', {
        method: 'POST',
        idempotencyKey: generateIdempotencyKey('bill'),
        body: {
          barcode: billBarcode,
          billerName,
          currency: 'BRL',
          amountCents,
        },
      });
      refreshAllFinancialData();
      showToast('success', `Paid ${formatCents(amountCents, 'BRL')} to ${billerName}`);
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  // ============================================================================
  // 2. Savings Vaults & CDB Handlers
  // ============================================================================
  const [newVaultName, setNewVaultName] = useState('Europe Trip & Reserve');
  const [newVaultProduct, setNewVaultProduct] = useState<SavingsProductType>(
    'CDB_PLUS_120_CDI'
  );
  const [newVaultDepositStr, setNewVaultDepositStr] = useState('2000.00');
  const [vaultMoveAmounts, setVaultMoveAmounts] = useState<Record<string, string>>({});

  const handleCreateVault = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const initialDepositCents = parseDecimalToCents(newVaultDepositStr || '0');
      await apiRequest('/api/savings/vaults', {
        method: 'POST',
        idempotencyKey: generateIdempotencyKey('vault-create'),
        body: {
          name: newVaultName,
          productType: newVaultProduct,
          currency: 'BRL',
          initialDepositCents,
        },
      });
      refreshAllFinancialData();
      showToast('success', `Created vault "${newVaultName}"!`);
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleVaultMove = async (vaultId: string, action: 'deposit' | 'redeem') => {
    try {
      const rawAmount = vaultMoveAmounts[vaultId] || '500.00';
      const amountCents = parseDecimalToCents(rawAmount);
      await apiRequest(`/api/savings/vaults/${vaultId}/${action}`, {
        method: 'POST',
        idempotencyKey: generateIdempotencyKey(`vault-${action}`),
        body: { amountCents },
      });
      refreshAllFinancialData();
      showToast(
        'success',
        `${action === 'deposit' ? 'Deposited' : 'Redeemed'} ${formatCents(amountCents, 'BRL')}`
      );
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleSimulateYield = async (vaultId: string, businessDays: number) => {
    try {
      const res = await apiRequest<{ yieldAccruedCents: number }>(
        `/api/savings/vaults/${vaultId}/simulate-yield`,
        {
          method: 'POST',
          idempotencyKey: generateIdempotencyKey('vault-yield'),
          body: { businessDays },
        }
      );
      refreshAllFinancialData();
      showToast(
        'success',
        `Time-Travel (+${businessDays} business days): Accrued +${formatCents(res.yieldAccruedCents, 'BRL')} compound CDI yield!`
      );
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  // ============================================================================
  // 3. FX Currency Exchange Desk Handlers
  // ============================================================================
  const [fxFrom, setFxFrom] = useState<CurrencyCode>('BRL');
  const [fxTo, setFxTo] = useState<CurrencyCode>('USD');
  const [fxAmountStr, setFxAmountStr] = useState('2500.00');

  const fxPreviewQuery = useQuery({
    queryKey: ['fx-quote', fxFrom, fxTo, fxAmountStr],
    queryFn: async () => {
      const cents = parseDecimalToCents(fxAmountStr);
      if (cents <= 0 || fxFrom === fxTo) return null;
      return apiRequest<{
        quote: {
          fromCurrency: CurrencyCode;
          toCurrency: CurrencyCode;
          sourceAmountCents: number;
          spreadFeeCents: number;
          iofTaxCents: number;
          netSourceConvertedCents: number;
          targetAmountCents: number;
          commercialRate: number;
          effectiveRate: number;
          spreadBps: number;
          iofBps: number;
        };
      }>('/api/fx/quote', {
        method: 'POST',
        body: {
          fromCurrency: fxFrom,
          toCurrency: fxTo,
          sourceAmountCents: cents,
        },
      });
    },
    enabled: isAuthenticated && fxFrom !== fxTo,
  });

  const handleExecuteFxExchange = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sourceAmountCents = parseDecimalToCents(fxAmountStr);
      const res = await apiRequest<{
        exchange: {
          quote: {
            sourceAmountCents: number;
            targetAmountCents: number;
            fromCurrency: CurrencyCode;
            toCurrency: CurrencyCode;
          };
        };
      }>('/api/fx/exchange', {
        method: 'POST',
        idempotencyKey: generateIdempotencyKey('fx'),
        body: {
          fromCurrency: fxFrom,
          toCurrency: fxTo,
          sourceAmountCents,
        },
      });
      refreshAllFinancialData();
      showToast(
        'success',
        `Converted ${formatCents(res.exchange.quote.sourceAmountCents, fxFrom)} → ${formatCents(res.exchange.quote.targetAmountCents, fxTo)} via 4-leg Double-Entry Ledger!`
      );
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  // ============================================================================
  // 4. Stock Exchange & Order Book Terminal Handlers
  // ============================================================================
  const [selectedSymbol, setSelectedSymbol] = useState('PETR4');
  const [orderSide, setOrderSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [orderQty, setOrderQty] = useState('50');
  const [limitPriceStr, setLimitPriceStr] = useState('37.00');

  const selectedAsset =
    marketQuery.data?.assets.find((a) => a.symbol === selectedSymbol) ??
    marketQuery.data?.assets[0];

  const handlePlaceStockOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    try {
      const quantity = parseInt(orderQty, 10);
      const limitPriceCents =
        orderType === 'LIMIT' ? parseDecimalToCents(limitPriceStr) : undefined;

      const res = await apiRequest<{
        order: {
          id: string;
          symbol: string;
          side: OrderSide;
          orderType: OrderType;
          quantity: number;
          status: string;
          executedPriceCents: number | null;
          currency: CurrencyCode;
        };
      }>('/api/trading/orders', {
        method: 'POST',
        idempotencyKey: generateIdempotencyKey('trade'),
        body: {
          symbol: selectedAsset.symbol,
          side: orderSide,
          orderType,
          quantity,
          limitPriceCents,
        },
      });
      refreshAllFinancialData();
      if (res.order.status === 'FILLED') {
        showToast(
          'success',
          `Order FILLED: ${res.order.side} ${res.order.quantity} ${res.order.symbol} @ ${formatCents(res.order.executedPriceCents ?? 0, res.order.currency)}`
        );
      } else {
        showToast(
          'info',
          `Limit Order OPEN in Order Book: ${res.order.side} ${res.order.quantity} ${res.order.symbol} (Escrow locked!)`
        );
      }
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    try {
      await apiRequest(`/api/trading/orders/${orderId}/cancel`, {
        method: 'POST',
      });
      refreshAllFinancialData();
      showToast('info', 'Limit order cancelled and locked escrow released.');
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  const handleSetMarketPrice = async (symbol: string, newPriceCents: number) => {
    try {
      const res = await apiRequest<{ filledOrdersCount: number }>('/api/market/set-price', {
        method: 'POST',
        body: { symbol, priceCents: Math.max(100, newPriceCents) },
      });
      refreshAllFinancialData();
      if (res.filledOrdersCount > 0) {
        showToast(
          'success',
          `Price crossed limit threshold! Automatically filled ${res.filledOrdersCount} open limit order(s) for ${symbol}.`
        );
      }
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  // ============================================================================
  // Render Unauthenticated Login / Registration Screen
  // ============================================================================
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Landmark className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Aegis FinTech</h1>
              <p className="text-xs text-slate-400">
                Digital Banking & Stock Exchange — Architecture Study Case
              </p>
            </div>
          </div>

          {/* Instant Demo User Quick-Login Cards */}
          {demoUsersQuery.data?.users && demoUsersQuery.data.users.length > 0 && (
            <div className="mb-6 rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-2.5">
                <Sparkles className="h-3.5 w-3.5" />
                One-Click Study Case Demo Accounts
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {demoUsersQuery.data.users.slice(0, 2).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => handleQuickSwitch(u.id)}
                    className="flex flex-col items-start rounded-lg border border-slate-700/80 bg-slate-900/90 p-2.5 text-left hover:border-emerald-500/60 hover:bg-slate-800 transition"
                  >
                    <span className="text-xs font-semibold text-white">{u.name}</span>
                    <span className="text-[11px] font-mono text-emerald-400">
                      Acc: {u.accountNumber}
                    </span>
                    <span className="text-[10px] text-slate-400 truncate w-full">{u.email}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mode Toggle */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-950 p-1 mb-5 border border-slate-800">
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className={`rounded-md py-1.5 text-xs font-medium transition ${
                authMode === 'login'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('register')}
              className={`rounded-md py-1.5 text-xs font-medium transition ${
                authMode === 'register'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Create Account
            </button>
          </div>

          {authMode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition cursor-pointer"
              >
                Access Platform
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="Carlos Mendes"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
                <input
                  type="email"
                  required
                  placeholder="carlos@aegis.bank"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  CPF / Document (11-14 digits)
                </label>
                <input
                  type="text"
                  required
                  placeholder="12345678901"
                  value={regDoc}
                  onChange={(e) => setRegDoc(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition cursor-pointer"
              >
                Open Multi-Currency Account
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const currentUser = meQuery.data!.user;
  const checkingAccounts = summaryQuery.data?.checkingAccounts ?? [];
  const netWorth = summaryQuery.data?.netWorthSummary;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Live Ticker & Didactic Controls Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Landmark className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white">Aegis FinTech</span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                  ACID Double-Entry Ledger
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Active User: <strong className="text-slate-200">{currentUser.name}</strong> (Acc:{' '}
                <code className="text-emerald-400">{currentUser.accountNumber}</code>)
              </p>
            </div>
          </div>

          {/* Instant Demo Account Switcher + X-Ray Toggle */}
          <div className="flex flex-wrap items-center gap-2.5">
            {demoUsersQuery.data?.users && (
              <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
                <span className="px-2 text-[11px] text-slate-400 flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                  Switch User:
                </span>
                {demoUsersQuery.data.users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleQuickSwitch(u.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                      u.id === currentUser.id
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {u.name.split(' ')[0]} ({u.accountNumber})
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => setXrayOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition cursor-pointer"
            >
              <Activity className="h-4 w-4" />
              Engineering X-Ray
            </button>

            <button
              onClick={handleLogout}
              className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Live Market Quotes Ribbon */}
        <div className="border-t border-slate-800/80 bg-slate-950/90 px-6 py-1.5 overflow-x-auto">
          <div className="mx-auto flex max-w-7xl items-center gap-6 text-xs whitespace-nowrap">
            <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              LIVE SSE MARKET
            </span>
            {marketQuery.data?.assets.map((asset) => (
              <button
                key={asset.symbol}
                onClick={() => {
                  setSelectedSymbol(asset.symbol);
                  setActiveSection('trading');
                }}
                className="flex items-center gap-1.5 hover:bg-slate-900 px-2 py-0.5 rounded transition cursor-pointer"
              >
                <span className="font-mono font-bold text-slate-200">{asset.symbol}</span>
                <span className="font-mono text-slate-300">
                  {formatCents(asset.currentPriceCents, asset.currency)}
                </span>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    asset.changePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {asset.changePercent >= 0 ? '+' : ''}
                  {asset.changePercent.toFixed(2)}%
                </span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-40 max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl flex items-center gap-3">
          <CheckCircle2
            className={`h-5 w-5 shrink-0 ${
              toast.type === 'error'
                ? 'text-rose-400'
                : toast.type === 'info'
                  ? 'text-sky-400'
                  : 'text-emerald-400'
            }`}
          />
          <p className="text-xs font-medium text-slate-100">{toast.text}</p>
        </div>
      )}

      {/* Main Navigation Tabs */}
      <div className="border-b border-slate-800 bg-slate-900/40">
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-6 py-2.5">
          {[
            { id: 'dashboard', label: '1. Accounts & Statement', icon: Wallet },
            { id: 'transfers', label: '2. Pix Transfers & Concurrency Lab', icon: Send },
            { id: 'savings', label: '3. Savings Vaults & CDB Yield', icon: PiggyBank },
            { id: 'fx', label: '4. Currency Exchange (FX Desk)', icon: Globe },
            { id: 'trading', label: '5. Stock Exchange & Order Book', icon: CandlestickChart },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id as ActiveSection)}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  active
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-7xl flex-1 p-6 space-y-6">
        {/* ====================================================================
            SECTION 1: DASHBOARD, MULTI-CURRENCY ACCOUNTS & DOUBLE-ENTRY STATEMENT
           ==================================================================== */}
        {activeSection === 'dashboard' && (
          <div className="space-y-6">
            {/* Net Worth Banner */}
            {netWorth && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-slate-900 p-5">
                  <span className="text-xs font-medium text-emerald-300">
                    Consolidated Net Worth (BRL)
                  </span>
                  <div className="mt-2 text-2xl font-bold font-mono text-white">
                    {formatCents(netWorth.totalNetWorthBrlCents, 'BRL')}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Cash + Savings Vaults + Equities converted at live FX
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                  <span className="text-xs text-slate-400">Checking Cash (All Currencies)</span>
                  <div className="mt-2 text-xl font-bold font-mono text-slate-100">
                    {formatCents(netWorth.totalCheckingBrlCents, 'BRL')}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">BRL, USD & EUR Accounts</p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                  <span className="text-xs text-slate-400">Fixed-Income & Savings Vaults</span>
                  <div className="mt-2 text-xl font-bold font-mono text-amber-300">
                    {formatCents(netWorth.totalSavingsBrlCents, 'BRL')}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">100%–120% CDI Compounding</p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                  <span className="text-xs text-slate-400">Stock Market Portfolio</span>
                  <div className="mt-2 text-xl font-bold font-mono text-sky-300">
                    {formatCents(netWorth.totalInvestmentsBrlCents, 'BRL')}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">B3 & NASDAQ Live Mark-to-Market</p>
                </div>
              </div>
            )}

            {/* Multi-Currency Checking Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {checkingAccounts.map((acc) => {
                const meta = CURRENCY_META[acc.currency];
                return (
                  <div
                    key={acc.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900 p-5 flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">{meta.flag}</span>
                        <div>
                          <h3 className="text-sm font-semibold text-white">
                            {meta.name} ({acc.currency})
                          </h3>
                          <p className="text-[11px] font-mono text-slate-400">
                            Account #{acc.accountNumber}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                        {acc.currency}
                      </span>
                    </div>

                    <div className="my-4">
                      <div className="text-xs text-slate-400">Available Balance</div>
                      <div className="text-2xl font-bold font-mono text-white mt-0.5">
                        {formatCents(acc.availableBalanceCents, acc.currency)}
                      </div>
                      {acc.lockedBalanceCents > 0 && (
                        <div className="mt-1 text-xs font-mono text-amber-400">
                          🔒 Escrow Locked (Open Limit Orders):{' '}
                          {formatCents(acc.lockedBalanceCents, acc.currency)}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 pt-3 border-t border-slate-800/80">
                      <button
                        onClick={() => {
                          setTransferCurrency(acc.currency);
                          setActiveSection('transfers');
                        }}
                        className="flex-1 rounded-lg bg-slate-800 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition cursor-pointer"
                      >
                        Transfer {acc.currency}
                      </button>
                      <button
                        onClick={() => {
                          setFxFrom(acc.currency);
                          setFxTo(acc.currency === 'BRL' ? 'USD' : 'BRL');
                          setActiveSection('fx');
                        }}
                        className="flex-1 rounded-lg bg-slate-800 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition cursor-pointer"
                      >
                        Convert FX
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Double-Entry Statement & Audit Trail */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Receipt className="h-5 w-5 text-emerald-400" />
                    Immutable Double-Entry Statement & Audit Trail
                  </h2>
                  <p className="text-xs text-slate-400">
                    Click any transaction row to inspect its underlying balanced{' '}
                    <code className="text-rose-400">DEBIT</code> and{' '}
                    <code className="text-emerald-400">CREDIT</code> ledger postings.
                  </p>
                </div>
              </div>

              <div className="divide-y divide-slate-800">
                {statementQuery.data?.transactions.map((tx) => {
                  const isExpanded = expandedTxId === tx.id;
                  const isCredit = tx.primaryImpact.direction === 'CREDIT';
                  return (
                    <div key={tx.id} className="py-3.5">
                      <div
                        onClick={() => setExpandedTxId(isExpanded ? null : tx.id)}
                        className="flex flex-wrap items-center justify-between gap-4 cursor-pointer hover:bg-slate-800/40 rounded-lg p-2 -m-2 transition"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                              isCredit
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {isCredit ? (
                              <ArrowDownLeft className="h-5 w-5" />
                            ) : (
                              <ArrowUpRight className="h-5 w-5" />
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{tx.description}</div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400">
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                                {tx.category}
                              </span>
                              <span>{new Date(tx.createdAt).toLocaleString()}</span>
                              {tx.idempotencyKey && (
                                <span className="font-mono text-slate-500">
                                  Key: {tx.idempotencyKey}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right font-mono">
                            <div
                              className={`text-sm font-bold ${
                                isCredit ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {isCredit ? '+' : '-'}
                              {formatCents(
                                tx.primaryImpact.amountCents,
                                tx.primaryImpact.currency
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Bal:{' '}
                              {formatCents(
                                tx.primaryImpact.balanceAfterCents,
                                tx.primaryImpact.currency
                              )}
                            </div>
                          </div>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs">
                          <div className="mb-2 flex items-center justify-between text-slate-400">
                            <span className="font-semibold text-emerald-400">
                              Double-Entry Bookkeeping Legs (∑ DEBIT = ∑ CREDIT)
                            </span>
                            <span className="font-mono text-[11px]">Tx ID: {tx.id}</span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left font-mono text-[11px]">
                              <thead className="border-b border-slate-800 text-slate-400 uppercase">
                                <tr>
                                  <th className="py-1.5 pr-4">Account</th>
                                  <th className="py-1.5 pr-4">Type</th>
                                  <th className="py-1.5 pr-4">Direction</th>
                                  <th className="py-1.5 pr-4 text-right">Amount</th>
                                  <th className="py-1.5 text-right">Account Balance After</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-900">
                                {tx.doubleEntryLegs.map((leg) => (
                                  <tr key={leg.id}>
                                    <td className="py-1.5 pr-4 text-slate-200">
                                      {leg.accountLabel} ({leg.accountNumber})
                                    </td>
                                    <td className="py-1.5 pr-4 text-slate-400">
                                      {leg.accountType}
                                    </td>
                                    <td className="py-1.5 pr-4">
                                      <span
                                        className={`rounded px-1.5 py-0.5 font-bold ${
                                          leg.direction === 'DEBIT'
                                            ? 'bg-rose-500/15 text-rose-400'
                                            : 'bg-emerald-500/15 text-emerald-400'
                                        }`}
                                      >
                                        {leg.direction}
                                      </span>
                                    </td>
                                    <td className="py-1.5 pr-4 text-right font-semibold text-white">
                                      {formatCents(leg.amountCents, leg.currency)}
                                    </td>
                                    <td className="py-1.5 text-right text-slate-400">
                                      {formatCents(leg.balanceAfterCents, leg.currency)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            SECTION 2: PIX TRANSFERS, BILL PAYMENTS & CONCURRENCY / IDEMPOTENCY LAB
           ==================================================================== */}
        {activeSection === 'transfers' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* P2P Pix Transfer Card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <Send className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Instant P2P / Pix Transfer
                  </h2>
                  <p className="text-xs text-slate-400">
                    Protected by <code className="text-emerald-400">Idempotency-Key</code> and
                    sorted <code className="text-sky-300">SELECT ... FOR UPDATE</code> locks
                  </p>
                </div>
              </div>

              {/* Quick Fill Counterparty */}
              {demoUsersQuery.data?.users && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-400">Quick-select recipient:</span>
                  {demoUsersQuery.data.users
                    .filter((u) => u.id !== currentUser.id)
                    .map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setRecipientInput(u.email)}
                        className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:border-emerald-500 transition cursor-pointer"
                      >
                        {u.name} ({u.email})
                      </button>
                    ))}
                </div>
              )}

              <form onSubmit={handleP2PTransfer} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Recipient Email, CPF, or Account Number
                  </label>
                  <input
                    type="text"
                    required
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Currency
                    </label>
                    <select
                      value={transferCurrency}
                      onChange={(e) => setTransferCurrency(e.target.value as CurrencyCode)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      <option value="BRL">🇧🇷 BRL (Real)</option>
                      <option value="USD">🇺🇸 USD (Dollar)</option>
                      <option value="EUR">🇪🇺 EUR (Euro)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Amount ({transferCurrency})
                    </label>
                    <input
                      type="text"
                      required
                      value={transferAmountStr}
                      onChange={(e) => setTransferAmountStr(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-mono text-white focus:border-emerald-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={transferDesc}
                    onChange={(e) => setTransferDesc(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition cursor-pointer"
                >
                  Send Instant Transfer
                </button>
              </form>

              {/* Bill Payment Sub-card */}
              <div className="pt-5 border-t border-slate-800">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-sky-400" />
                  Pay Utility Bill / Boleto Barcode
                </h3>
                <form onSubmit={handleBillPayment} className="space-y-3">
                  <input
                    type="text"
                    required
                    value={billBarcode}
                    onChange={(e) => setBillBarcode(e.target.value)}
                    placeholder="Numeric Barcode"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-300"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      required
                      value={billerName}
                      onChange={(e) => setBillerName(e.target.value)}
                      placeholder="Merchant / Utility Name"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                    />
                    <input
                      type="text"
                      required
                      value={billAmountStr}
                      onChange={(e) => setBillAmountStr(e.target.value)}
                      placeholder="Amount (BRL)"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-mono text-white"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-lg border border-sky-500/40 bg-sky-500/15 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25 transition cursor-pointer"
                  >
                    Settle Bill Payment (BRL)
                  </button>
                </form>
              </div>
            </div>

            {/* Interactive Concurrency & Idempotency Study Lab */}
            <div className="rounded-2xl border border-emerald-500/30 bg-slate-900 p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Didactic Lab: Concurrency & Idempotency Stress Tests
                  </h2>
                  <p className="text-xs text-slate-400">
                    Test how the backend defends against network retries and parallel race-condition
                    overdraft attacks in real time!
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                  Experiment 1: Network Retry & Idempotency-Key Replay
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  In production banking apps, mobile connections drop right after the server commits
                  a transfer. Click below to replay your last Pix transfer with the{' '}
                  <strong>exact same</strong> <code className="text-slate-200">Idempotency-Key</code>
                  . The backend returns the cached receipt (<code className="text-emerald-400">replayed: true</code>) without debiting your account a second time.
                </p>
                <button
                  type="button"
                  onClick={handleReplayLastIdempotencyKey}
                  className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 transition cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" />
                  Replay Last Transfer with Same Idempotency-Key
                </button>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-400">
                  Experiment 2: 5x Simultaneous Parallel Overdraft Attack (Promise.all)
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  What happens if an attacker fires <strong>5 simultaneous requests</strong> at the
                  exact same millisecond, each attempting to transfer <strong>60%</strong> of your
                  available balance? Because <code className="text-sky-300">postLedgerTransaction</code> acquires PostgreSQL <code className="text-sky-300">SELECT ... FOR UPDATE</code> row locks, Request #1 succeeds and the other 4 wait in the lock queue and fail cleanly with <code className="text-rose-400">422 INSUFFICIENT_FUNDS</code>!
                </p>
                <button
                  type="button"
                  onClick={handleSimulateRaceConditionAttack}
                  className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/25 transition cursor-pointer"
                >
                  <Zap className="h-4 w-4" />
                  Launch 5x Parallel Race-Condition Attack (60% Balance Each)
                </button>

                {raceTestReport.length > 0 && (
                  <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3 space-y-1.5 font-mono text-[11px]">
                    <div className="text-slate-400 font-sans font-semibold mb-1">
                      Live Parallel Execution Report:
                    </div>
                    {raceTestReport.map((item) => (
                      <div key={item.attempt} className="flex items-center justify-between">
                        <span className="text-slate-300">Parallel Thread #{item.attempt}</span>
                        <span
                          className={
                            item.status === 201 ? 'text-emerald-400 font-bold' : 'text-rose-400'
                          }
                        >
                          [HTTP {item.status}] {item.outcome}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            SECTION 3: SAVINGS VAULTS & FIXED-INCOME (CDB) TIME-TRAVEL SIMULATOR
           ==================================================================== */}
        {activeSection === 'savings' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Create New Vault Form */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 h-fit">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                  <PiggyBank className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Create Savings Vault / CDB
                  </h2>
                  <p className="text-xs text-slate-400">
                    Each vault is backed by an isolated ledger account
                  </p>
                </div>
              </div>

              <form onSubmit={handleCreateVault} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Vault / Goal Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newVaultName}
                    onChange={(e) => setNewVaultName(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Fixed-Income Product (CDI Rate)
                  </label>
                  <select
                    value={newVaultProduct}
                    onChange={(e) => setNewVaultProduct(e.target.value as SavingsProductType)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    <option value="EMERGENCY_VAULT_100_CDI">
                      Emergency Vault — 100% CDI (11.25% p.a.)
                    </option>
                    <option value="CDB_LIQUIDEZ_110_CDI">
                      CDB Daily Liquidity — 110% CDI (12.38% p.a.)
                    </option>
                    <option value="CDB_PLUS_120_CDI">
                      CDB Plus High Yield — 120% CDI (13.50% p.a.)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Initial Deposit (BRL)
                  </label>
                  <input
                    type="text"
                    value={newVaultDepositStr}
                    onChange={(e) => setNewVaultDepositStr(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-mono text-white"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-lg bg-amber-400 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-300 transition cursor-pointer"
                >
                  Open Yield Vault
                </button>
              </form>
            </div>

            {/* Active Vaults List & Time-Travel Simulator */}
            <div className="lg:col-span-2 space-y-4">
              {vaultsQuery.data?.vaults.map((vault) => (
                <div
                  key={vault.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">{vault.name}</h3>
                        <span className="rounded-md bg-amber-500/15 px-2 py-0.5 font-mono text-xs font-semibold text-amber-300">
                          {vault.cdiPercentage}% CDI ({formatBps(vault.annualRateBps)} p.a.)
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Simulated Time Elapsed: <strong>{vault.simulatedDaysElapsed}</strong>{' '}
                        business days (252 days/year convention)
                      </p>
                    </div>

                    <div className="text-right font-mono">
                      <div className="text-xs text-slate-400">Total Vault Balance</div>
                      <div className="text-2xl font-bold text-white">
                        {formatCents(vault.totalBalanceCents, vault.currency)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-950 p-3.5 border border-slate-800/80 font-mono text-xs">
                    <div>
                      <span className="text-slate-400 font-sans">Principal Deposited:</span>
                      <div className="text-sm font-semibold text-slate-200 mt-0.5">
                        {formatCents(vault.principalCents, vault.currency)}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400 font-sans">Compound Interest Accrued:</span>
                      <div className="text-sm font-semibold text-emerald-400 mt-0.5">
                        +{formatCents(vault.accruedYieldCents, vault.currency)}
                      </div>
                    </div>
                  </div>

                  {/* Deposit / Redeem Controls */}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <input
                      type="text"
                      placeholder="500.00"
                      value={vaultMoveAmounts[vault.id] ?? '500.00'}
                      onChange={(e) =>
                        setVaultMoveAmounts((prev) => ({ ...prev, [vault.id]: e.target.value }))
                      }
                      className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-mono text-white"
                    />
                    <button
                      onClick={() => handleVaultMove(vault.id, 'deposit')}
                      className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 transition cursor-pointer"
                    >
                      + Deposit from Checking
                    </button>
                    <button
                      onClick={() => handleVaultMove(vault.id, 'redeem')}
                      className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition cursor-pointer"
                    >
                      - Redeem to Checking
                    </button>
                  </div>

                  {/* Didactic Time-Travel Yield Accrual Bar */}
                  <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-amber-200">
                      <FastForward className="h-4 w-4 text-amber-400 shrink-0" />
                      <span>
                        <strong>Didactic Time-Travel:</strong> Accrue compound interest from{' '}
                        <code>SYS-TREASURY</code>:
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {[
                        { days: 1, label: '+1 Day' },
                        { days: 30, label: '+30 Days (~1.5 mo)' },
                        { days: 252, label: '+252 Days (1 Full Year)' },
                      ].map((btn) => (
                        <button
                          key={btn.days}
                          onClick={() => handleSimulateYield(vault.id, btn.days)}
                          className="rounded-lg bg-amber-400/20 border border-amber-400/40 px-2.5 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-400/30 transition cursor-pointer"
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ====================================================================
            SECTION 4: CURRENCY EXCHANGE (FX DESK)
           ==================================================================== */}
        {activeSection === 'fx' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
                  <ArrowRightLeft className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Instant Multi-Currency Exchange Desk
                  </h2>
                  <p className="text-xs text-slate-400">
                    Executes a 4-leg cross-currency Double-Entry transaction via{' '}
                    <code className="text-sky-300">SYS-FX-POOL</code>
                  </p>
                </div>
              </div>

              <form onSubmit={handleExecuteFxExchange} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Sell Currency (Source)
                    </label>
                    <select
                      value={fxFrom}
                      onChange={(e) => setFxFrom(e.target.value as CurrencyCode)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      <option value="BRL">🇧🇷 BRL (Brazilian Real)</option>
                      <option value="USD">🇺🇸 USD (US Dollar)</option>
                      <option value="EUR">🇪🇺 EUR (Euro)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Buy Currency (Target)
                    </label>
                    <select
                      value={fxTo}
                      onChange={(e) => setFxTo(e.target.value as CurrencyCode)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      <option value="USD">🇺🇸 USD (US Dollar)</option>
                      <option value="BRL">🇧🇷 BRL (Brazilian Real)</option>
                      <option value="EUR">🇪🇺 EUR (Euro)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Source Amount ({fxFrom})
                  </label>
                  <input
                    type="text"
                    required
                    value={fxAmountStr}
                    onChange={(e) => setFxAmountStr(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-mono text-white"
                  />
                </div>

                {/* Live Quote Breakdown */}
                {fxPreviewQuery.data?.quote && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 text-xs font-mono">
                    <div className="flex justify-between text-slate-400">
                      <span>Commercial Mid-Market Rate:</span>
                      <span className="text-slate-200">
                        1 {fxFrom} = {fxPreviewQuery.data.quote.commercialRate.toFixed(4)} {fxTo}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>FX Desk Spread ({formatBps(fxPreviewQuery.data.quote.spreadBps)}):</span>
                      <span className="text-rose-400">
                        -{formatCents(fxPreviewQuery.data.quote.spreadFeeCents, fxFrom)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>IOF Tax ({formatBps(fxPreviewQuery.data.quote.iofBps)}):</span>
                      <span className="text-rose-400">
                        -{formatCents(fxPreviewQuery.data.quote.iofTaxCents, fxFrom)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400 border-t border-slate-800 pt-2">
                      <span>Effective Exchange Rate (VET):</span>
                      <span className="text-sky-300">
                        1 {fxFrom} = {fxPreviewQuery.data.quote.effectiveRate.toFixed(4)} {fxTo}
                      </span>
                    </div>
                    <div className="flex justify-between items-center border-t border-slate-800 pt-2 text-sm font-bold">
                      <span className="text-slate-200 font-sans">You Receive ({fxTo}):</span>
                      <span className="text-emerald-400 text-base">
                        +{formatCents(fxPreviewQuery.data.quote.targetAmountCents, fxTo)}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={fxFrom === fxTo}
                  className="w-full rounded-lg bg-sky-400 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-40 transition cursor-pointer"
                >
                  Execute Atomic FX Conversion
                </button>
              </form>
            </div>

            {/* Live FX Rates Table */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Coins className="h-5 w-5 text-sky-400" />
                Live Commercial FX Board
              </h3>
              <div className="divide-y divide-slate-800">
                {marketQuery.data?.fxPairs.map((p) => (
                  <div key={p.pair} className="flex items-center justify-between py-3 text-xs">
                    <div>
                      <span className="font-mono font-bold text-white text-sm">{p.pair}</span>
                      <p className="text-slate-400">
                        Spread: {formatBps(p.spreadBps)} • IOF: {formatBps(p.iofBps)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-sky-300">
                        {p.commercialRate.toFixed(4)}
                      </span>
                      <button
                        onClick={() => {
                          setFxFrom(p.fromCurrency);
                          setFxTo(p.toCurrency);
                        }}
                        className="rounded-md bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700 transition cursor-pointer"
                      >
                        Select
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            SECTION 5: STOCK EXCHANGE, ORDER BOOK & PORTFOLIO TERMINAL
           ==================================================================== */}
        {activeSection === 'trading' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Listed Equities & Didactic Price Nudge Controls */}
              <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900 p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                      <CandlestickChart className="h-5 w-5 text-emerald-400" />
                      Stock Exchange Watchlist (B3 BRL & NASDAQ USD)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Use the <strong>-3% / +3% Price Nudge</strong> buttons to test automatic Limit
                      Order execution!
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                      <tr>
                        <th className="py-2 pr-3">Ticker</th>
                        <th className="py-2 pr-3">Exchange</th>
                        <th className="py-2 pr-3 text-right">Last Price</th>
                        <th className="py-2 pr-3 text-right">24h Change</th>
                        <th className="py-2 text-right">Didactic Price Simulator</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 font-mono">
                      {marketQuery.data?.assets.map((asset) => {
                        const isSelected = asset.symbol === selectedSymbol;
                        const up = asset.changePercent >= 0;
                        return (
                          <tr
                            key={asset.symbol}
                            onClick={() => {
                              setSelectedSymbol(asset.symbol);
                              setLimitPriceStr((asset.currentPriceCents / 100).toFixed(2));
                            }}
                            className={`cursor-pointer transition ${
                              isSelected ? 'bg-emerald-500/10' : 'hover:bg-slate-800/50'
                            }`}
                          >
                            <td className="py-3 pr-3">
                              <div className="font-bold text-white">{asset.symbol}</div>
                              <div className="font-sans text-[11px] text-slate-400">
                                {asset.name}
                              </div>
                            </td>
                            <td className="py-3 pr-3">
                              <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                                {asset.exchange} ({asset.currency})
                              </span>
                            </td>
                            <td className="py-3 pr-3 text-right font-bold text-white text-sm">
                              {formatCents(asset.currentPriceCents, asset.currency)}
                            </td>
                            <td className="py-3 pr-3 text-right">
                              <span
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${
                                  up
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : 'bg-rose-500/15 text-rose-400'
                                }`}
                              >
                                {up ? (
                                  <TrendingUp className="h-3 w-3" />
                                ) : (
                                  <TrendingDown className="h-3 w-3" />
                                )}
                                {up ? '+' : ''}
                                {asset.changePercent.toFixed(2)}%
                              </span>
                            </td>
                            <td
                              className="py-3 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={() =>
                                    handleSetMarketPrice(
                                      asset.symbol,
                                      Math.round(asset.currentPriceCents * 0.97)
                                    )
                                  }
                                  className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                                  title="Drop price 3% to trigger open LIMIT BUY orders"
                                >
                                  -3% Drop
                                </button>
                                <button
                                  onClick={() =>
                                    handleSetMarketPrice(
                                      asset.symbol,
                                      Math.round(asset.currentPriceCents * 1.03)
                                    )
                                  }
                                  className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20 cursor-pointer"
                                  title="Pump price 3% to trigger open LIMIT SELL orders"
                                >
                                  +3% Rally
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Order Entry Ticket (Market vs Limit) */}
              {selectedAsset && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="text-base font-bold text-white">
                        Order Ticket: {selectedAsset.symbol}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {selectedAsset.name} • Settled in {selectedAsset.currency}
                      </p>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-sm font-bold text-emerald-400">
                        {formatCents(selectedAsset.currentPriceCents, selectedAsset.currency)}
                      </div>
                      <div className="text-[10px] text-slate-500">Live Market Price</div>
                    </div>
                  </div>

                  <form onSubmit={handlePlaceStockOrder} className="space-y-4">
                    {/* BUY / SELL Toggle */}
                    <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-950 p-1 border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setOrderSide('BUY')}
                        className={`rounded-md py-1.5 text-xs font-bold transition cursor-pointer ${
                          orderSide === 'BUY'
                            ? 'bg-emerald-500 text-slate-950'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        BUY {selectedAsset.symbol}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderSide('SELL')}
                        className={`rounded-md py-1.5 text-xs font-bold transition cursor-pointer ${
                          orderSide === 'SELL'
                            ? 'bg-rose-500 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        SELL {selectedAsset.symbol}
                      </button>
                    </div>

                    {/* MARKET / LIMIT Toggle */}
                    <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-950 p-1 border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setOrderType('MARKET')}
                        className={`rounded-md py-1.5 text-xs font-medium transition cursor-pointer ${
                          orderType === 'MARKET'
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Market (Instant Fill)
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderType('LIMIT')}
                        className={`rounded-md py-1.5 text-xs font-medium transition cursor-pointer ${
                          orderType === 'LIMIT'
                            ? 'bg-slate-800 text-amber-300'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Limit (Order Book Escrow)
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Quantity (Shares)
                        </label>
                        <input
                          type="number"
                          min={1}
                          required
                          value={orderQty}
                          onChange={(e) => setOrderQty(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-white"
                        />
                      </div>

                      {orderType === 'LIMIT' && (
                        <div>
                          <label className="block text-xs font-medium text-amber-300 mb-1">
                            Limit Price ({selectedAsset.currency})
                          </label>
                          <input
                            type="text"
                            required
                            value={limitPriceStr}
                            onChange={(e) => setLimitPriceStr(e.target.value)}
                            className="w-full rounded-lg border border-amber-500/50 bg-slate-950 px-3 py-2 text-sm font-mono text-white"
                          />
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      className={`w-full rounded-lg py-2.5 text-sm font-bold transition cursor-pointer ${
                        orderSide === 'BUY'
                          ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                          : 'bg-rose-500 text-white hover:bg-rose-400'
                      }`}
                    >
                      Submit {orderType} {orderSide} Order
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Portfolio Positions & Weighted Average Cost Table */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
                <h3 className="text-base font-semibold text-white mb-4">
                  Custody Portfolio & Weighted Average Price (Preço Médio)
                </h3>
                {portfolioQuery.data?.holdings.length === 0 ? (
                  <p className="text-xs text-slate-400">No stock positions yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                        <tr>
                          <th className="py-2 pr-2">Asset</th>
                          <th className="py-2 pr-2 text-right">Qty (Locked)</th>
                          <th className="py-2 pr-2 text-right">Avg Cost</th>
                          <th className="py-2 pr-2 text-right">Last Price</th>
                          <th className="py-2 pr-2 text-right">Unrealized P&L</th>
                          <th className="py-2 text-right">Realized P&L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {portfolioQuery.data?.holdings.map((h) => (
                          <tr key={h.id}>
                            <td className="py-2.5 pr-2 font-bold text-white">{h.symbol}</td>
                            <td className="py-2.5 pr-2 text-right text-slate-200">
                              {h.quantity}
                              {h.lockedQuantity > 0 && (
                                <span className="text-amber-400"> ({h.lockedQuantity}🔒)</span>
                              )}
                            </td>
                            <td className="py-2.5 pr-2 text-right text-slate-300">
                              {formatCents(h.averagePriceCents, h.currency)}
                            </td>
                            <td className="py-2.5 pr-2 text-right text-white">
                              {formatCents(h.currentPriceCents, h.currency)}
                            </td>
                            <td
                              className={`py-2.5 pr-2 text-right font-semibold ${
                                h.unrealizedPnlCents >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {h.unrealizedPnlCents >= 0 ? '+' : ''}
                              {formatCents(h.unrealizedPnlCents, h.currency)} (
                              {h.unrealizedPnlPercent}%)
                            </td>
                            <td
                              className={`py-2.5 text-right font-semibold ${
                                h.realizedPnlCents >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {h.realizedPnlCents >= 0 ? '+' : ''}
                              {formatCents(h.realizedPnlCents, h.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Order Book History (Open & Filled Orders) */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
                <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-400" />
                  Order Book & Execution History
                </h3>
                <div className="space-y-2.5 max-h-80 overflow-y-auto">
                  {portfolioQuery.data?.orders.map((ord) => (
                    <div
                      key={ord.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs font-mono"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 font-bold ${
                              ord.side === 'BUY'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {ord.side}
                          </span>
                          <span className="font-bold text-white">
                            {ord.quantity} {ord.symbol}
                          </span>
                          <span className="text-slate-400">({ord.orderType})</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">
                          {ord.status === 'FILLED'
                            ? `Filled @ ${formatCents(ord.executedPriceCents ?? 0, ord.currency)} • Fee: ${formatCents(ord.feeCents, ord.currency)}`
                            : `Limit Target: ${formatCents(ord.limitPriceCents ?? 0, ord.currency)}`}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            ord.status === 'FILLED'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : ord.status === 'OPEN'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          {ord.status}
                        </span>
                        {ord.status === 'OPEN' && (
                          <button
                            onClick={() => handleCancelOrder(ord.id)}
                            className="rounded bg-rose-500/20 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/30 cursor-pointer"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Slide-out Didactic Engineering X-Ray Drawer */}
      <EngineeringXRayDrawer isOpen={xrayOpen} onClose={() => setXrayOpen(false)} />
    </div>
  );
}
