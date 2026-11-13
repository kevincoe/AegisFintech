import { useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  KeyRound,
  Lock,
  Scale,
  ShieldAlert,
  X,
} from 'lucide-react';
import { formatCents } from '@aegis/shared';
import { getXRayLogs, subscribeXRayLogs, type XRayEventLog } from '../api/client.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function EngineeringXRayDrawer({ isOpen, onClose }: Props) {
  const [logs, setLogs] = useState<XRayEventLog[]>(() => getXRayLogs());
  const [activeTab, setActiveTab] = useState<'live' | 'adr'>('live');

  useEffect(() => {
    return subscribeXRayLogs(() => {
      setLogs([...getXRayLogs()]);
    });
  }, []);

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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/75 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="xray-drawer-title"
    >
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="xray-drawer-title" className="text-base font-semibold text-white">
                Engineering X-Ray Inspector (Didactic Study Mode)
              </h2>
              <p className="text-xs text-slate-300">
                Inspect live Double-Entry Ledger postings, SELECT FOR UPDATE locks & Idempotency
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Engineering X-Ray Inspector"
            className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Sub-navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-6">
          <button
            type="button"
            onClick={() => setActiveTab('live')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium transition cursor-pointer ${
              activeTab === 'live'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
          >
            <Scale className="h-4 w-4" aria-hidden="true" />
            Live Mutation & Ledger Log ({logs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('adr')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium transition cursor-pointer ${
              activeTab === 'adr'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Architectural Decision Records (AGENTS.md & ADRs)
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'live' ? (
            logs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center">
                <Scale className="mx-auto mb-3 h-8 w-8 text-slate-400" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-200">
                  No financial mutations recorded in this browser session yet.
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  Perform a Pix transfer, Bill Payment, FX conversion, Savings deposit, or Stock
                  trade to see its live Double-Entry Ledger postings and lock order here!
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 font-mono font-semibold ${
                            log.statusCode >= 200 && log.statusCode < 300
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          HTTP {log.statusCode}
                        </span>
                        <span className="font-mono font-medium text-slate-200">{log.endpoint}</span>
                      </div>
                      <span className="text-slate-300 font-mono">{log.timestamp}</span>
                    </div>

                    {log.idempotencyKey && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 font-mono text-slate-200">
                          <KeyRound className="h-3 w-3 text-amber-400" aria-hidden="true" />
                          Idempotency-Key: {log.idempotencyKey}
                        </span>
                        {log.replayed !== undefined && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium ${
                              log.replayed
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            {log.replayed
                              ? 'CACHED REPLAY (Zero Duplicate Debit!)'
                              : 'Fresh Execution'}
                          </span>
                        )}
                      </div>
                    )}

                    {log.errorMessage && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-rose-300">
                        <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{log.errorMessage}</span>
                      </div>
                    )}

                    {log.ledgerReceipt && (
                      <div className="mt-3 space-y-2.5">
                        <div className="flex items-center gap-1.5 text-slate-300">
                          <Lock className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                          <span>
                            Deterministic <code className="text-sky-300">SELECT ... FOR UPDATE</code>{' '}
                            Lock Sequence ({log.ledgerReceipt.lockOrderApplied.length} accounts
                            sorted ASC):
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {log.ledgerReceipt.lockOrderApplied.map((accId, idx) => (
                            <span
                              key={accId}
                              className="rounded bg-sky-950/60 px-2 py-0.5 font-mono text-[11px] text-sky-300 border border-sky-800/50"
                            >
                              #{idx + 1}: {accId.slice(0, 8)}...
                            </span>
                          ))}
                        </div>

                        <div className="overflow-x-auto rounded-lg border border-slate-800">
                          <table className="w-full text-left">
                            <thead className="bg-slate-900 text-[11px] uppercase text-slate-300">
                              <tr>
                                <th className="px-3 py-1.5">Account</th>
                                <th className="px-3 py-1.5">Direction</th>
                                <th className="px-3 py-1.5 text-right">Amount</th>
                                <th className="px-3 py-1.5 text-right">Balance After</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums text-[11px]">
                              {log.ledgerReceipt.entries.map((entry) => (
                                <tr key={entry.id}>
                                  <td className="px-3 py-1.5 text-slate-200">
                                    {entry.accountLabel}{' '}
                                    <span className="text-slate-400">({entry.accountNumber})</span>
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <span
                                      className={`rounded px-1.5 py-0.5 font-bold ${
                                        entry.direction === 'DEBIT'
                                          ? 'bg-rose-500/15 text-rose-400'
                                          : 'bg-emerald-500/15 text-emerald-400'
                                      }`}
                                    >
                                      {entry.direction}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-semibold text-white">
                                    {formatCents(entry.amountCents, entry.currency)}
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-slate-300">
                                    {formatCents(entry.balanceAfterCents, entry.currency)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-4 text-xs leading-relaxed text-slate-300">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <h3 className="text-sm font-semibold text-emerald-400">
                  ADR-001: Selective Complexity Budget (AGENTS.md)
                </h3>
                <p className="mt-1 text-slate-300">
                  Instead of 6 layers of pass-through interfaces on simple reads, we apply extreme
                  rigor where financial bugs occur (Double-Entry Ledger, Pessimistic Locking,
                  Idempotency, Integer Cents) and zero-ceremony Vertical Slices for read queries.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <h3 className="text-sm font-semibold text-emerald-400">
                  ADR-002: Double-Entry Bookkeeping & Integer Minor Units
                </h3>
                <p className="mt-1 text-slate-300">
                  Every monetary value is stored in integer cents (
                  <code className="text-slate-200">BIGINT</code>) to eliminate IEEE 754
                  floating-point drift (<code className="text-slate-200">0.1 + 0.2 !== 0.3</code>).
                  Every balance update requires balanced{' '}
                  <code className="text-rose-400">DEBIT</code> and{' '}
                  <code className="text-emerald-400">CREDIT</code> postings summing to zero per
                  currency.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <h3 className="text-sm font-semibold text-emerald-400">
                  ADR-003: Pessimistic Locking (SELECT FOR UPDATE) & Deadlock Immunity
                </h3>
                <p className="mt-1 text-slate-300">
                  Before mutating balances,{' '}
                  <code className="text-sky-300">postLedgerTransaction</code> sorts all unique
                  account UUIDs in ascending order and executes{' '}
                  <code className="text-sky-300">SELECT ... FOR UPDATE</code>. Sorting guarantees
                  that concurrent A→B and B→A transfers lock accounts in the exact same order,
                  making AB-BA deadlocks impossible.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                <h3 className="text-sm font-semibold text-emerald-400">
                  ADR-004: Stock Order Escrow & Weighted Average Cost
                </h3>
                <p className="mt-1 text-slate-300">
                  Open <code className="text-amber-300">LIMIT BUY</code> orders reserve funds in{' '}
                  <code className="text-slate-200">locked_balance_cents</code>; open{' '}
                  <code className="text-amber-300">LIMIT SELL</code> orders reserve shares in{' '}
                  <code className="text-slate-200">locked_quantity</code>. When the SSE market tick
                  crosses the limit price, the engine atomically settles against{' '}
                  <code className="text-slate-200">SYS-MARKET-CLEARING</code>.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
