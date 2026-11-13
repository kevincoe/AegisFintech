import { useEffect } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  KeyRound,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import { formatCents, type CurrencyCode } from '@aegis/shared';

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  badgeText?: string;
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
    subtitle?: string;
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

export function ConfirmationModal({
  isOpen,
  onClose,
  title,
  description,
  badgeText = 'ACID Double-Entry Contract',
  debitDetails,
  creditDetails,
  contractItems,
  idempotencyKey,
  isSubmitting,
  onConfirm,
  confirmButtonText,
}: ConfirmationModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 bg-slate-950/60 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="confirm-modal-title" className="text-base font-bold text-white">
                  {title}
                </h2>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300 border border-emerald-500/30">
                  {badgeText}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-300">{description}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close confirmation dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Side-by-Side Debit & Credit Legs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* DEBIT LEG */}
            <div className="rounded-xl border border-rose-500/30 bg-rose-950/15 p-4 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-rose-300">
                <span className="flex items-center gap-1">
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  Debit (Source)
                </span>
                <span className="font-mono">{debitDetails.currency}</span>
              </div>
              <div>
                <div className="text-xs font-semibold text-white truncate">
                  {debitDetails.accountLabel}
                </div>
                <div className="text-[11px] font-mono text-slate-300">
                  {debitDetails.accountNumber}
                </div>
              </div>
              <div className="pt-1 border-t border-rose-500/20">
                <div className="text-lg font-bold font-mono tabular-nums text-rose-400">
                  -{formatCents(debitDetails.amountCents, debitDetails.currency)}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-300 mt-0.5">
                  Balance After:{' '}
                  <strong className="text-white">
                    {formatCents(debitDetails.balanceAfterCents, debitDetails.currency)}
                  </strong>
                </div>
              </div>
            </div>

            {/* CREDIT LEG */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-4 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                <span className="flex items-center gap-1">
                  <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Credit (Destination)
                </span>
                <span className="font-mono">{creditDetails.currency}</span>
              </div>
              <div>
                <div className="text-xs font-semibold text-white truncate">
                  {creditDetails.accountLabel}
                </div>
                <div className="text-[11px] font-mono text-slate-300">
                  {creditDetails.accountNumber}
                </div>
              </div>
              <div className="pt-1 border-t border-emerald-500/20">
                <div className="text-lg font-bold font-mono tabular-nums text-emerald-400">
                  +{formatCents(creditDetails.amountCents, creditDetails.currency)}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-300 mt-0.5">
                  {creditDetails.balanceAfterCents !== undefined ? (
                    <>
                      Balance After:{' '}
                      <strong className="text-white">
                        {formatCents(creditDetails.balanceAfterCents, creditDetails.currency)}
                      </strong>
                    </>
                  ) : (
                    <span>{creditDetails.subtitle ?? 'Verified Counterparty Settlement'}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Contract Specification Items */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2 text-xs">
            {contractItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4">
                <span className="text-slate-300">{item.label}</span>
                <span
                  className={`${item.mono ? 'font-mono tabular-nums' : ''} ${
                    item.highlight ? 'font-bold text-emerald-400' : 'font-medium text-white'
                  } text-right`}
                >
                  {item.value}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-800/80 text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-300">
                <KeyRound className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                Latched Idempotency-Key:
              </span>
              <code className="rounded bg-slate-900 px-2 py-0.5 font-mono text-amber-300 border border-slate-800">
                {idempotencyKey}
              </code>
            </div>
            <div className="flex items-center justify-between gap-4 text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-300">
                <Lock className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                Concurrency Protection:
              </span>
              <span className="font-mono text-sky-300">
                SELECT ... FOR UPDATE (ORDER BY account_id ASC)
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition cursor-pointer"
            >
              Dismiss / Edit
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onConfirm}
              className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition cursor-pointer shadow-lg shadow-emerald-500/10"
            >
              {isSubmitting ? 'Committing Ledger Transaction...' : confirmButtonText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
