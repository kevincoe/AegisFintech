import {
  Activity,
  CandlestickChart,
  Globe,
  Landmark,
  LogOut,
  Pause,
  PiggyBank,
  Play,
  Send,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { formatCents } from '@aegis/shared';
import type {
  ActiveSection,
  DemoUser,
  MarketAsset,
  SseConnectionStatus,
} from '../types.js';

interface Props {
  currentUser: DemoUser;
  demoUsers: DemoUser[];
  activeSection: ActiveSection;
  onSelectSection: (section: ActiveSection) => void;
  onQuickSwitchUser: (userId: string) => void;
  onOpenXRay: () => void;
  onLogout: () => void;
  assets: MarketAsset[];
  priceFlashMap: Record<string, 'up' | 'down' | undefined>;
  sseStatus: SseConnectionStatus;
  onToggleSsePause: () => void;
  onSelectTicker: (symbol: string) => void;
}

export function AppShell({
  currentUser,
  demoUsers,
  activeSection,
  onSelectSection,
  onQuickSwitchUser,
  onOpenXRay,
  onLogout,
  assets,
  priceFlashMap,
  sseStatus,
  onToggleSsePause,
  onSelectTicker,
}: Props) {
  return (
    <>
      {/* Top Institutional Header & Controls Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Landmark className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white">Aegis FinTech</span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30">
                  ACID Double-Entry Ledger
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Active Session: <strong className="text-white">{currentUser.name}</strong> (Acc:{' '}
                <code className="font-mono text-emerald-400">{currentUser.accountNumber}</code>)
              </p>
            </div>
          </div>

          {/* Instant Demo Account Switcher + SSE Controls + X-Ray Toggle */}
          <div className="flex flex-wrap items-center gap-2.5">
            {demoUsers.length > 0 && (
              <div
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 p-1"
                role="group"
                aria-label="Quick switch demo user"
              >
                <span className="px-2 text-[11px] text-slate-300 flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  Switch User:
                </span>
                {demoUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onQuickSwitchUser(u.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                      u.id === currentUser.id
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {u.name.split(' ')[0]} ({u.accountNumber})
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={onOpenXRay}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition cursor-pointer"
            >
              <Activity className="h-4 w-4" aria-hidden="true" />
              Engineering X-Ray
            </button>

            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign Out"
              title="Sign Out"
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Live Market Quotes Ribbon with WCAG 2.2.2 Pause/Resume Toggle */}
        <div className="border-t border-slate-800/80 bg-slate-950/90 px-6 py-1.5 overflow-x-auto">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 text-xs whitespace-nowrap">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      sseStatus === 'PAUSED'
                        ? 'bg-amber-400'
                        : sseStatus === 'CONNECTED'
                          ? 'bg-emerald-400 animate-pulse'
                          : 'bg-sky-400'
                    }`}
                  />
                  {sseStatus === 'PAUSED' ? 'SSE PAUSED' : 'LIVE SSE MARKET'}
                </span>
                <button
                  type="button"
                  onClick={onToggleSsePause}
                  aria-label={
                    sseStatus === 'PAUSED' ? 'Resume live market stream' : 'Pause live market stream'
                  }
                  className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition cursor-pointer"
                >
                  {sseStatus === 'PAUSED' ? (
                    <>
                      <Play className="h-2.5 w-2.5 text-emerald-400" aria-hidden="true" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-2.5 w-2.5 text-amber-400" aria-hidden="true" />
                      Pause
                    </>
                  )}
                </button>
              </div>

              {assets.map((asset) => {
                const up = asset.changePercent >= 0;
                const flash = priceFlashMap[asset.symbol];
                return (
                  <button
                    key={asset.symbol}
                    type="button"
                    onClick={() => onSelectTicker(asset.symbol)}
                    className={`flex items-center gap-1.5 hover:bg-slate-900 px-2 py-0.5 rounded transition cursor-pointer ${
                      flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''
                    }`}
                  >
                    <span className="font-mono font-bold text-white">{asset.symbol}</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {formatCents(asset.currentPriceCents, asset.currency)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-0.5 font-mono tabular-nums text-[11px] font-semibold ${
                        up ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {up ? (
                        <TrendingUp className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <TrendingDown className="h-3 w-3" aria-hidden="true" />
                      )}
                      {up ? '+' : ''}
                      {asset.changePercent.toFixed(2)}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* Main Domain Navigation Tabs */}
      <nav
        aria-label="Primary platform sections"
        className="border-b border-slate-800 bg-slate-900/50"
      >
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-6 py-2.5">
          {[
            { id: 'dashboard', label: '1. Accounts & Statement', icon: Wallet },
            { id: 'transfers', label: '2. Pix Transfers & Concurrency Lab', icon: Send },
            { id: 'savings', label: '3. Savings Vaults & CDB Yield', icon: PiggyBank },
            { id: 'fx', label: '4. Currency Exchange (FX Desk)', icon: Globe },
            { id: 'trading', label: '5. Stock Terminal & Order Book', icon: CandlestickChart },
            { id: 'crm', label: '6. CRM & Compliance 360', icon: ShieldCheck },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelectSection(tab.id as ActiveSection)}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  active
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
