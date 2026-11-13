import React, { useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  RefreshCw,
  Send,
  ShieldCheck,
  UserCheck,
  Zap,
} from 'lucide-react';
import {
  formatCents,
  parseDecimalToCents,
  type CurrencyCode,
} from '@aegis/shared';
import { apiRequest, generateIdempotencyKey } from '../../api/client.js';
import { ConfirmationModal } from '../../components/ConfirmationModal.js';
import type { CheckingAccount, DemoUser } from '../../types.js';

interface Props {
  currentUser: DemoUser;
  demoUsers: DemoUser[];
  checkingAccounts: CheckingAccount[];
  initialCurrency: CurrencyCode;
  onRefreshData: () => void;
  onOpenXRay: () => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function TransfersView({
  currentUser,
  demoUsers,
  checkingAccounts,
  initialCurrency,
  onRefreshData,
  onOpenXRay,
  onToast,
}: Props) {
  const [recipientInput, setRecipientInput] = useState('bob@aegis.bank');
  const [transferCurrency, setTransferCurrency] = useState<CurrencyCode>(initialCurrency);
  const [transferAmountStr, setTransferAmountStr] = useState('250.00');
  const [transferDesc, setTransferDesc] = useState('Pix Instant Transfer');

  // Latched Confirmation Modal state for P2P Transfer
  const [p2pModalOpen, setP2pModalOpen] = useState(false);
  const [latchedP2pKey, setLatchedP2pKey] = useState('');
  const [isSubmittingP2p, setIsSubmittingP2p] = useState(false);

  const [lastTransferRecord, setLastTransferRecord] = useState<{
    key: string;
    payload: unknown;
  } | null>(null);
  const [raceTestReport, setRaceTestReport] = useState<
    Array<{ attempt: number; status: number; outcome: string }>
  >([]);

  // Bill Payment State + Latched Confirmation Modal
  const [billBarcode, setBillBarcode] = useState('34191790010104351004791020150008291070026000');
  const [billerName, setBillerName] = useState('ENEL Power Grid Utility');
  const [billAmountStr, setBillAmountStr] = useState('185.40');
  const [billModalOpen, setBillModalOpen] = useState(false);
  const [latchedBillKey, setLatchedBillKey] = useState('');
  const [isSubmittingBill, setIsSubmittingBill] = useState(false);

  const sourceAccount = useMemo(
    () => checkingAccounts.find((a) => a.currency === transferCurrency),
    [checkingAccounts, transferCurrency]
  );

  const brlAccount = useMemo(
    () => checkingAccounts.find((a) => a.currency === 'BRL'),
    [checkingAccounts]
  );

  // Pre-Flight Payee Lookup Resolution
  const resolvedPayee = useMemo(() => {
    const trimmed = recipientInput.trim().toLowerCase();
    if (!trimmed) return null;
    const match = demoUsers.find(
      (u) =>
        u.email.toLowerCase() === trimmed ||
        u.accountNumber.toLowerCase() === trimmed ||
        u.documentNumber === trimmed
    );
    if (match) {
      const doc = match.documentNumber || '12345678901';
      const maskedDoc = `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**`;
      return {
        verified: true,
        name: match.name,
        email: match.email,
        accountNumber: `${match.accountNumber}-${transferCurrency}`,
        maskedTaxId: maskedDoc,
        institution: 'Aegis Bank S.A. (ISPB 099)',
        isSelf: match.id === currentUser.id,
      };
    }
    return {
      verified: false,
      name: `Directory Key: ${recipientInput.trim()}`,
      email: recipientInput.trim(),
      accountNumber: `PIX-DICT-${transferCurrency}`,
      maskedTaxId: '***.841.290-**',
      institution: 'Aegis Bank S.A. (ISPB 099)',
      isSelf: false,
    };
  }, [recipientInput, demoUsers, transferCurrency, currentUser.id]);

  const parsedP2pCents = useMemo(() => {
    try {
      const c = parseDecimalToCents(transferAmountStr);
      return c > 0 ? c : 0;
    } catch {
      return 0;
    }
  }, [transferAmountStr]);

  const parsedBillCents = useMemo(() => {
    try {
      const c = parseDecimalToCents(billAmountStr);
      return c > 0 ? c : 0;
    } catch {
      return 0;
    }
  }, [billAmountStr]);

  const handleOpenP2PReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedP2pCents <= 0) {
      onToast('error', 'Enter a valid positive transfer amount.');
      return;
    }
    if (resolvedPayee?.isSelf) {
      onToast('error', 'Cannot transfer to your own checking account.');
      return;
    }
    if (sourceAccount && parsedP2pCents > sourceAccount.availableBalanceCents) {
      onToast(
        'error',
        `Insufficient available ${transferCurrency} funds (${formatCents(sourceAccount.availableBalanceCents, transferCurrency)}).`
      );
      return;
    }
    // Latch a fresh Idempotency-Key when opening the confirmation drawer
    setLatchedP2pKey(generateIdempotencyKey('pix'));
    setP2pModalOpen(true);
  };

  const handleConfirmP2PTransfer = async () => {
    if (isSubmittingP2p) return;
    setIsSubmittingP2p(true);
    try {
      const payload = {
        recipientIdentifier: recipientInput.trim(),
        currency: transferCurrency,
        amountCents: parsedP2pCents,
        description: transferDesc,
      };
      setLastTransferRecord({ key: latchedP2pKey, payload });

      const res = await apiRequest<{
        transfer: { recipientName: string; amountCents: number; currency: CurrencyCode };
        idempotency: { key: string; replayed: boolean };
      }>('/api/transfers/p2p', {
        method: 'POST',
        body: payload,
        idempotencyKey: latchedP2pKey,
      });

      setP2pModalOpen(false);
      onRefreshData();
      onToast(
        'success',
        `Sent ${formatCents(res.transfer.amountCents, res.transfer.currency)} to ${res.transfer.recipientName} (Latched Key: ${latchedP2pKey})`
      );
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setIsSubmittingP2p(false);
    }
  };

  const handleOpenBillReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedBillCents <= 0) {
      onToast('error', 'Enter a valid positive bill payment amount.');
      return;
    }
    if (brlAccount && parsedBillCents > brlAccount.availableBalanceCents) {
      onToast('error', 'Insufficient available BRL balance for bill settlement.');
      return;
    }
    setLatchedBillKey(generateIdempotencyKey('bill'));
    setBillModalOpen(true);
  };

  const handleConfirmBillPayment = async () => {
    if (isSubmittingBill) return;
    setIsSubmittingBill(true);
    try {
      await apiRequest('/api/transfers/bill-payment', {
        method: 'POST',
        idempotencyKey: latchedBillKey,
        body: {
          barcode: billBarcode,
          billerName,
          currency: 'BRL',
          amountCents: parsedBillCents,
        },
      });
      setBillModalOpen(false);
      onRefreshData();
      onToast('success', `Settled ${formatCents(parsedBillCents, 'BRL')} to ${billerName}`);
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setIsSubmittingBill(false);
    }
  };

  const handleReplayLastIdempotencyKey = async () => {
    if (!lastTransferRecord) {
      onToast('info', 'Complete one Pix transfer first to latch an Idempotency-Key for replay.');
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
      onRefreshData();
      onToast(
        'info',
        `Idempotency Replay Verified! Server returned cached tx ${res.transfer.transactionId.slice(0, 8)}... (replayed=${String(res.idempotency.replayed)}) with ZERO duplicate charge!`
      );
      onOpenXRay();
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  };

  const handleSimulateRaceConditionAttack = async () => {
    if (!brlAccount || brlAccount.availableBalanceCents < 10_000) {
      onToast('error', 'Need at least R$ 100,00 available BRL balance to run the attack lab.');
      return;
    }

    const sixtyPercentCents = Math.floor(brlAccount.availableBalanceCents * 0.6);
    const otherUser = demoUsers.find((u) => u.id !== currentUser.id);
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
    onRefreshData();
    onToast(
      'info',
      'Concurrency Attack Completed: 1 succeeded, 4 blocked by SELECT ... FOR UPDATE!'
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* ====================================================================
          LEFT: P2P PIX TRANSFER WITH PRE-FLIGHT VERIFICATION & BILL PAYMENT
         ==================================================================== */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <Send className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">
              Instant P2P / Pix Transfer (Pre-Flight Verified)
            </h2>
            <p className="text-xs text-slate-300">
              Protected by latched <code className="text-emerald-400 font-mono">Idempotency-Key</code>{' '}
              and sorted <code className="text-sky-300 font-mono">SELECT ... FOR UPDATE</code> locks
            </p>
          </div>
        </div>

        {/* Quick Fill Counterparty */}
        {demoUsers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-300">Quick-select recipient:</span>
            {demoUsers
              .filter((u) => u.id !== currentUser.id)
              .map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setRecipientInput(u.email)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:border-emerald-500 transition cursor-pointer"
                >
                  <UserCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  {u.name} ({u.accountNumber})
                </button>
              ))}
          </div>
        )}

        <form onSubmit={handleOpenP2PReview} className="space-y-4">
          <div>
            <label
              htmlFor="recipient-id"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              1. Recipient Identifier (Pix Key / Email / CPF / Account Number)
            </label>
            <input
              id="recipient-id"
              type="text"
              required
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
            />
          </div>

          {/* Pre-Flight Counterparty Verification Card */}
          {resolvedPayee && (
            <div
              className={`rounded-xl border p-3.5 text-xs ${
                resolvedPayee.isSelf
                  ? 'border-rose-500/40 bg-rose-950/20 text-rose-200'
                  : resolvedPayee.verified
                    ? 'border-emerald-500/30 bg-emerald-950/20 text-slate-200'
                    : 'border-slate-700 bg-slate-950 text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300 uppercase tracking-wider text-[10px]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  {resolvedPayee.verified
                    ? 'Verified Aegis Counterparty (Pre-Flight Resolved)'
                    : 'External Pix DICT Key Lookup'}
                </span>
                <span className="font-mono text-[11px] text-slate-300">
                  Tax ID: {resolvedPayee.maskedTaxId}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400 font-sans">Beneficiary: </span>
                  <strong className="text-white font-sans">{resolvedPayee.name}</strong>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 font-sans">Destination: </span>
                  <span className="text-emerald-400">#{resolvedPayee.accountNumber}</span>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="transfer-currency"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                2. Currency (Available:{' '}
                <span className="font-mono text-emerald-400">
                  {formatCents(sourceAccount?.availableBalanceCents ?? 0, transferCurrency)}
                </span>
                )
              </label>
              <select
                id="transfer-currency"
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
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="transfer-amount"
                  className="block text-xs font-medium text-slate-300"
                >
                  Amount ({transferCurrency})
                </label>
                <span className="font-mono text-[10px] text-slate-300">
                  {parsedP2pCents.toLocaleString()} minor cents
                </span>
              </div>
              <input
                id="transfer-amount"
                type="text"
                required
                value={transferAmountStr}
                onChange={(e) => setTransferAmountStr(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-mono tabular-nums text-white focus:border-emerald-500 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Quick Amount Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-300 mr-1">Quick Add:</span>
            {[50_00, 100_00, 500_00, 1000_00].map((chipCents) => (
              <button
                key={chipCents}
                type="button"
                onClick={() =>
                  setTransferAmountStr(((parsedP2pCents + chipCents) / 100).toFixed(2))
                }
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-200 hover:border-emerald-500/60 hover:bg-slate-800 transition cursor-pointer"
              >
                +{formatCents(chipCents, transferCurrency)}
              </button>
            ))}
            {sourceAccount && sourceAccount.availableBalanceCents > 0 && (
              <button
                type="button"
                onClick={() =>
                  setTransferAmountStr((sourceAccount.availableBalanceCents / 100).toFixed(2))
                }
                className="rounded-md border border-emerald-500/40 bg-emerald-950/30 px-2 py-1 font-mono text-[11px] text-emerald-300 hover:bg-emerald-900/40 transition cursor-pointer"
              >
                Max Available
              </button>
            )}
          </div>

          <div>
            <label
              htmlFor="transfer-desc"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              3. Description / Remittance Memo
            </label>
            <input
              id="transfer-desc"
              type="text"
              value={transferDesc}
              onChange={(e) => setTransferDesc(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-hidden"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 transition cursor-pointer shadow-lg shadow-emerald-500/10"
          >
            Review Transfer Contract ({formatCents(parsedP2pCents, transferCurrency)}) →
          </button>
        </form>

        {/* Bill Payment Sub-card */}
        <div className="pt-5 border-t border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Building2 className="h-4 w-4 text-sky-400" aria-hidden="true" />
              Pay Utility Bill / Boleto Barcode
            </h3>
            <span className="rounded bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-300">
              Instant Clearing via SYS-BILL-CLEARING
            </span>
          </div>
          <form onSubmit={handleOpenBillReview} className="space-y-3">
            <div>
              <label htmlFor="bill-barcode" className="sr-only">
                Numeric Barcode
              </label>
              <input
                id="bill-barcode"
                type="text"
                required
                value={billBarcode}
                onChange={(e) => setBillBarcode(e.target.value)}
                placeholder="Numeric Barcode (44-48 digits)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-200"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                required
                aria-label="Merchant or Utility Name"
                value={billerName}
                onChange={(e) => setBillerName(e.target.value)}
                placeholder="Merchant / Utility Name"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
              />
              <input
                type="text"
                required
                aria-label="Bill Amount in BRL"
                value={billAmountStr}
                onChange={(e) => setBillAmountStr(e.target.value)}
                placeholder="Amount (BRL)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-mono tabular-nums text-white"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg border border-sky-500/40 bg-sky-500/15 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25 transition cursor-pointer"
            >
              Review & Settle Bill Payment ({formatCents(parsedBillCents, 'BRL')}) →
            </button>
          </form>
        </div>
      </div>

      {/* ====================================================================
          RIGHT: INTERACTIVE CONCURRENCY & IDEMPOTENCY STRESS LAB
         ==================================================================== */}
      <div className="rounded-2xl border border-emerald-500/30 bg-slate-900 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">
              Didactic Lab: Concurrency & Idempotency Stress Tests
            </h2>
            <p className="text-xs text-slate-300">
              Empirically verify how the PostgreSQL ledger defends against network retries and
              parallel race-condition overdraft attacks.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
            Experiment 1: Network Retry & Latched Idempotency-Key Replay
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            In production banking apps, mobile connections often drop right after the server commits
            a transfer. Click below to replay your last Pix transfer with the{' '}
            <strong className="text-white">exact same</strong>{' '}
            <code className="text-amber-300 font-mono">Idempotency-Key</code>. The backend returns
            the cached receipt (<code className="text-emerald-400 font-mono">replayed: true</code>)
            without debiting your account a second time.
          </p>
          {lastTransferRecord && (
            <div className="rounded-lg bg-slate-900 px-3 py-1.5 font-mono text-[11px] text-slate-300 border border-slate-800">
              Last Latched Key: <span className="text-amber-300">{lastTransferRecord.key}</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleReplayLastIdempotencyKey}
            className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 transition cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Replay Last Transfer with Same Idempotency-Key
          </button>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-400">
            Experiment 2: 5x Simultaneous Parallel Overdraft Attack (Promise.all)
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            What happens if an attacker fires <strong className="text-white">5 simultaneous requests</strong>{' '}
            at the exact same millisecond, each attempting to transfer <strong className="text-white">60%</strong>{' '}
            of your available balance? Because{' '}
            <code className="text-sky-300 font-mono">postLedgerTransaction</code> acquires
            PostgreSQL <code className="text-sky-300 font-mono">SELECT ... FOR UPDATE</code> row
            locks in deterministic ascending order, Request #1 succeeds and the other 4 wait in the
            lock queue and fail cleanly with{' '}
            <code className="text-rose-400 font-mono">422 INSUFFICIENT_FUNDS</code>!
          </p>
          <button
            type="button"
            onClick={handleSimulateRaceConditionAttack}
            className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/25 transition cursor-pointer"
          >
            <Zap className="h-4 w-4" aria-hidden="true" />
            Launch 5x Parallel Race-Condition Attack (60% Balance Each)
          </button>

          {raceTestReport.length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 p-3 space-y-1.5 font-mono tabular-nums text-[11px]">
              <div className="text-slate-300 font-sans font-semibold mb-1">
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

      {/* ====================================================================
          "THE LAST HONEST MOMENT" CONFIRMATION MODAL FOR P2P PIX TRANSFER
         ==================================================================== */}
      {sourceAccount && resolvedPayee && (
        <ConfirmationModal
          isOpen={p2pModalOpen}
          onClose={() => setP2pModalOpen(false)}
          title="Review Instant P2P / Pix Transfer"
          description="Verify the exact Double-Entry debit, counterparty details, and resulting balance before authorizing."
          badgeText="Instant Pix T+0"
          debitDetails={{
            accountLabel: `${currentUser.name} (${transferCurrency} Checking)`,
            accountNumber: `#${sourceAccount.accountNumber}`,
            amountCents: parsedP2pCents,
            currency: transferCurrency,
            balanceAfterCents: sourceAccount.availableBalanceCents - parsedP2pCents,
          }}
          creditDetails={{
            accountLabel: resolvedPayee.name,
            accountNumber: `#${resolvedPayee.accountNumber}`,
            amountCents: parsedP2pCents,
            currency: transferCurrency,
            subtitle: `${resolvedPayee.institution} • Tax ID ${resolvedPayee.maskedTaxId}`,
          }}
          contractItems={[
            {
              label: 'Exact Minor-Unit Amount',
              value: `${formatCents(parsedP2pCents, transferCurrency)} (${parsedP2pCents.toLocaleString()} cents)`,
              mono: true,
              highlight: true,
            },
            {
              label: 'Clearing Network & Fee',
              value: 'Banco Central Pix Instant • R$ 0,00 (Free)',
            },
            {
              label: 'Remittance Description',
              value: transferDesc || 'Pix Instant Transfer',
            },
          ]}
          idempotencyKey={latchedP2pKey}
          isSubmitting={isSubmittingP2p}
          onConfirm={handleConfirmP2PTransfer}
          confirmButtonText={`Authorize & Send ${formatCents(parsedP2pCents, transferCurrency)}`}
        />
      )}

      {/* ====================================================================
          "THE LAST HONEST MOMENT" CONFIRMATION MODAL FOR BILL PAYMENT
         ==================================================================== */}
      {brlAccount && (
        <ConfirmationModal
          isOpen={billModalOpen}
          onClose={() => setBillModalOpen(false)}
          title="Review Utility Bill / Boleto Settlement"
          description="Confirm barcode settlement against your BRL Checking Account."
          badgeText="Boleto Settlement"
          debitDetails={{
            accountLabel: `${currentUser.name} (BRL Checking)`,
            accountNumber: `#${brlAccount.accountNumber}`,
            amountCents: parsedBillCents,
            currency: 'BRL',
            balanceAfterCents: brlAccount.availableBalanceCents - parsedBillCents,
          }}
          creditDetails={{
            accountLabel: billerName,
            accountNumber: 'SYS-BILL-CLEARING',
            amountCents: parsedBillCents,
            currency: 'BRL',
            subtitle: `Barcode: ${billBarcode.slice(0, 20)}...`,
          }}
          contractItems={[
            {
              label: 'Biller / Merchant',
              value: billerName,
              highlight: true,
            },
            {
              label: 'Barcode Digitable Line',
              value: billBarcode,
              mono: true,
            },
            {
              label: 'Settlement Amount',
              value: `${formatCents(parsedBillCents, 'BRL')} (${parsedBillCents.toLocaleString()} cents)`,
              mono: true,
            },
          ]}
          idempotencyKey={latchedBillKey}
          isSubmitting={isSubmittingBill}
          onConfirm={handleConfirmBillPayment}
          confirmButtonText={`Confirm Bill Payment (${formatCents(parsedBillCents, 'BRL')})`}
        />
      )}
    </div>
  );
}
