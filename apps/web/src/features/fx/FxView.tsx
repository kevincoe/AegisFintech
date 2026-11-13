import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Clock,
  Coins,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  CURRENCY_META,
  formatBps,
  formatCents,
  parseDecimalToCents,
  type CurrencyCode,
} from '@aegis/shared';
import { apiRequest, generateIdempotencyKey } from '../../api/client.js';
import { ConfirmationModal } from '../../components/ConfirmationModal.js';
import type { CheckingAccount, DemoUser, FxPair } from '../../types.js';

interface Props {
  currentUser: DemoUser;
  checkingAccounts: CheckingAccount[];
  fxPairs: FxPair[];
  fxFrom: CurrencyCode;
  fxTo: CurrencyCode;
  onChangeFxFrom: (c: CurrencyCode) => void;
  onChangeFxTo: (c: CurrencyCode) => void;
  onRefreshData: () => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function FxView({
  currentUser,
  checkingAccounts,
  fxPairs,
  fxFrom,
  fxTo,
  onChangeFxFrom,
  onChangeFxTo,
  onRefreshData,
  onToast,
}: Props) {
  const [fxAmountStr, setFxAmountStr] = useState('2500.00');
  const [slippageBps, setSlippageBps] = useState<number>(10);
  const [quoteTtlSeconds, setQuoteTtlSeconds] = useState<number>(30);
  const [fxModalOpen, setFxModalOpen] = useState(false);
  const [latchedFxKey, setLatchedFxKey] = useState('');
  const [isSubmittingFx, setIsSubmittingFx] = useState(false);

  const sourceAcc = useMemo(
    () => checkingAccounts.find((a) => a.currency === fxFrom),
    [checkingAccounts, fxFrom]
  );
  const targetAcc = useMemo(
    () => checkingAccounts.find((a) => a.currency === fxTo),
    [checkingAccounts, fxTo]
  );

  const parsedSourceCents = useMemo(() => {
    try {
      const c = parseDecimalToCents(fxAmountStr);
      return c > 0 ? c : 0;
    } catch {
      return 0;
    }
  }, [fxAmountStr]);

  const fxPreviewQuery = useQuery({
    queryKey: ['fx-quote', fxFrom, fxTo, fxAmountStr],
    queryFn: async () => {
      if (parsedSourceCents <= 0 || fxFrom === fxTo) return null;
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
          sourceAmountCents: parsedSourceCents,
        },
      });
    },
    enabled: parsedSourceCents > 0 && fxFrom !== fxTo,
  });

  // Reset 30-second Quote Lock TTL whenever a fresh quote arrives
  useEffect(() => {
    if (fxPreviewQuery.data?.quote) {
      setQuoteTtlSeconds(30);
    }
  }, [fxPreviewQuery.dataUpdatedAt]);

  useEffect(() => {
    const timer = setInterval(() => {
      setQuoteTtlSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleInvertPair = () => {
    const prevFrom = fxFrom;
    onChangeFxFrom(fxTo);
    onChangeFxTo(prevFrom);
  };

  const handleRefreshQuote = () => {
    fxPreviewQuery.refetch();
    setQuoteTtlSeconds(30);
  };

  const handleOpenFxReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (fxFrom === fxTo) {
      onToast('error', 'Source and target currencies must be different.');
      return;
    }
    if (parsedSourceCents <= 0 || !fxPreviewQuery.data?.quote) {
      onToast('error', 'Enter a valid source amount to lock an FX quote.');
      return;
    }
    if (quoteTtlSeconds === 0) {
      handleRefreshQuote();
      onToast('info', 'Refreshed expired 30-second FX quote lock. Please review the new rate.');
      return;
    }
    if (sourceAcc && parsedSourceCents > sourceAcc.availableBalanceCents) {
      onToast(
        'error',
        `Insufficient available ${fxFrom} balance (${formatCents(sourceAcc.availableBalanceCents, fxFrom)}).`
      );
      return;
    }

    setLatchedFxKey(generateIdempotencyKey('fx'));
    setFxModalOpen(true);
  };

  const handleConfirmFxExchange = async () => {
    if (isSubmittingFx) return;
    setIsSubmittingFx(true);
    try {
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
        idempotencyKey: latchedFxKey,
        body: {
          fromCurrency: fxFrom,
          toCurrency: fxTo,
          sourceAmountCents: parsedSourceCents,
        },
      });
      setFxModalOpen(false);
      onRefreshData();
      onToast(
        'success',
        `Converted ${formatCents(res.exchange.quote.sourceAmountCents, fxFrom)} → ${formatCents(res.exchange.quote.targetAmountCents, fxTo)} via 4-leg Double-Entry Ledger!`
      );
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setIsSubmittingFx(false);
    }
  };

  const quote = fxPreviewQuery.data?.quote;
  const ttlPct = Math.round((quoteTtlSeconds / 30) * 100);
  const isExpiringSoon = quoteTtlSeconds > 0 && quoteTtlSeconds <= 5;
  const isExpired = quoteTtlSeconds === 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* ====================================================================
          LEFT: WISE / REVOLUT-TIER FX SWAP CARD WITH 30s QUOTE LOCK & BACEN VET
         ==================================================================== */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30">
              <ArrowRightLeft className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Instant Multi-Currency FX Desk (BACEN VET)
              </h2>
              <p className="text-xs text-slate-300">
                4-leg cross-currency Double-Entry settlement via{' '}
                <code className="text-sky-300 font-mono">SYS-FX-POOL</code>
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleOpenFxReview} className="space-y-4">
          {/* 1. YOU SEND (SOURCE) */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="fx-from" className="font-semibold text-slate-300">
                1. You Send (Source Currency)
              </label>
              <span className="font-mono tabular-nums text-slate-300">
                Available:{' '}
                <strong className="text-white">
                  {formatCents(sourceAcc?.availableBalanceCents ?? 0, fxFrom)}
                </strong>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                id="fx-from"
                value={fxFrom}
                onChange={(e) => onChangeFxFrom(e.target.value as CurrencyCode)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
              >
                <option value="BRL">🇧🇷 BRL — Brazilian Real</option>
                <option value="USD">🇺🇸 USD — US Dollar</option>
                <option value="EUR">🇪🇺 EUR — Euro</option>
              </select>
              <input
                type="text"
                required
                aria-label={`Source amount in ${fxFrom}`}
                value={fxAmountStr}
                onChange={(e) => setFxAmountStr(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-right text-base font-bold font-mono tabular-nums text-white focus:border-sky-400 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Quick Invert Button */}
          <div className="flex items-center justify-center -my-2">
            <button
              type="button"
              onClick={handleInvertPair}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-3.5 py-1 text-xs font-semibold text-sky-300 hover:border-sky-400 hover:bg-slate-700 transition cursor-pointer shadow"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Invert Pair ({fxFrom} ⇄ {fxTo})
            </button>
          </div>

          {/* 2. RECIPIENT GETS (TARGET) */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="fx-to" className="font-semibold text-slate-300">
                2. You Receive (Target Currency — Net of Spread & IOF)
              </label>
              <span className="font-mono tabular-nums text-slate-300">
                Current Balance:{' '}
                <strong className="text-white">
                  {formatCents(targetAcc?.availableBalanceCents ?? 0, fxTo)}
                </strong>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <select
                id="fx-to"
                value={fxTo}
                onChange={(e) => onChangeFxTo(e.target.value as CurrencyCode)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
              >
                <option value="USD">🇺🇸 USD — US Dollar</option>
                <option value="BRL">🇧🇷 BRL — Brazilian Real</option>
                <option value="EUR">🇪🇺 EUR — Euro</option>
              </select>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3.5 py-2 text-right text-base font-bold font-mono tabular-nums text-emerald-400">
                {quote ? `+${formatCents(quote.targetAmountCents, fxTo)}` : '—'}
              </div>
            </div>
          </div>

          {/* 30-Second Deterministic Quote Lock Timer + Slippage Control */}
          {quote && (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                  <Clock
                    className={`h-3.5 w-3.5 ${
                      isExpired
                        ? 'text-rose-400'
                        : isExpiringSoon
                          ? 'text-amber-400'
                          : 'text-sky-400'
                    }`}
                    aria-hidden="true"
                  />
                  {isExpired
                    ? 'Quote Lock Expired'
                    : `Guaranteed Rate Locked (${quoteTtlSeconds}s remaining)`}
                </span>
                <button
                  type="button"
                  onClick={handleRefreshQuote}
                  className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-sky-300 hover:bg-slate-700 cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  Refresh Quote
                </button>
              </div>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
                <div
                  style={{ width: `${ttlPct}%` }}
                  className={`h-full transition-all duration-700 ${
                    isExpired
                      ? 'bg-rose-500'
                      : isExpiringSoon
                        ? 'bg-amber-400'
                        : 'bg-sky-400'
                  }`}
                />
              </div>

              {/* Slippage Guard Selector */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
                <span className="text-slate-300">Max Slippage Protection:</span>
                <div className="flex items-center gap-1">
                  {[
                    { label: 'Auto (10 bps)', bps: 10 },
                    { label: '25 bps', bps: 25 },
                    { label: '50 bps', bps: 50 },
                  ].map((opt) => (
                    <button
                      key={opt.bps}
                      type="button"
                      onClick={() => setSlippageBps(opt.bps)}
                      className={`rounded px-2 py-0.5 font-mono font-semibold transition cursor-pointer ${
                        slippageBps === opt.bps
                          ? 'bg-sky-400 text-slate-950'
                          : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* BACEN VET (Valor Efetivo Total) Regulatory Breakdown */}
          {quote && (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 text-xs font-mono tabular-nums">
              <div className="text-[11px] font-sans font-semibold uppercase tracking-wider text-sky-300 pb-1 border-b border-slate-800 flex items-center justify-between">
                <span>BACEN VET (Valor Efetivo Total) Fee Disclosure</span>
                <span className="font-mono text-slate-300">Law 14.286/2021</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="font-sans">Commercial Mid-Market Rate:</span>
                <span className="text-white">
                  1 {fxFrom} = {quote.commercialRate.toFixed(4)} {fxTo}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="font-sans">
                  Aegis FX Desk Spread ({formatBps(quote.spreadBps)}):
                </span>
                <span className="text-rose-400">
                  -{formatCents(quote.spreadFeeCents, fxFrom)}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="font-sans">Brazilian IOF Tax ({formatBps(quote.iofBps)}):</span>
                <span className="text-rose-400">-{formatCents(quote.iofTaxCents, fxFrom)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="font-sans">Net Principal Converted:</span>
                <span className="text-slate-100">
                  {formatCents(quote.netSourceConvertedCents, fxFrom)}
                </span>
              </div>
              <div className="flex justify-between text-slate-300 border-t border-slate-800 pt-2">
                <span className="font-sans font-semibold text-sky-300">
                  Valor Efetivo Total (VET Effective Rate):
                </span>
                <span className="font-bold text-sky-300">
                  1 {fxFrom} = {quote.effectiveRate.toFixed(4)} {fxTo}
                </span>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={fxFrom === fxTo}
            className="w-full rounded-xl bg-sky-400 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-300 disabled:opacity-40 transition cursor-pointer"
          >
            {isExpired
              ? 'Refresh Expired 30s Quote Lock'
              : `Review Atomic FX Conversion (${formatCents(parsedSourceCents, fxFrom)} → ${quote ? formatCents(quote.targetAmountCents, fxTo) : fxTo}) →`}
          </button>
        </form>
      </div>

      {/* ====================================================================
          RIGHT: LIVE COMMERCIAL FX BOARD
         ==================================================================== */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 h-fit">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Coins className="h-5 w-5 text-sky-400" aria-hidden="true" />
            Live Commercial FX Liquidity Board
          </h3>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30">
            Real-Time Interbank Feed
          </span>
        </div>

        <p className="text-xs text-slate-300">
          Select any currency pair below to populate the FX Swap Desk. Every conversion commits a
          balanced 4-leg transaction across your source checking account, target checking account,
          and <code className="text-sky-300 font-mono">SYS-FX-POOL</code>.
        </p>

        <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950 px-4">
          {fxPairs.map((p) => {
            const isActive = p.fromCurrency === fxFrom && p.toCurrency === fxTo;
            const fromMeta = CURRENCY_META[p.fromCurrency];
            const toMeta = CURRENCY_META[p.toCurrency];
            return (
              <div
                key={p.pair}
                className="flex items-center justify-between py-3.5 text-xs gap-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base" aria-hidden="true">
                      {fromMeta.flag}→{toMeta.flag}
                    </span>
                    <span className="font-mono font-bold text-white text-sm">{p.pair}</span>
                    {isActive && (
                      <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-slate-300 mt-0.5 font-mono text-[11px]">
                    Spread: {formatBps(p.spreadBps)} • IOF: {formatBps(p.iofBps)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono tabular-nums text-sm font-bold text-sky-300">
                    {p.commercialRate.toFixed(4)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeFxFrom(p.fromCurrency);
                      onChangeFxTo(p.toCurrency);
                    }}
                    className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 font-semibold text-slate-200 hover:bg-sky-400 hover:text-slate-950 transition cursor-pointer"
                  >
                    Trade Pair
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300 flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <strong className="text-white">Multi-Currency Double-Entry Invariant:</strong> Unlike
            single-currency transfers (2 legs), cross-currency swaps debit your {fxFrom} account,
            credit <code className="font-mono text-slate-200">SYS-FX-POOL-{fxFrom}</code>, debit{' '}
            <code className="font-mono text-slate-200">SYS-FX-POOL-{fxTo}</code>, and credit your{' '}
            {fxTo} account so that <code className="font-mono text-emerald-400">∑ DEBIT = ∑ CREDIT</code>{' '}
            holds independently within every currency!
          </div>
        </div>
      </div>

      {/* ====================================================================
          "THE LAST HONEST MOMENT" CONFIRMATION MODAL FOR FX CONVERSION
         ==================================================================== */}
      {quote && sourceAcc && targetAcc && (
        <ConfirmationModal
          isOpen={fxModalOpen}
          onClose={() => setFxModalOpen(false)}
          title={`Review Multi-Currency FX Swap (${fxFrom} → ${fxTo})`}
          description="Verify your 4-leg cross-currency Double-Entry conversion and BACEN VET effective rate."
          badgeText="4-Leg Atomic FX Swap"
          debitDetails={{
            accountLabel: `${currentUser.name} (${fxFrom} Checking)`,
            accountNumber: `#${sourceAcc.accountNumber}`,
            amountCents: quote.sourceAmountCents,
            currency: fxFrom,
            balanceAfterCents: sourceAcc.availableBalanceCents - quote.sourceAmountCents,
          }}
          creditDetails={{
            accountLabel: `${currentUser.name} (${fxTo} Checking)`,
            accountNumber: `#${targetAcc.accountNumber}`,
            amountCents: quote.targetAmountCents,
            currency: fxTo,
            balanceAfterCents: targetAcc.availableBalanceCents + quote.targetAmountCents,
          }}
          contractItems={[
            {
              label: 'Commercial Mid-Market Rate',
              value: `1 ${fxFrom} = ${quote.commercialRate.toFixed(4)} ${fxTo}`,
              mono: true,
            },
            {
              label: `Institutional Spread (${formatBps(quote.spreadBps)}) + IOF (${formatBps(quote.iofBps)})`,
              value: `-${formatCents(quote.spreadFeeCents + quote.iofTaxCents, fxFrom)}`,
              mono: true,
            },
            {
              label: 'Valor Efetivo Total (VET)',
              value: `1 ${fxFrom} = ${quote.effectiveRate.toFixed(4)} ${fxTo}`,
              mono: true,
              highlight: true,
            },
            {
              label: 'Max Slippage Guard',
              value: `${formatBps(slippageBps)} (${quoteTtlSeconds}s Quote Lock Active)`,
              mono: true,
            },
          ]}
          idempotencyKey={latchedFxKey}
          isSubmitting={isSubmittingFx}
          onConfirm={handleConfirmFxExchange}
          confirmButtonText={`Confirm FX Swap (${formatCents(quote.sourceAmountCents, fxFrom)} → ${formatCents(quote.targetAmountCents, fxTo)})`}
        />
      )}
    </div>
  );
}
