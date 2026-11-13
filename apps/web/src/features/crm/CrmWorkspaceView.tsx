import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  FileCheck2,
  Lock,
  MessageSquarePlus,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
  Users,
  XCircle,
} from 'lucide-react';
import {
  formatCents,
  type ConfidentialityLevel,
  type InteractionChannel,
  type KycTier,
  type LifeEventType,
  type RestrictionReason,
  type UpdateSuitabilityInput,
} from '@aegis/shared';
import { apiRequest, generateIdempotencyKey } from '../../api/client.js';
import { SkeletonRows } from '../../components/SkeletonRows.js';
import type { CrmOverviewResponse, MarketAsset } from '../../types.js';

interface Props {
  crmData: CrmOverviewResponse | undefined;
  isLoading: boolean;
  assets: MarketAsset[];
  onRefreshData: () => void;
  onNavigateTrading: (symbol?: string) => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function CrmWorkspaceView({
  crmData,
  isLoading,
  assets,
  onRefreshData,
  onNavigateTrading,
  onToast,
}: Props) {
  // KYC form state
  const [selectedKycTier, setSelectedKycTier] = useState<KycTier>('TIER_2_STANDARD');
  const [isPep, setIsPep] = useState(false);
  const [isSavingKyc, setIsSavingKyc] = useState(false);

  // Suitability 5-dimension form state
  const [objective, setObjective] =
    useState<UpdateSuitabilityInput['investmentObjective']>('BALANCED_GROWTH');
  const [horizonMonths, setHorizonMonths] = useState(36);
  const [liquidityNeed, setLiquidityNeed] =
    useState<UpdateSuitabilityInput['liquidityNeed']>('MEDIUM_6_TO_12M');
  const [experienceLevel, setExperienceLevel] =
    useState<UpdateSuitabilityInput['experienceLevel']>('EQUITIES_AND_ETFS');
  const [maxDrawdownPct, setMaxDrawdownPct] = useState(20);
  const [isSavingSuitability, setIsSavingSuitability] = useState(false);

  // Chinese Wall Redaction toggle for MNPI Interaction Logs
  const [showRedactedView, setShowRedactedView] = useState(false);

  // New Interaction Log form state
  const [channel, setChannel] = useState<InteractionChannel>('VIDEO');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [confidentiality, setConfidentiality] = useState<ConfidentialityLevel>('STANDARD');
  const [isSubmittingInteraction, setIsSubmittingInteraction] = useState(false);

  // New Life Event form state
  const [eventType, setEventType] = useState<LifeEventType>('CAREER_CHANGE');
  const [eventTitle, setEventTitle] = useState('');
  const [eventImpactBrl, setEventImpactBrl] = useState('50000');
  const [requiresReview, setRequiresReview] = useState(true);
  const [isSubmittingEvent, setIsSubmittingEvent] = useState(false);

  // Restricted Security quick-add state
  const [restrictSymbol, setRestrictSymbol] = useState('PETR4');
  const [restrictReason, setRestrictReason] = useState<RestrictionReason>('M_AND_A_ADVISORY');
  const [isTogglingRestriction, setIsTogglingRestriction] = useState(false);

  // Supervisory Override resolution state
  const [rationaleByOrder, setRationaleByOrder] = useState<Record<string, string>>({});
  const [resolvingOrderId, setResolvingOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (crmData?.kycProfile) {
      setSelectedKycTier(crmData.kycProfile.tier);
      setIsPep(crmData.kycProfile.isPep);
    }
    if (crmData?.suitabilityProfile?.questionnaireAnswers) {
      const q = crmData.suitabilityProfile.questionnaireAnswers;
      if (q.investmentObjective) setObjective(q.investmentObjective);
      if (q.horizonMonths) setHorizonMonths(q.horizonMonths);
      if (q.liquidityNeed) setLiquidityNeed(q.liquidityNeed);
      if (q.experienceLevel) setExperienceLevel(q.experienceLevel);
      if (typeof q.maxDrawdownTolerancePct === 'number') {
        setMaxDrawdownPct(q.maxDrawdownTolerancePct);
      }
    }
  }, [crmData?.kycProfile?.id, crmData?.suitabilityProfile?.id]);

  if (isLoading || !crmData) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="h-5 w-64 rounded bg-slate-800 animate-pulse mb-4" />
          <SkeletonRows rows={4} columns={4} label="Loading Salesforce FSC Client 360 profile..." />
        </div>
      </div>
    );
  }

  const {
    kycProfile,
    suitabilityProfile,
    household,
    accountRoles,
    interactions,
    lifeEvents,
    restrictedSecurities,
    complianceOverrides,
    complianceAuditLogs,
  } = crmData;

  const pendingOverrides = complianceOverrides.filter((o) => o.status === 'PENDING');

  const handleSaveKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingKyc(true);
    try {
      await apiRequest('/api/crm/kyc', {
        method: 'PUT',
        body: {
          tier: selectedKycTier,
          isPep,
          pepCategory: isPep ? 'SENIOR_GOV' : null,
          pepDescription: isPep
            ? 'Enhanced AML/PEP Monitoring enabled via Client 360 Compliance Desk'
            : null,
        },
      });
      onRefreshData();
      onToast('success', `KYC verification tier updated to ${selectedKycTier}.`);
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setIsSavingKyc(false);
    }
  };

  const handleSaveSuitability = async (
    overrideInput?: UpdateSuitabilityInput,
    presetLabel?: string
  ) => {
    setIsSavingSuitability(true);
    try {
      const payload: UpdateSuitabilityInput = overrideInput ?? {
        investmentObjective: objective,
        horizonMonths,
        liquidityNeed,
        experienceLevel,
        maxDrawdownTolerancePct: maxDrawdownPct,
      };
      const res = await apiRequest<{
        suitabilityProfile: {
          riskTier: string;
          score: number;
          maxStockConcentrationBps: number;
        };
      }>('/api/crm/suitability', {
        method: 'PUT',
        body: payload,
      });
      onRefreshData();
      onToast(
        'success',
        `${presetLabel ? `${presetLabel}: ` : ''}Suitability calibrated to ${res.suitabilityProfile.riskTier} (Score: ${res.suitabilityProfile.score}/100 • Max Single-Stock Cap: ${(res.suitabilityProfile.maxStockConcentrationBps / 100).toFixed(1)}%).`
      );
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setIsSavingSuitability(false);
    }
  };

  const handleToggleRestriction = async (
    symbol: string,
    isActive: boolean,
    reason: RestrictionReason = 'M_AND_A_ADVISORY'
  ) => {
    setIsTogglingRestriction(true);
    try {
      await apiRequest('/api/compliance/restricted-securities', {
        method: 'POST',
        body: {
          symbol,
          restrictionType: 'RESTRICTED_ALL',
          reason,
          isActive,
        },
      });
      onRefreshData();
      onToast(
        isActive ? 'info' : 'success',
        isActive
          ? `Gate 2 Blackout ACTIVE: ${symbol} added to Restricted Securities List (${reason}).`
          : `Gate 2 Blackout LIFTED: ${symbol} cleared for normal trading.`
      );
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setIsTogglingRestriction(false);
    }
  };

  const handleResolveOverride = async (orderId: string, action: 'APPROVE' | 'REJECT') => {
    const rationale =
      (rationaleByOrder[orderId] ?? '').trim() ||
      (action === 'APPROVE'
        ? 'Supervisory exception granted after reviewing household liquidity and diversification.'
        : 'Order rejected due to excessive single-stock concentration risk.');

    setResolvingOrderId(orderId);
    try {
      const res = await apiRequest<{
        orderStatus: string;
        overrideStatus: string;
      }>(`/api/compliance/overrides/${orderId}/resolve`, {
        method: 'POST',
        idempotencyKey: generateIdempotencyKey(`override-${orderId}`),
        body: {
          action,
          rationale,
        },
      });
      onRefreshData();
      onToast(
        action === 'APPROVE' ? 'success' : 'info',
        `Supervisory Override ${res.overrideStatus}: Order transitioned to ${res.orderStatus}.`
      );
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setResolvingOrderId(null);
    }
  };

  const handleCreateInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !notes.trim()) return;
    setIsSubmittingInteraction(true);
    try {
      await apiRequest('/api/crm/interactions', {
        method: 'POST',
        body: {
          channel,
          subject,
          notes,
          confidentialityLevel: confidentiality,
        },
      });
      setSubject('');
      setNotes('');
      onRefreshData();
      onToast('success', 'Client interaction note logged to compliant timeline.');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setIsSubmittingInteraction(false);
    }
  };

  const handleCreateLifeEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle.trim()) return;
    setIsSubmittingEvent(true);
    try {
      const impactCents = Math.max(0, Math.round((parseFloat(eventImpactBrl) || 0) * 100));
      await apiRequest('/api/crm/life-events', {
        method: 'POST',
        body: {
          eventType,
          title: eventTitle,
          eventDate: new Date().toISOString(),
          financialImpactCents: impactCents,
          requiresSuitabilityReview: requiresReview,
        },
      });
      setEventTitle('');
      onRefreshData();
      onToast('success', 'Life event milestone recorded in Client 360 profile.');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setIsSubmittingEvent(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ====================================================================
          ROW 1: SALESFORCE FSC HOUSEHOLD ROLLUP & PARTY / UBO HIERARCHY
         ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                <h2 className="text-base font-bold text-white">
                  {household ? household.name : 'Individual Wealth Client 360'}
                </h2>
                <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30">
                  Salesforce FSC Party Model
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                {household?.notes ??
                  'Dynamic PostgreSQL household net worth aggregation (view_household_net_worth) with zero denormalized trigger lag.'}
              </p>
            </div>
            {household?.taxIdentifier && (
              <div className="text-right font-mono text-xs">
                <div className="text-slate-400 text-[10px] uppercase">Family Office CNPJ</div>
                <div className="text-slate-200 font-semibold">{household.taxIdentifier}</div>
              </div>
            )}
          </div>

          {/* Dynamic Household Net Worth Rollup KPI Strip */}
          {household && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                <div className="font-sans text-[11px] text-slate-300">Consolidated Net Worth</div>
                <div className="text-base font-bold text-emerald-400 mt-1">
                  {formatCents(household.consolidatedNetWorthCents, 'BRL')}
                </div>
                <div className="font-sans text-[10px] text-slate-400 mt-0.5">
                  Multi-Currency Normalized
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                <div className="font-sans text-[11px] text-slate-300">Household Liquid Cash</div>
                <div className="text-base font-bold text-white mt-1">
                  {formatCents(household.consolidatedCashCents, 'BRL')}
                </div>
                <div className="font-sans text-[10px] text-slate-400 mt-0.5">
                  BRL + USD + EUR Checking
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                <div className="font-sans text-[11px] text-slate-300">Consolidated Equities</div>
                <div className="text-base font-bold text-sky-400 mt-1">
                  {formatCents(household.consolidatedEquityCents, 'BRL')}
                </div>
                <div className="font-sans text-[10px] text-slate-400 mt-0.5">
                  Mark-to-Market Custody
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
                <div className="font-sans text-[11px] text-slate-300">Reserved Escrow Cash</div>
                <div className="text-base font-bold text-amber-400 mt-1">
                  {formatCents(household.consolidatedLockedCashCents, 'BRL')}
                </div>
                <div className="font-sans text-[10px] text-slate-400 mt-0.5">
                  Open Limit & Compliance Holds
                </div>
              </div>
            </div>
          )}

          {/* Household Members & UBO Relationships */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                Household Member Roster
              </h3>
              {household && household.members.length > 0 ? (
                <div className="space-y-2">
                  {household.members.map((m) => (
                    <div
                      key={m.userId}
                      className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900 px-3 py-2 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-white">{m.name}</div>
                        <div className="text-[11px] text-slate-300">{m.email}</div>
                      </div>
                      <div className="text-right space-y-1">
                        <span className="inline-block rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 border border-slate-700">
                          {m.role}
                        </span>
                        {m.isDecisionMaker && (
                          <div className="text-[10px] text-slate-300">Decision Maker • Rollup</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-300">No linked household members.</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
                <Scale className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                UBO & Fiduciary Account Roles
              </h3>
              <div className="space-y-2">
                {household?.partyRelationships.map((rel) => (
                  <div
                    key={rel.id}
                    className="rounded-lg border border-sky-500/30 bg-sky-950/20 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">
                        {rel.sourceUserName} → {rel.targetUserName}
                      </span>
                      {rel.isUbo && (
                        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-300">
                          UBO {(rel.ownershipPercentageBps / 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-300 mt-0.5">
                      Role: {rel.relationshipType} / Reciprocal: {rel.reciprocalType}
                    </div>
                  </div>
                ))}

                {accountRoles.slice(0, 3).map((ar) => (
                  <div
                    key={ar.id}
                    className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900 px-3 py-1.5 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-white">{ar.userName}</span>
                      <span className="text-slate-300"> • {ar.currency} Checking</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[10px]">
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">
                        {ar.roleType}
                      </span>
                      {ar.canTrade && <span className="text-emerald-400">TRADE</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Gate 1 KYC & PEP Surveillance Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                Gate 1: KYC & AML Tier
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Equities trading requires Tier 2+ Verification
              </p>
            </div>
            <span
              className={`rounded-md px-2 py-1 font-mono text-[11px] font-bold ${
                kycProfile.tier === 'TIER_0_UNVERIFIED' || kycProfile.tier === 'TIER_1_SIMPLIFIED'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}
            >
              {kycProfile.tier}
            </span>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-2 text-xs font-mono tabular-nums">
            <div className="flex justify-between">
              <span className="font-sans text-slate-300">Verification Status:</span>
              <span className="font-bold text-emerald-400">{kycProfile.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-sans text-slate-300">Daily Transfer Cap:</span>
              <span className="font-bold text-white">
                {formatCents(kycProfile.dailyTransferLimitCents, 'BRL')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="font-sans text-slate-300">PEP Surveillance Flag:</span>
              <span className={kycProfile.isPep ? 'font-bold text-amber-400' : 'text-slate-300'}>
                {kycProfile.isPep ? `ACTIVE (${kycProfile.pepCategory})` : 'CLEAR'}
              </span>
            </div>
          </div>

          <form onSubmit={handleSaveKyc} className="space-y-3 pt-1">
            <div>
              <label
                htmlFor="kyc-tier-select"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Simulate KYC Tier (Test Gate 1 Block)
              </label>
              <select
                id="kyc-tier-select"
                value={selectedKycTier}
                onChange={(e) => setSelectedKycTier(e.target.value as KycTier)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white"
              >
                <option value="TIER_1_SIMPLIFIED">
                  TIER_1_SIMPLIFIED (Blocks Stock Trading - 403)
                </option>
                <option value="TIER_2_STANDARD">TIER_2_STANDARD (Equities Enabled)</option>
                <option value="TIER_3_ENHANCED">
                  TIER_3_ENHANCED (Private Wealth / Institutional)
                </option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={isPep}
                onChange={(e) => setIsPep(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-emerald-500"
              />
              Politically Exposed Person (PEP Enhanced Monitoring)
            </label>

            <button
              type="submit"
              disabled={isSavingKyc}
              className="w-full rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 py-2 text-xs font-bold text-white transition cursor-pointer disabled:opacity-50"
            >
              {isSavingKyc ? 'Updating KYC Tier...' : 'Apply KYC Tier & Log Audit Event'}
            </button>
          </form>
        </div>
      </div>

      {/* ====================================================================
          ROW 2: 5-DIMENSION SUITABILITY PROFILER + SUPERVISORY COMPLIANCE DESK
         ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 5-Dimension Investor Suitability & Guardrail Profiler */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                Gates 3 & 4: 5-Dimension Suitability Profiler
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                FINRA Rule 2111 / CVM 30 Quantitative Risk & Concentration Guardrails
              </p>
            </div>
            <div className="text-right font-mono tabular-nums">
              <span className="rounded-md bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-xs font-bold text-emerald-300">
                {suitabilityProfile.riskTier} ({suitabilityProfile.score}/100)
              </span>
            </div>
          </div>

          {/* Active Guardrail Metrics */}
          <div className="grid grid-cols-3 gap-3 font-mono tabular-nums text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="font-sans text-[11px] text-slate-300">Max Single-Stock Cap</div>
              <div className="text-sm font-bold text-amber-400 mt-0.5">
                {(suitabilityProfile.maxStockConcentrationBps / 100).toFixed(1)}%
              </div>
              <div className="font-sans text-[10px] text-slate-400">Gate 4 Escrow Threshold</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="font-sans text-[11px] text-slate-300">Max Single Trade</div>
              <div className="text-sm font-bold text-white mt-0.5">
                {formatCents(suitabilityProfile.maxSingleTradeCents, 'BRL')}
              </div>
              <div className="font-sans text-[10px] text-slate-400">Ticket Notional Cap</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="font-sans text-[11px] text-slate-300">Target Horizon</div>
              <div className="text-sm font-bold text-sky-400 mt-0.5">
                {suitabilityProfile.horizonMonths} Months
              </div>
              <div className="font-sans text-[10px] text-slate-400">Valid for 12M</div>
            </div>
          </div>

          {/* 1-Click Didactic Presets to Test Gate 3 & Gate 4 */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-300">
              Quick Calibration Presets (Test Pre-Trade Guardrails):
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  handleSaveSuitability(
                    {
                      investmentObjective: 'CAPITAL_PRESERVATION',
                      horizonMonths: 12,
                      liquidityNeed: 'HIGH_IMMEDIATE',
                      experienceLevel: 'BASIC_FIXED_INCOME',
                      maxDrawdownTolerancePct: 5,
                    },
                    'Conservative Preset'
                  )
                }
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-left text-[11px] hover:bg-amber-500/20 transition cursor-pointer"
              >
                <div className="font-bold text-amber-300">1. Conservative</div>
                <div className="font-mono text-[10px] text-slate-300">
                  15% Cap • Triggers Gate 3 Attestation
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  handleSaveSuitability(
                    {
                      investmentObjective: 'BALANCED_GROWTH',
                      horizonMonths: 48,
                      liquidityNeed: 'MEDIUM_6_TO_12M',
                      experienceLevel: 'EQUITIES_AND_ETFS',
                      maxDrawdownTolerancePct: 20,
                    },
                    'Balanced Growth Preset'
                  )
                }
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-left text-[11px] hover:bg-emerald-500/20 transition cursor-pointer"
              >
                <div className="font-bold text-emerald-300">2. Balanced Growth</div>
                <div className="font-mono text-[10px] text-slate-300">
                  25% Cap • Standard Wealth Tier
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  handleSaveSuitability(
                    {
                      investmentObjective: 'AGGRESSIVE_SPECULATION',
                      horizonMonths: 84,
                      liquidityNeed: 'LOW_LONG_TERM',
                      experienceLevel: 'DERIVATIVES_PRO',
                      maxDrawdownTolerancePct: 35,
                    },
                    'Aggressive Preset'
                  )
                }
                className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-2 text-left text-[11px] hover:bg-sky-500/20 transition cursor-pointer"
              >
                <div className="font-bold text-sky-300">3. Aggressive Pro</div>
                <div className="font-mono text-[10px] text-slate-300">
                  40% Cap • High Concentration
                </div>
              </button>
            </div>
          </div>

          {/* 5-Dimension Custom Questionnaire Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveSuitability();
            }}
            className="grid grid-cols-2 gap-3 pt-1 text-xs"
          >
            <div>
              <label htmlFor="suit-obj" className="block text-slate-300 mb-1">
                1. Primary Objective
              </label>
              <select
                id="suit-obj"
                value={objective}
                onChange={(e) =>
                  setObjective(e.target.value as UpdateSuitabilityInput['investmentObjective'])
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              >
                <option value="CAPITAL_PRESERVATION">Capital Preservation</option>
                <option value="INCOME_GENERATION">Income Generation</option>
                <option value="BALANCED_GROWTH">Balanced Growth</option>
                <option value="AGGRESSIVE_SPECULATION">Aggressive Speculation</option>
              </select>
            </div>

            <div>
              <label htmlFor="suit-exp" className="block text-slate-300 mb-1">
                2. Market Experience
              </label>
              <select
                id="suit-exp"
                value={experienceLevel}
                onChange={(e) =>
                  setExperienceLevel(e.target.value as UpdateSuitabilityInput['experienceLevel'])
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              >
                <option value="NONE">None / Beginner</option>
                <option value="BASIC_FIXED_INCOME">Fixed Income / CDBs</option>
                <option value="EQUITIES_AND_ETFS">Equities & ETFs</option>
                <option value="DERIVATIVES_PRO">Derivatives & Institutional</option>
              </select>
            </div>

            <div>
              <label htmlFor="suit-liq" className="block text-slate-300 mb-1">
                3. Liquidity Need
              </label>
              <select
                id="suit-liq"
                value={liquidityNeed}
                onChange={(e) =>
                  setLiquidityNeed(e.target.value as UpdateSuitabilityInput['liquidityNeed'])
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              >
                <option value="HIGH_IMMEDIATE">High (Immediate Liquidity)</option>
                <option value="MEDIUM_6_TO_12M">Medium (6–12 Months)</option>
                <option value="LOW_LONG_TERM">Low (Multi-Year Lockup OK)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="suit-hor" className="block text-slate-300 mb-1">
                  4. Horizon (Mo)
                </label>
                <input
                  id="suit-hor"
                  type="number"
                  min={1}
                  max={360}
                  value={horizonMonths}
                  onChange={(e) => setHorizonMonths(parseInt(e.target.value || '12', 10))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-white"
                />
              </div>
              <div>
                <label htmlFor="suit-dd" className="block text-slate-300 mb-1">
                  5. Max Loss (%)
                </label>
                <input
                  id="suit-dd"
                  type="number"
                  min={0}
                  max={100}
                  value={maxDrawdownPct}
                  onChange={(e) => setMaxDrawdownPct(parseInt(e.target.value || '10', 10))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-white"
                />
              </div>
            </div>

            <div className="col-span-2">
              <button
                type="submit"
                disabled={isSavingSuitability}
                className="w-full rounded-xl bg-emerald-500 text-slate-950 hover:bg-emerald-400 py-2 text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isSavingSuitability
                  ? 'Recalculating Suitability...'
                  : 'Recalculate 5-Dimension Suitability Score & Update Guardrails'}
              </button>
            </div>
          </form>
        </div>

        {/* Supervisory Compliance Officer Queue & Gate 2 Restricted Securities Control */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-400" aria-hidden="true" />
                Supervisory Compliance Desk (Gates 2 & 4)
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Approve/Reject concentration-held orders & manage MNPI Restricted Securities
              </p>
            </div>
            <span className="rounded-md bg-amber-500/20 border border-amber-500/40 px-2.5 py-1 font-mono text-xs font-bold text-amber-300">
              {pendingOverrides.length} Pending Hold(s)
            </span>
          </div>

          {/* Pending Supervisory Overrides Queue */}
          <div className="space-y-2.5">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Gate 4 Concentration Holds (`PENDING_COMPLIANCE_APPROVAL`)
            </div>

            {pendingOverrides.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-xs text-slate-300 flex items-center justify-between gap-3">
                <span>
                  No orders currently held in compliance escrow. Place a large BUY order exceeding
                  your {(suitabilityProfile.maxStockConcentrationBps / 100).toFixed(0)}% cap to
                  trigger a Gate 4 hold!
                </span>
                <button
                  type="button"
                  onClick={() => onNavigateTrading('PETR4')}
                  className="shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 cursor-pointer"
                >
                  Go to Stock Terminal →
                </button>
              </div>
            ) : (
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {pendingOverrides.map((ov) => (
                  <div
                    key={ov.id}
                    className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3.5 space-y-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-mono font-bold text-white">
                        {ov.side} {ov.quantity} {ov.symbol} ({ov.orderType}) • Escrow Locked:{' '}
                        <span className="text-amber-300">
                          {formatCents(ov.totalGrossCents + ov.feeCents, ov.currency)}
                        </span>
                      </div>
                      <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                        PENDING SIGN-OFF
                      </span>
                    </div>
                    <p className="text-amber-200/90 text-[11px]">{ov.riskViolationReason}</p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        type="text"
                        placeholder="Supervisory rationale (min 5 chars)..."
                        value={rationaleByOrder[ov.orderId] ?? ''}
                        onChange={(e) =>
                          setRationaleByOrder((prev) => ({
                            ...prev,
                            [ov.orderId]: e.target.value,
                          }))
                        }
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                      />
                      <button
                        type="button"
                        disabled={resolvingOrderId === ov.orderId}
                        onClick={() => handleResolveOverride(ov.orderId, 'APPROVE')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Approve & Settle
                      </button>
                      <button
                        type="button"
                        disabled={resolvingOrderId === ov.orderId}
                        onClick={() => handleResolveOverride(ov.orderId, 'REJECT')}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-400 cursor-pointer disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        Reject & Unlock
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Gate 2 Restricted Securities Control Table */}
          <div className="space-y-2.5 border-t border-slate-800 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Gate 2 Restricted Securities Watchlist (MNPI / Blackout)
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Select ticker to restrict"
                  value={restrictSymbol}
                  onChange={(e) => setRestrictSymbol(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-white"
                >
                  {assets.map((a) => (
                    <option key={a.symbol} value={a.symbol}>
                      {a.symbol}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Select restriction reason"
                  value={restrictReason}
                  onChange={(e) => setRestrictReason(e.target.value as RestrictionReason)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-white"
                >
                  <option value="M_AND_A_ADVISORY">M&A Advisory</option>
                  <option value="MNPI_INSIDER">MNPI Insider Wall</option>
                  <option value="UNDERWRITING_BLACKOUT">Underwriting Blackout</option>
                </select>
                <button
                  type="button"
                  disabled={isTogglingRestriction}
                  onClick={() => handleToggleRestriction(restrictSymbol, true, restrictReason)}
                  className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                >
                  + Restrict Ticker
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {restrictedSecurities.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-white">{r.symbol}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                          r.isActive
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {r.isActive ? `BLOCKED (${r.reason})` : 'INACTIVE'}
                      </span>
                    </div>
                    {r.notes && <div className="text-[11px] text-slate-300 mt-0.5">{r.notes}</div>}
                  </div>
                  <button
                    type="button"
                    disabled={isTogglingRestriction}
                    onClick={() => handleToggleRestriction(r.symbol, !r.isActive, r.reason)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      r.isActive
                        ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                        : 'border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                    }`}
                  >
                    {r.isActive ? (
                      <>
                        <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                        Lift Blackout
                      </>
                    ) : (
                      <>
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        Re-Activate
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ====================================================================
          ROW 3: ADVISOR INTERACTION TIMELINE (MNPI REDACTION) & LIFE EVENTS
         ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Compliant Advisor Interaction Logs */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <MessageSquarePlus className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                Advisor Interaction Summaries (Compliant Sharing)
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Chronological advisory log with MNPI Chinese Wall redaction preview
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRedactedView((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 cursor-pointer"
            >
              {showRedactedView ? (
                <>
                  <Eye className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  Showing Redacted (Chinese Wall)
                </>
              ) : (
                <>
                  <EyeOff className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                  Preview Chinese Wall Redaction
                </>
              )}
            </button>
          </div>

          <div className="space-y-2.5 max-h-60 overflow-y-auto">
            {interactions.map((item) => {
              const displayNotes =
                showRedactedView && item.redactedNotes ? item.redactedNotes : item.notes;
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-white">{item.subject}</span>
                    <div className="flex items-center gap-1.5 font-mono text-[10px]">
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                        {item.channel}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-bold ${
                          item.confidentialityLevel === 'RESTRICTED_MNPI'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-emerald-500/15 text-emerald-300'
                        }`}
                      >
                        {item.confidentialityLevel}
                      </span>
                    </div>
                  </div>
                  <p className="text-slate-300 leading-relaxed">{displayNotes}</p>
                  <div className="text-[10px] text-slate-400 font-mono">
                    Logged by {item.advisorName} • {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Log New Interaction Form */}
          <form
            onSubmit={handleCreateInteraction}
            className="space-y-2.5 border-t border-slate-800 pt-3 text-xs"
          >
            <div className="grid grid-cols-3 gap-2">
              <select
                aria-label="Interaction channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as InteractionChannel)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              >
                <option value="VIDEO">VIDEO CALL</option>
                <option value="IN_PERSON">IN PERSON</option>
                <option value="PHONE">PHONE</option>
                <option value="EMAIL">EMAIL</option>
              </select>
              <select
                aria-label="Confidentiality level"
                value={confidentiality}
                onChange={(e) => setConfidentiality(e.target.value as ConfidentialityLevel)}
                className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
              >
                <option value="STANDARD">STANDARD (Full Team Visibility)</option>
                <option value="CONFIDENTIAL">CONFIDENTIAL (Private Wealth)</option>
                <option value="RESTRICTED_MNPI">RESTRICTED_MNPI (Auto-Redacted Wall)</option>
              </select>
            </div>
            <input
              type="text"
              required
              placeholder="Interaction subject (e.g., Q4 FX Hedge & Portfolio Rebalancing)..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-white"
            />
            <div className="flex gap-2">
              <input
                type="text"
                required
                placeholder="Detailed advisory notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-white"
              />
              <button
                type="submit"
                disabled={isSubmittingInteraction}
                className="rounded-lg bg-emerald-500 px-3.5 py-1.5 font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer disabled:opacity-50"
              >
                Log Note
              </button>
            </div>
          </form>
        </div>

        {/* Salesforce FSC Person Life Events & SEC 17a-4 Cryptographic Audit Trail */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-5">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Calendar className="h-5 w-5 text-sky-400" aria-hidden="true" />
              Person Life Events & SEC 17a-4 Audit Chain
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Client milestones triggering suitability review & immutable HMAC-SHA256 compliance logs
            </p>
          </div>

          <div className="space-y-2 max-h-40 overflow-y-auto">
            {lifeEvents.map((ev) => (
              <div
                key={ev.id}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-300">
                      {ev.eventType}
                    </span>
                    <span className="font-bold text-white">{ev.title}</span>
                  </div>
                  {ev.description && (
                    <div className="text-[11px] text-slate-300 mt-0.5">{ev.description}</div>
                  )}
                </div>
                <div className="text-right font-mono tabular-nums">
                  <div className="font-bold text-emerald-400">
                    {formatCents(ev.financialImpactCents, 'BRL')}
                  </div>
                  {ev.requiresSuitabilityReview && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-300">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      Review Due
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Quick Add Life Event */}
          <form onSubmit={handleCreateLifeEvent} className="grid grid-cols-3 gap-2 text-xs">
            <select
              aria-label="Life event type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as LifeEventType)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-white"
            >
              <option value="CAREER_CHANGE">CAREER_CHANGE</option>
              <option value="HOME_PURCHASE">HOME_PURCHASE</option>
              <option value="INHERITANCE">INHERITANCE</option>
              <option value="RETIREMENT">RETIREMENT</option>
            </select>
            <input
              type="text"
              required
              placeholder="Milestone title..."
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white"
            />
            <div className="flex gap-1.5">
              <input
                type="number"
                min={0}
                value={eventImpactBrl}
                onChange={(e) => setEventImpactBrl(e.target.value)}
                aria-label="Financial impact in BRL"
                className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-white"
              />
              <button
                type="submit"
                disabled={isSubmittingEvent}
                className="flex-1 rounded-lg bg-sky-500 px-2.5 py-1.5 font-bold text-slate-950 hover:bg-sky-400 cursor-pointer"
              >
                + Event
              </button>
            </div>
          </form>

          {/* SEC 17a-4 Immutable Compliance Audit Log */}
          <div className="border-t border-slate-800 pt-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                SEC 17a-4 Immutable Compliance Audit Trail (HMAC-SHA256)
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                {complianceAuditLogs.length} Records
              </span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto font-mono text-[11px]">
              {complianceAuditLogs.slice(0, 10).map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-950 px-3 py-1.5"
                >
                  <div className="truncate">
                    <span
                      className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        log.decision === 'ALLOW'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : log.decision === 'BLOCK'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {log.decision}
                    </span>
                    <span className="font-bold text-white">{log.eventType}</span>
                    <span className="text-slate-400"> • {log.ruleEvaluated}</span>
                  </div>
                  <span
                    className="shrink-0 text-[10px] text-slate-400"
                    title={`HMAC-SHA256: ${log.recordHash}`}
                  >
                    #{log.recordHash.slice(0, 10)}…
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
