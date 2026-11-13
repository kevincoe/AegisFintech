import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Download,
  Lock,
  Receipt,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { CURRENCY_META, formatCents, type CurrencyCode } from '@aegis/shared';
import type {
  ActiveSection,
  CheckingAccount,
  NetWorthSummary,
  StatementTx,
} from '../../types.js';

interface Props {
  checkingAccounts: CheckingAccount[];
  netWorth?: NetWorthSummary;
  transactions: StatementTx[];
  onNavigateTransfer: (currency: CurrencyCode) => void;
  onNavigateFx: (fromCurrency: CurrencyCode, toCurrency: CurrencyCode) => void;
  onNavigateSection: (section: ActiveSection) => void;
}

export function DashboardView({
  checkingAccounts,
  netWorth,
  transactions,
  onNavigateTransfer,
  onNavigateFx,
  onNavigateSection,
}: Props) {
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL');

  const totalEscrowBrlCents = useMemo(() => {
    const brlAcc = checkingAccounts.find((a) => a.currency === 'BRL');
    return brlAcc?.lockedBalanceCents ?? 0;
  }, [checkingAccounts]);

  const allocationPercentages = useMemo(() => {
    if (!netWorth || netWorth.totalNetWorthBrlCents <= 0) {
      return { checkingPct: 100, savingsPct: 0, equitiesPct: 0 };
    }
    const total = netWorth.totalNetWorthBrlCents;
    const checkingPct = Math.round((netWorth.totalCheckingBrlCents / total) * 100);
    const savingsPct = Math.round((netWorth.totalSavingsBrlCents / total) * 100);
    const equitiesPct = Math.max(0, 100 - checkingPct - savingsPct);
    return { checkingPct, savingsPct, equitiesPct };
  }, [netWorth]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(transactions.map((t) => t.category)));
    return ['ALL', ...unique];
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (categoryFilter !== 'ALL' && tx.category !== categoryFilter) {
        return false;
      }
      if (currencyFilter !== 'ALL' && tx.primaryImpact.currency !== currencyFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchDesc = tx.description.toLowerCase().includes(q);
        const matchCat = tx.category.toLowerCase().includes(q);
        const matchId = tx.id.toLowerCase().includes(q);
        const matchKey = (tx.idempotencyKey ?? '').toLowerCase().includes(q);
        return matchDesc || matchCat || matchId || matchKey;
      }
      return true;
    });
  }, [transactions, categoryFilter, currencyFilter, searchTerm]);

  const handleExportCsv = () => {
    const header = [
      'Transaction ID',
      'Timestamp',
      'Category',
      'Description',
      'Direction',
      'Currency',
      'Amount Cents',
      'Formatted Amount',
      'Balance After Cents',
      'Idempotency Key',
    ];
    const rows = filteredTransactions.map((tx) => [
      tx.id,
      tx.createdAt,
      tx.category,
      `"${tx.description.replace(/"/g, '""')}"`,
      tx.primaryImpact.direction,
      tx.primaryImpact.currency,
      tx.primaryImpact.amountCents,
      `"${formatCents(tx.primaryImpact.amountCents, tx.primaryImpact.currency)}"`,
      tx.primaryImpact.balanceAfterCents,
      tx.idempotencyKey ?? '',
    ]);
    const csvContent = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `aegis-ledger-statement-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* ====================================================================
          1. MERCURY-TIER CONSOLIDATED NET WORTH VERDICT & LIQUIDITY HIERARCHY
         ==================================================================== */}
      {netWorth && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Consolidated Net Worth Verdict
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                  Mark-to-Market in BRL
                </span>
              </div>
              <div className="mt-1.5 text-3xl font-bold font-mono tabular-nums text-white">
                {formatCents(netWorth.totalNetWorthBrlCents, 'BRL')}
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Real-time aggregation across Multi-Currency Checking, Fixed-Income CDB Vaults, and
                B3/NASDAQ Stock Custody.
              </p>
            </div>

            {totalEscrowBrlCents > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-500/35 bg-amber-950/20 px-4 py-2.5 text-xs">
                <Lock className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                <div>
                  <div className="font-semibold text-amber-300">
                    Order Book Escrow Reserved:{' '}
                    <span className="font-mono tabular-nums">
                      {formatCents(totalEscrowBrlCents, 'BRL')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateSection('trading')}
                    className="text-[11px] text-amber-200 underline hover:text-white cursor-pointer"
                  >
                    Manage open Limit Orders in Stock Terminal →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Horizontal Capital Allocation Bar */}
          <div className="space-y-2">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-950 border border-slate-800">
              <div
                style={{ width: `${allocationPercentages.checkingPct}%` }}
                className="bg-emerald-500 transition-all duration-500"
                title={`Checking Cash: ${allocationPercentages.checkingPct}%`}
              />
              <div
                style={{ width: `${allocationPercentages.savingsPct}%` }}
                className="bg-amber-400 transition-all duration-500"
                title={`Fixed-Income Vaults: ${allocationPercentages.savingsPct}%`}
              />
              <div
                style={{ width: `${allocationPercentages.equitiesPct}%` }}
                className="bg-sky-400 transition-all duration-500"
                title={`Stock Equities: ${allocationPercentages.equitiesPct}%`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                    Operating Cash (Checking)
                  </div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-white">
                    {formatCents(netWorth.totalCheckingBrlCents, 'BRL')}
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold text-emerald-400">
                  {allocationPercentages.checkingPct}%
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />
                    Fixed-Income Yield (CDB)
                  </div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-amber-300">
                    {formatCents(netWorth.totalSavingsBrlCents, 'BRL')}
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold text-amber-300">
                  {allocationPercentages.savingsPct}%
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="h-2.5 w-2.5 rounded-sm bg-sky-400" />
                    Equities Custody (B3 & NASDAQ)
                  </div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-sky-300">
                    {formatCents(netWorth.totalInvestmentsBrlCents, 'BRL')}
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold text-sky-300">
                  {allocationPercentages.equitiesPct}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          2. REVOLUT-TIER MULTI-CURRENCY CHECKING WALLET
         ==================================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {checkingAccounts.map((acc) => {
          const meta = CURRENCY_META[acc.currency];
          return (
            <div
              key={acc.id}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-5 flex flex-col justify-between hover:border-slate-700 transition"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl" aria-hidden="true">
                    {meta.flag}
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-white">
                      {meta.name} ({acc.currency})
                    </h2>
                    <p className="text-[11px] font-mono text-slate-300">
                      Account #{acc.accountNumber}
                    </p>
                  </div>
                </div>
                <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs font-semibold text-slate-200 border border-slate-700">
                  {acc.currency}
                </span>
              </div>

              <div className="my-4 space-y-1">
                <div className="text-xs text-slate-300">Available Liquid Balance</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-white">
                  {formatCents(acc.availableBalanceCents, acc.currency)}
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-300 pt-1">
                  <span>Total Ledger Balance:</span>
                  <span>{formatCents(acc.balanceCents, acc.currency)}</span>
                </div>
                {acc.lockedBalanceCents > 0 && (
                  <div className="mt-1.5 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-950/20 px-2.5 py-1 text-[11px] font-mono tabular-nums text-amber-300">
                    <span>🔒 Order Escrow Locked:</span>
                    <span className="font-bold">
                      {formatCents(acc.lockedBalanceCents, acc.currency)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => onNavigateTransfer(acc.currency)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 py-2 text-xs font-semibold text-slate-200 hover:bg-emerald-500 hover:text-slate-950 transition cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  Transfer {acc.currency}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onNavigateFx(acc.currency, acc.currency === 'BRL' ? 'USD' : 'BRL')
                  }
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 py-2 text-xs font-semibold text-slate-200 hover:bg-sky-400 hover:text-slate-950 transition cursor-pointer"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Convert FX
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ====================================================================
          3. LINEAR-TIER HIGH-DENSITY STATEMENT & DOUBLE-ENTRY AUDIT EXPLORER
         ==================================================================== */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-400" aria-hidden="true" />
              Immutable Double-Entry Statement & Audit Explorer
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Click any transaction row to inspect its balanced{' '}
              <code className="text-rose-400 font-mono">DEBIT</code> and{' '}
              <code className="text-emerald-400 font-mono">CREDIT</code> ledger postings (
              <code className="text-slate-200 font-mono">∑ DEBIT === ∑ CREDIT</code>).
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredTransactions.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-emerald-500/50 hover:bg-slate-800 disabled:opacity-40 transition cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            Export Minor-Unit CSV ({filteredTransactions.length})
          </button>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search description, counterparty, category, or Idempotency-Key..."
              aria-label="Filter statement transactions"
              className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-400 focus:border-emerald-500 focus:outline-hidden"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Category Filter Chips */}
            <div className="flex flex-wrap items-center gap-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-mono font-semibold transition cursor-pointer ${
                    categoryFilter === cat
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Currency Filter */}
            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              aria-label="Filter by currency"
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-mono text-white"
            >
              <option value="ALL">All Currencies</option>
              <option value="BRL">BRL Only</option>
              <option value="USD">USD Only</option>
              <option value="EUR">EUR Only</option>
            </select>
          </div>
        </div>

        {/* High-Density Transaction Rows */}
        {filteredTransactions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-300">
            No ledger transactions match the current filter criteria.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {filteredTransactions.map((tx) => {
              const isExpanded = expandedTxId === tx.id;
              const isCredit = tx.primaryImpact.direction === 'CREDIT';
              return (
                <div key={tx.id} className="py-3">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedTxId(isExpanded ? null : tx.id)}
                    className="w-full flex flex-wrap items-center justify-between gap-4 cursor-pointer hover:bg-slate-800/50 rounded-xl p-2.5 -m-2.5 transition text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          isCredit
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {isCredit ? (
                          <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{tx.description}</div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300 mt-0.5">
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-200 border border-slate-700">
                            {tx.category}
                          </span>
                          <span className="font-mono tabular-nums">
                            {new Date(tx.createdAt).toLocaleString()}
                          </span>
                          <span className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400 border border-slate-800">
                            {tx.doubleEntryLegs.length} Legs Balanced
                          </span>
                          {tx.idempotencyKey && (
                            <span className="font-mono text-slate-400">
                              Key: {tx.idempotencyKey}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right font-mono tabular-nums">
                        <div
                          className={`text-sm font-bold inline-flex items-center gap-1 ${
                            isCredit ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          <span>{isCredit ? '▲ +' : '▼ -'}</span>
                          <span>
                            {formatCents(tx.primaryImpact.amountCents, tx.primaryImpact.currency)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-300">
                          Balance After:{' '}
                          {formatCents(
                            tx.primaryImpact.balanceAfterCents,
                            tx.primaryImpact.currency
                          )}
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-slate-300" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-300" aria-hidden="true" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs">
                      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-slate-300">
                        <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
                          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                          Double-Entry Bookkeeping Legs (∑ DEBIT = ∑ CREDIT)
                        </span>
                        <span className="font-mono text-[11px] text-slate-300">
                          Transaction UUID: {tx.id}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left font-mono tabular-nums text-[11px]">
                          <thead className="border-b border-slate-800 text-slate-300 uppercase">
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
                                <td className="py-2 pr-4 text-slate-200">
                                  {leg.accountLabel} ({leg.accountNumber})
                                </td>
                                <td className="py-2 pr-4 text-slate-300">{leg.accountType}</td>
                                <td className="py-2 pr-4">
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
                                <td className="py-2 pr-4 text-right font-semibold text-white">
                                  {formatCents(leg.amountCents, leg.currency)}
                                </td>
                                <td className="py-2 text-right text-slate-300">
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
        )}
      </div>
    </div>
  );
}
