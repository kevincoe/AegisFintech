import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrencyCode } from '@aegis/shared';
import { apiRequest, setAuthToken } from './api/client.js';
import { AppShell } from './components/AppShell.js';
import { EngineeringXRayDrawer } from './components/EngineeringXRayDrawer.js';
import { ToastBanner } from './components/ToastBanner.js';
import { AuthScreen } from './features/auth/AuthScreen.js';
import { DashboardView } from './features/dashboard/DashboardView.js';
import { FxView } from './features/fx/FxView.js';
import { SavingsView } from './features/savings/SavingsView.js';
import { TradingView } from './features/trading/TradingView.js';
import { TransfersView } from './features/transfers/TransfersView.js';
import type {
  ActiveSection,
  CheckingAccount,
  DemoUser,
  FxPair,
  MarketAsset,
  NetWorthSummary,
  PortfolioHolding,
  PortfolioOrder,
  SavingsVaultItem,
  SseConnectionStatus,
  StatementTx,
  ToastMessage,
} from './types.js';

export function App() {
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<ActiveSection>('dashboard');
  const [xrayOpen, setXrayOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Cross-section navigation context
  const [transferCurrency, setTransferCurrency] = useState<CurrencyCode>('BRL');
  const [fxFrom, setFxFrom] = useState<CurrencyCode>('BRL');
  const [fxTo, setFxTo] = useState<CurrencyCode>('USD');
  const [selectedSymbol, setSelectedSymbol] = useState('PETR4');

  // SSE stream state & live tick history for SVG candlesticks
  const [sseStatus, setSseStatus] = useState<SseConnectionStatus>('CONNECTING');
  const ssePausedRef = useRef(false);
  const prevPricesRef = useRef<Record<string, number>>({});
  const [priceFlashMap, setPriceFlashMap] = useState<Record<string, 'up' | 'down' | undefined>>(
    {}
  );
  const [liveHistoryBySymbol, setLiveHistoryBySymbol] = useState<Record<string, number[]>>({});

  const showToast = (type: 'success' | 'error' | 'info', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 5500);
  };

  // ============================================================================
  // Queries: Current Session & Financial Domain State
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
        netWorthSummary: NetWorthSummary;
      }>('/api/accounts/summary'),
    enabled: isAuthenticated,
  });

  const statementQuery = useQuery({
    queryKey: ['accounts-statement'],
    queryFn: () => apiRequest<{ transactions: StatementTx[] }>('/api/accounts/statement?limit=35'),
    enabled: isAuthenticated,
  });

  const vaultsQuery = useQuery({
    queryKey: ['savings-vaults'],
    queryFn: () => apiRequest<{ vaults: SavingsVaultItem[] }>('/api/savings/vaults'),
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
        holdings: PortfolioHolding[];
        orders: PortfolioOrder[];
      }>('/api/trading/portfolio'),
    enabled: isAuthenticated,
  });

  const refreshAllFinancialData = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['accounts-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['accounts-statement'] }),
      queryClient.invalidateQueries({ queryKey: ['savings-vaults'] }),
      queryClient.invalidateQueries({ queryKey: ['market-assets'] }),
      queryClient.invalidateQueries({ queryKey: ['trading-portfolio'] }),
    ]);
  };

  // ============================================================================
  // Live SSE Market Stream Subscription with WCAG 2.2.2 Pause/Resume Support
  // ============================================================================
  useEffect(() => {
    if (!isAuthenticated) return;
    setSseStatus(ssePausedRef.current ? 'PAUSED' : 'CONNECTING');
    const source = new EventSource('/api/market/stream');

    source.onopen = () => {
      if (!ssePausedRef.current) {
        setSseStatus('CONNECTED');
      }
    };

    source.onerror = () => {
      if (!ssePausedRef.current) {
        setSseStatus('RECONNECTING');
      }
    };

    source.onmessage = (event) => {
      if (ssePausedRef.current) return;
      try {
        const parsed = JSON.parse(event.data) as {
          assets?: MarketAsset[];
          fxPairs?: FxPair[];
          filledOrdersCount?: number;
        };
        if (parsed.assets && parsed.fxPairs) {
          const flashes: Record<string, 'up' | 'down' | undefined> = {};
          for (const asset of parsed.assets) {
            const prev = prevPricesRef.current[asset.symbol];
            if (prev !== undefined && prev !== asset.currentPriceCents) {
              flashes[asset.symbol] = asset.currentPriceCents > prev ? 'up' : 'down';
            }
            prevPricesRef.current[asset.symbol] = asset.currentPriceCents;
          }

          if (Object.keys(flashes).length > 0) {
            setPriceFlashMap(flashes);
            setTimeout(() => setPriceFlashMap({}), 800);
          }

          setLiveHistoryBySymbol((prev) => {
            const next = { ...prev };
            for (const asset of parsed.assets!) {
              const arr = next[asset.symbol] ?? [];
              next[asset.symbol] = [...arr.slice(-14), asset.currentPriceCents];
            }
            return next;
          });

          queryClient.setQueryData(['market-assets'], {
            assets: parsed.assets,
            fxPairs: parsed.fxPairs,
          });
        }
        if (parsed.filledOrdersCount && parsed.filledOrdersCount > 0) {
          refreshAllFinancialData();
          showToast(
            'info',
            `⚡ Live Market Engine matched ${parsed.filledOrdersCount} open Limit Order(s)! Double-Entry Ledger settled.`
          );
        }
      } catch {
        // Ignore transient SSE parse errors
      }
    };

    return () => {
      source.close();
    };
  }, [isAuthenticated]);

  const handleToggleSsePause = () => {
    const nextPaused = !ssePausedRef.current;
    ssePausedRef.current = nextPaused;
    setSseStatus(nextPaused ? 'PAUSED' : 'CONNECTED');
  };

  // ============================================================================
  // Session Handlers
  // ============================================================================
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

  if (!isAuthenticated) {
    return (
      <>
        <AuthScreen
          demoUsers={demoUsersQuery.data?.users ?? []}
          onAuthenticated={async (msg) => {
            await queryClient.invalidateQueries({ queryKey: ['auth-me'] });
            await queryClient.invalidateQueries({ queryKey: ['demo-users'] });
            refreshAllFinancialData();
            showToast('success', msg);
          }}
          onError={(msg) => showToast('error', msg)}
          onQuickSwitch={handleQuickSwitch}
        />
        <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
      </>
    );
  }

  const currentUser = meQuery.data!.user;
  const checkingAccounts = summaryQuery.data?.checkingAccounts ?? [];
  const netWorth = summaryQuery.data?.netWorthSummary;
  const assets = marketQuery.data?.assets ?? [];
  const fxPairs = marketQuery.data?.fxPairs ?? [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <AppShell
        currentUser={currentUser}
        demoUsers={demoUsersQuery.data?.users ?? []}
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        onQuickSwitchUser={handleQuickSwitch}
        onOpenXRay={() => setXrayOpen(true)}
        onLogout={handleLogout}
        assets={assets}
        priceFlashMap={priceFlashMap}
        sseStatus={sseStatus}
        onToggleSsePause={handleToggleSsePause}
        onSelectTicker={(symbol) => {
          setSelectedSymbol(symbol);
          setActiveSection('trading');
        }}
      />

      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      <main className="mx-auto w-full max-w-7xl flex-1 p-6 space-y-6">
        {activeSection === 'dashboard' && (
          <DashboardView
            checkingAccounts={checkingAccounts}
            netWorth={netWorth}
            transactions={statementQuery.data?.transactions ?? []}
            onNavigateTransfer={(currency) => {
              setTransferCurrency(currency);
              setActiveSection('transfers');
            }}
            onNavigateFx={(from, to) => {
              setFxFrom(from);
              setFxTo(to);
              setActiveSection('fx');
            }}
            onNavigateSection={setActiveSection}
          />
        )}

        {activeSection === 'transfers' && (
          <TransfersView
            currentUser={currentUser}
            demoUsers={demoUsersQuery.data?.users ?? []}
            checkingAccounts={checkingAccounts}
            initialCurrency={transferCurrency}
            onRefreshData={refreshAllFinancialData}
            onOpenXRay={() => setXrayOpen(true)}
            onToast={showToast}
          />
        )}

        {activeSection === 'savings' && (
          <SavingsView
            vaults={vaultsQuery.data?.vaults ?? []}
            checkingAccounts={checkingAccounts}
            onRefreshData={refreshAllFinancialData}
            onToast={showToast}
          />
        )}

        {activeSection === 'fx' && (
          <FxView
            currentUser={currentUser}
            checkingAccounts={checkingAccounts}
            fxPairs={fxPairs}
            fxFrom={fxFrom}
            fxTo={fxTo}
            onChangeFxFrom={setFxFrom}
            onChangeFxTo={setFxTo}
            onRefreshData={refreshAllFinancialData}
            onToast={showToast}
          />
        )}

        {activeSection === 'trading' && (
          <TradingView
            currentUser={currentUser}
            assets={assets}
            checkingAccounts={checkingAccounts}
            holdings={portfolioQuery.data?.holdings ?? []}
            orders={portfolioQuery.data?.orders ?? []}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            liveHistoryBySymbol={liveHistoryBySymbol}
            onRefreshData={refreshAllFinancialData}
            onToast={showToast}
          />
        )}
      </main>

      <EngineeringXRayDrawer isOpen={xrayOpen} onClose={() => setXrayOpen(false)} />
    </div>
  );
}
