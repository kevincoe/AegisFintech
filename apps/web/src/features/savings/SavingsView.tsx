import React, { useState } from 'react';
import { FastForward, PiggyBank, Sparkles } from 'lucide-react';
import {
  formatBps,
  formatCents,
  parseDecimalToCents,
  type SavingsProductType,
} from '@aegis/shared';
import { apiRequest, generateIdempotencyKey } from '../../api/client.js';
import type { CheckingAccount, SavingsVaultItem } from '../../types.js';

interface Props {
  vaults: SavingsVaultItem[];
  checkingAccounts: CheckingAccount[];
  onRefreshData: () => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function SavingsView({
  vaults,
  checkingAccounts,
  onRefreshData,
  onToast,
}: Props) {
  const [newVaultName, setNewVaultName] = useState('Europe Trip & Reserve');
  const [newVaultProduct, setNewVaultProduct] =
    useState<SavingsProductType>('CDB_PLUS_120_CDI');
  const [newVaultDepositStr, setNewVaultDepositStr] = useState('2000.00');
  const [vaultMoveAmounts, setVaultMoveAmounts] = useState<Record<string, string>>({});
  const [busyVaultId, setBusyVaultId] = useState<string | null>(null);

  const brlChecking = checkingAccounts.find((a) => a.currency === 'BRL');

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
      onRefreshData();
      onToast('success', `Created vault "${newVaultName}"!`);
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  };

  const handleVaultMove = async (vaultId: string, action: 'deposit' | 'redeem') => {
    if (busyVaultId) return;
    setBusyVaultId(vaultId);
    try {
      const rawAmount = vaultMoveAmounts[vaultId] || '500.00';
      const amountCents = parseDecimalToCents(rawAmount);
      await apiRequest(`/api/savings/vaults/${vaultId}/${action}`, {
        method: 'POST',
        idempotencyKey: generateIdempotencyKey(`vault-${action}`),
        body: { amountCents },
      });
      onRefreshData();
      onToast(
        'success',
        `${action === 'deposit' ? 'Deposited' : 'Redeemed'} ${formatCents(amountCents, 'BRL')}`
      );
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyVaultId(null);
    }
  };

  const handleSimulateYield = async (vaultId: string, businessDays: number) => {
    if (busyVaultId) return;
    setBusyVaultId(vaultId);
    try {
      const res = await apiRequest<{ yieldAccruedCents: number }>(
        `/api/savings/vaults/${vaultId}/simulate-yield`,
        {
          method: 'POST',
          idempotencyKey: generateIdempotencyKey('vault-yield'),
          body: { businessDays },
        }
      );
      onRefreshData();
      onToast(
        'success',
        `Time-Travel (+${businessDays} business days): Accrued +${formatCents(res.yieldAccruedCents, 'BRL')} compound CDI yield!`
      );
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyVaultId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Create New Vault Form */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 h-fit">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <PiggyBank className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Create Savings Vault / CDB</h2>
            <p className="text-xs text-slate-300">
              Each vault is backed by an isolated Double-Entry ledger account
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateVault} className="space-y-4">
          <div>
            <label htmlFor="vault-name" className="block text-xs font-medium text-slate-300 mb-1">
              Vault / Financial Goal Name
            </label>
            <input
              id="vault-name"
              type="text"
              required
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label
              htmlFor="vault-product"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Fixed-Income Product (B3 252-Day CDI Convention)
            </label>
            <select
              id="vault-product"
              value={newVaultProduct}
              onChange={(e) => setNewVaultProduct(e.target.value as SavingsProductType)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
            >
              <option value="EMERGENCY_VAULT_100_CDI">
                Emergency Vault — 100% CDI (11.25% p.a. • T+0 Liquidity)
              </option>
              <option value="CDB_LIQUIDEZ_110_CDI">
                CDB Daily Liquidity — 110% CDI (12.38% p.a. • T+0 Liquidity)
              </option>
              <option value="CDB_PLUS_120_CDI">
                CDB Plus High Yield — 120% CDI (13.50% p.a. • Institutional)
              </option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="vault-deposit" className="block text-xs font-medium text-slate-300">
                Initial Deposit (BRL)
              </label>
              {brlChecking && (
                <span className="font-mono text-[11px] text-emerald-400">
                  Avail: {formatCents(brlChecking.availableBalanceCents, 'BRL')}
                </span>
              )}
            </div>
            <input
              id="vault-deposit"
              type="text"
              value={newVaultDepositStr}
              onChange={(e) => setNewVaultDepositStr(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm font-mono tabular-nums text-white"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 transition cursor-pointer"
          >
            Open Yield Vault
          </button>
        </form>
      </div>

      {/* Active Vaults List & Time-Travel Simulator */}
      <div className="lg:col-span-2 space-y-4">
        {vaults.map((vault) => {
          const yieldRatioPct =
            vault.totalBalanceCents > 0
              ? Math.min(100, (vault.accruedYieldCents / vault.totalBalanceCents) * 100)
              : 0;
          return (
            <div
              key={vault.id}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">{vault.name}</h3>
                    <span className="rounded-md bg-amber-500/15 px-2 py-0.5 font-mono text-xs font-semibold text-amber-300 border border-amber-500/30">
                      {vault.cdiPercentage}% CDI ({formatBps(vault.annualRateBps)} p.a.)
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Simulated Time Elapsed:{' '}
                    <strong className="text-white">{vault.simulatedDaysElapsed}</strong> business
                    days (252 business days/year convention)
                  </p>
                </div>

                <div className="text-right font-mono tabular-nums">
                  <div className="text-xs text-slate-300">Total Vault Balance</div>
                  <div className="text-2xl font-bold text-white">
                    {formatCents(vault.totalBalanceCents, vault.currency)}
                  </div>
                </div>
              </div>

              {/* Principal vs Accrued Yield Breakdown */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-950 p-3.5 border border-slate-800/80 font-mono tabular-nums text-xs">
                  <div>
                    <span className="text-slate-300 font-sans">Principal Deposited:</span>
                    <div className="text-sm font-semibold text-slate-100 mt-0.5">
                      {formatCents(vault.principalCents, vault.currency)}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-300 font-sans flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                      Compound Interest Accrued:
                    </span>
                    <div className="text-sm font-bold text-emerald-400 mt-0.5">
                      +{formatCents(vault.accruedYieldCents, vault.currency)}
                    </div>
                  </div>
                </div>

                {/* Visual Principal vs Yield Bar */}
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-950 border border-slate-800">
                  <div
                    style={{ width: `${100 - yieldRatioPct}%` }}
                    className="bg-amber-400/80"
                    title="Principal"
                  />
                  <div
                    style={{ width: `${yieldRatioPct}%` }}
                    className="bg-emerald-400"
                    title="Accrued Compound Yield"
                  />
                </div>
              </div>

              {/* Deposit / Redeem Controls */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  type="text"
                  aria-label={`Transfer amount for ${vault.name}`}
                  placeholder="500.00"
                  value={vaultMoveAmounts[vault.id] ?? '500.00'}
                  onChange={(e) =>
                    setVaultMoveAmounts((prev) => ({ ...prev, [vault.id]: e.target.value }))
                  }
                  className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-mono tabular-nums text-white"
                />
                <button
                  type="button"
                  disabled={busyVaultId === vault.id}
                  onClick={() => handleVaultMove(vault.id, 'deposit')}
                  className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50 transition cursor-pointer"
                >
                  + Deposit from Checking
                </button>
                <button
                  type="button"
                  disabled={busyVaultId === vault.id}
                  onClick={() => handleVaultMove(vault.id, 'redeem')}
                  className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition cursor-pointer"
                >
                  - Redeem to Checking (T+0)
                </button>
              </div>

              {/* Didactic Time-Travel Yield Accrual Bar */}
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-amber-200">
                  <FastForward className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>Didactic Time-Travel:</strong> Accrue compound interest from{' '}
                    <code className="font-mono text-amber-300">SYS-TREASURY</code>:
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
                      type="button"
                      disabled={busyVaultId === vault.id}
                      onClick={() => handleSimulateYield(vault.id, btn.days)}
                      className="rounded-lg bg-amber-400/20 border border-amber-400/40 px-2.5 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-400/30 disabled:opacity-50 transition cursor-pointer"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
