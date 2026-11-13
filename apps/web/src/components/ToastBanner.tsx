import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastMessage } from '../types.js';

interface Props {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export function ToastBanner({ toast, onDismiss }: Props) {
  if (!toast) return null;

  const isError = toast.type === 'error';
  const isInfo = toast.type === 'info';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`fixed bottom-5 right-5 z-40 max-w-md rounded-xl border p-4 shadow-2xl flex items-start gap-3 backdrop-blur-md ${
        isError
          ? 'border-rose-500/40 bg-slate-900/95 text-rose-100'
          : isInfo
            ? 'border-sky-500/40 bg-slate-900/95 text-sky-100'
            : 'border-emerald-500/40 bg-slate-900/95 text-emerald-100'
      }`}
    >
      {isError ? (
        <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" aria-hidden="true" />
      ) : isInfo ? (
        <Info className="h-5 w-5 shrink-0 text-sky-400 mt-0.5" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" aria-hidden="true" />
      )}
      <p className="text-xs font-medium leading-relaxed text-slate-100 flex-1">{toast.text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
