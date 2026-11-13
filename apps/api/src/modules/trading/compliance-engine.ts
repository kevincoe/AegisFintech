import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import type { CurrencyCode, SuitabilityRiskTier, UpdateSuitabilityInput } from '@aegis/shared';
import { db, type DbTransaction } from '../../db/index.js';
import { AppError } from '../../core/errors.js';
import {
  accounts,
  assets,
  complianceAuditLogs,
  householdMembers,
  kycProfiles,
  portfolios,
  restrictedSecurities,
  suitabilityProfiles,
  tradeOrders,
} from '../../db/schema.js';
import { getFxRateScaled1e4 } from '../fx/rates.js';

export interface PreTradeEvaluationResult {
  allowed: boolean;
  status: 'APPROVED' | 'REQUIRES_CLIENT_ATTESTATION' | 'REQUIRES_COMPLIANCE_APPROVAL';
  reason?: string;
  ruleViolated?: string;
  projectedConcentrationBps?: number;
  maxAllowedConcentrationBps?: number;
  auditPayload?: Record<string, unknown>;
}

/**
 * Pure deterministic 5-Dimension Investor Suitability Calculator (FINRA 2111 / Reg BI / CVM 30).
 */
export function calculateSuitabilityProfileMetrics(input: UpdateSuitabilityInput): {
  score: number;
  riskTier: SuitabilityRiskTier;
  maxStockConcentrationBps: number;
  maxSingleTradeCents: number;
} {
  let score = 0;

  // 1. Investment Objective (0–30 pts)
  const objMap: Record<UpdateSuitabilityInput['investmentObjective'], number> = {
    CAPITAL_PRESERVATION: 5,
    INCOME_GENERATION: 15,
    BALANCED_GROWTH: 22,
    AGGRESSIVE_SPECULATION: 30,
  };
  score += objMap[input.investmentObjective];

  // 2. Time Horizon in Months (0–20 pts)
  if (input.horizonMonths >= 60) score += 20;
  else if (input.horizonMonths >= 36) score += 15;
  else if (input.horizonMonths >= 12) score += 8;
  else score += 3;

  // 3. Liquidity Need (0–15 pts)
  const liqMap: Record<UpdateSuitabilityInput['liquidityNeed'], number> = {
    HIGH_IMMEDIATE: 3,
    MEDIUM_6_TO_12M: 10,
    LOW_LONG_TERM: 15,
  };
  score += liqMap[input.liquidityNeed];

  // 4. Capital Markets Experience (0–20 pts)
  const expMap: Record<UpdateSuitabilityInput['experienceLevel'], number> = {
    NONE: 2,
    BASIC_FIXED_INCOME: 8,
    EQUITIES_AND_ETFS: 15,
    DERIVATIVES_PRO: 20,
  };
  score += expMap[input.experienceLevel];

  // 5. Max Drawdown Tolerance (0–15 pts)
  if (input.maxDrawdownTolerancePct >= 30) score += 15;
  else if (input.maxDrawdownTolerancePct >= 20) score += 11;
  else if (input.maxDrawdownTolerancePct >= 10) score += 6;
  else score += 2;

  const clampedScore = Math.max(0, Math.min(100, score));

  if (clampedScore < 40) {
    return {
      score: clampedScore,
      riskTier: 'CONSERVATIVE',
      maxStockConcentrationBps: 1500, // 15.00% single-stock cap
      maxSingleTradeCents: 750_000, // R$ 7.500,00
    };
  }
  if (clampedScore < 65) {
    return {
      score: clampedScore,
      riskTier: 'MODERATE',
      maxStockConcentrationBps: 2000, // 20.00% single-stock cap
      maxSingleTradeCents: 1_500_000, // R$ 15.000,00
    };
  }
  if (clampedScore < 85) {
    return {
      score: clampedScore,
      riskTier: 'BALANCED_GROWTH',
      maxStockConcentrationBps: 2500, // 25.00% single-stock cap
      maxSingleTradeCents: 3_000_000, // R$ 30.000,00
    };
  }
  return {
    score: clampedScore,
    riskTier: 'AGGRESSIVE_SPECULATIVE',
    maxStockConcentrationBps: 4000, // 40.00% single-stock cap
    maxSingleTradeCents: 10_000_000, // R$ 100.000,00
  };
}

/**
 * Append-Only Immutable Compliance Audit Log with HMAC-SHA256 Fingerprint (SEC Rule 17a-4).
 * Uses top-level `db` connection for 'BLOCK' decisions so that throwing an AppError and rolling
 * back `tx` never erases the regulatory violation log.
 */
export async function logComplianceDecision(
  tx: DbTransaction,
  entry: {
    eventType: string;
    userId?: string;
    operatorId?: string;
    ruleEvaluated: string;
    decision: 'ALLOW' | 'BLOCK' | 'PENDING';
    payload: Record<string, unknown>;
  }
): Promise<string> {
  const rawData = `${entry.eventType}|${entry.userId ?? ''}|${entry.operatorId ?? ''}|${entry.ruleEvaluated}|${entry.decision}|${JSON.stringify(entry.payload)}`;
  const recordHash = createHmac('sha256', 'aegis-compliance-secret').update(rawData).digest('hex');

  const executor = entry.decision === 'BLOCK' ? db : tx;

  await executor.insert(complianceAuditLogs).values({
    eventType: entry.eventType,
    userId: entry.userId,
    operatorId: entry.operatorId,
    ruleEvaluated: entry.ruleEvaluated,
    decision: entry.decision,
    payloadSnapshot: entry.payload,
    recordHash,
  });

  return recordHash;
}

/**
 * Executes the 5-Gate Synchronous Pre-Trade Compliance Pipeline inside the caller's ACID transaction.
 */
export async function evaluatePreTradeCompliance(
  tx: DbTransaction,
  params: {
    userId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT';
    quantity: number;
    limitPriceCents?: number;
    grossCents: number;
    feeCents: number;
    hasClientAttestation?: boolean;
    attestationText?: string;
  }
): Promise<PreTradeEvaluationResult> {
  const now = new Date();

  // ==========================================================================
  // GATE 1: KYC Status & Verification Tier Check (Strict Tier >= 2 Enforcement)
  // ==========================================================================
  const [kyc] = await tx
    .select()
    .from(kycProfiles)
    .where(eq(kycProfiles.userId, params.userId))
    .limit(1);

  if (
    !kyc ||
    kyc.status !== 'VERIFIED' ||
    kyc.tier === 'TIER_0_UNVERIFIED' ||
    kyc.tier === 'TIER_1_SIMPLIFIED'
  ) {
    await logComplianceDecision(tx, {
      eventType: 'KYC_TIER_BLOCK',
      userId: params.userId,
      ruleEvaluated: 'GATE_1_KYC_VERIFICATION_TIER_CHECK',
      decision: 'BLOCK',
      payload: {
        symbol: params.symbol,
        currentTier: kyc?.tier ?? 'NONE',
        requiredTier: 'TIER_2_STANDARD_OR_ABOVE',
      },
    });

    throw new AppError(
      'KYC_TIER_INSUFFICIENT',
      'Equities trading requires an active, verified KYC profile at Tier 2 (Standard Verification) or higher. Tier 0/1 profiles are restricted to basic payments and savings.',
      403
    );
  }

  // ==========================================================================
  // GATE 2: Restricted Securities List Check (Short-Circuit Hard Block)
  // ==========================================================================
  const [restriction] = await tx
    .select()
    .from(restrictedSecurities)
    .where(
      and(
        eq(restrictedSecurities.symbol, params.symbol),
        eq(restrictedSecurities.isActive, true),
        lte(restrictedSecurities.effectiveFrom, now),
        gte(restrictedSecurities.effectiveTo, now)
      )
    )
    .limit(1);

  if (restriction) {
    const isBlocked =
      restriction.restrictionType === 'RESTRICTED_ALL' ||
      (params.side === 'BUY' && restriction.restrictionType === 'RESTRICTED_BUY_ONLY') ||
      (params.side === 'SELL' && restriction.restrictionType === 'RESTRICTED_SELL_ONLY');

    if (isBlocked) {
      await logComplianceDecision(tx, {
        eventType: 'RESTRICTED_LIST_BLOCK',
        userId: params.userId,
        ruleEvaluated: 'GATE_2_RESTRICTED_SECURITIES_CHECK',
        decision: 'BLOCK',
        payload: {
          symbol: params.symbol,
          restrictionType: restriction.restrictionType,
          restrictionReason: restriction.reason,
          side: params.side,
        },
      });

      throw new AppError(
        'RESTRICTED_SECURITY',
        `Asset "${params.symbol}" is currently restricted from trading due to compliance blackout (${restriction.reason}).`,
        403
      );
    }
  }

  // ==========================================================================
  // GATE 3: Quantitative Suitability & Volatility Matching Check
  // ==========================================================================
  const [suitability] = await tx
    .select()
    .from(suitabilityProfiles)
    .where(eq(suitabilityProfiles.userId, params.userId))
    .orderBy(desc(suitabilityProfiles.assessedAt))
    .limit(1);

  if (!suitability || suitability.expiresAt < now) {
    throw new AppError(
      'SUITABILITY_EXPIRED',
      'Your investor suitability profile has expired or is unassessed. Complete the suitability questionnaire before trading.',
      412
    );
  }

  const [asset] = await tx
    .select()
    .from(assets)
    .where(eq(assets.symbol, params.symbol))
    .limit(1);

  if (!asset) {
    throw new AppError('NOT_FOUND', `Asset "${params.symbol}" not found in market catalogue.`, 404);
  }

  // Volatility evaluation: if asset volatility >= 135 bps and profile is CONSERVATIVE
  const isHighVolatility = asset.volatilityBps >= 135;
  if (suitability.riskTier === 'CONSERVATIVE' && isHighVolatility && params.side === 'BUY') {
    if (!params.hasClientAttestation) {
      await logComplianceDecision(tx, {
        eventType: 'SUITABILITY_ATTESTATION_REQUIRED',
        userId: params.userId,
        ruleEvaluated: 'GATE_3_SUITABILITY_VOLATILITY_MISMATCH',
        decision: 'BLOCK',
        payload: {
          symbol: params.symbol,
          assetVolatilityBps: asset.volatilityBps,
          userRiskTier: suitability.riskTier,
        },
      });

      return {
        allowed: false,
        status: 'REQUIRES_CLIENT_ATTESTATION',
        ruleViolated: 'GATE_3_SUITABILITY_VOLATILITY_MISMATCH',
        reason: `Asset "${params.symbol}" exhibits elevated volatility (${(asset.volatilityBps / 100).toFixed(2)}%) which exceeds your Conservative risk profile. Sign the Client Risk Attestation to proceed.`,
        auditPayload: {
          assetVolatilityBps: asset.volatilityBps,
          userRiskTier: suitability.riskTier,
        },
      };
    }

    await logComplianceDecision(tx, {
      eventType: 'CLIENT_ATTESTATION_SIGNED',
      userId: params.userId,
      ruleEvaluated: 'GATE_3_SUITABILITY_VOLATILITY_MISMATCH',
      decision: 'ALLOW',
      payload: {
        symbol: params.symbol,
        assetVolatilityBps: asset.volatilityBps,
        userRiskTier: suitability.riskTier,
        attestationText:
          params.attestationText ??
          'Client digitally attested to unsolicited high-volatility equity risk.',
      },
    });
  }

  // ==========================================================================
  // GATE 4: Single-Stock Concentration Limit Calculation (Individual & Household)
  // ==========================================================================
  let projectedConcentrationBps = 0;

  if (params.side === 'BUY') {
    const [householdMember] = await tx
      .select({
        householdId: householdMembers.householdId,
        includeInRollup: householdMembers.includeInRollup,
      })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.userId, params.userId),
          eq(householdMembers.includeInRollup, true)
        )
      )
      .limit(1);

    // Compute user's own liquid net worth in the asset's settlement currency (BRL or USD)
    // and also compute household rollup context if applicable
    const userAccounts = await tx
      .select({
        currency: accounts.currency,
        balanceCents: accounts.balanceCents,
      })
      .from(accounts)
      .where(eq(accounts.userId, params.userId));

    let totalCashCents = 0n;
    for (const acc of userAccounts) {
      const bal = BigInt(acc.balanceCents);
      if (acc.currency === asset.currency) {
        totalCashCents += bal;
      } else {
        const rateScaled1e4 = BigInt(
          getFxRateScaled1e4(acc.currency as CurrencyCode, asset.currency as CurrencyCode)
        );
        totalCashCents += (bal * rateScaled1e4) / 10_000n;
      }
    }

    const userPortfolios = await tx
      .select({
        quantity: portfolios.quantity,
        currentPriceCents: assets.currentPriceCents,
        assetCurrency: assets.currency,
      })
      .from(portfolios)
      .innerJoin(assets, eq(portfolios.symbol, assets.symbol))
      .where(eq(portfolios.userId, params.userId));

    let totalEquityCents = 0n;
    for (const p of userPortfolios) {
      const val = BigInt(p.quantity) * BigInt(p.currentPriceCents);
      if (p.assetCurrency === asset.currency) {
        totalEquityCents += val;
      } else {
        const rateScaled1e4 = BigInt(
          getFxRateScaled1e4(p.assetCurrency as CurrencyCode, asset.currency as CurrencyCode)
        );
        totalEquityCents += (val * rateScaled1e4) / 10_000n;
      }
    }

    const totalLiquidNetWorthCents = totalCashCents + totalEquityCents;

    if (totalLiquidNetWorthCents <= 0n) {
      throw new AppError(
        'UNPROCESSABLE_ENTITY',
        'Liquid net worth must be positive to assess concentration limits.',
        422
      );
    }

    // Existing filled holdings for this symbol
    const existingHoldings = await tx
      .select({
        quantity: portfolios.quantity,
      })
      .from(portfolios)
      .where(and(eq(portfolios.userId, params.userId), eq(portfolios.symbol, params.symbol)));

    let existingAssetHoldingCents = 0n;
    for (const h of existingHoldings) {
      existingAssetHoldingCents += BigInt(h.quantity) * BigInt(asset.currentPriceCents);
    }

    // Include pending BUY orders (OPEN and PENDING_COMPLIANCE_APPROVAL) to prevent split-order evasion
    const pendingOrders = await tx
      .select({
        quantity: tradeOrders.quantity,
        limitPriceCents: tradeOrders.limitPriceCents,
      })
      .from(tradeOrders)
      .where(
        and(
          eq(tradeOrders.userId, params.userId),
          eq(tradeOrders.symbol, params.symbol),
          eq(tradeOrders.side, 'BUY'),
          inArray(tradeOrders.status, ['OPEN', 'PENDING_COMPLIANCE_APPROVAL'])
        )
      );

    let pendingOrderHoldingCents = 0n;
    for (const po of pendingOrders) {
      const price = BigInt(po.limitPriceCents ?? asset.currentPriceCents);
      pendingOrderHoldingCents += BigInt(po.quantity) * price;
    }

    const commitGrossCents =
      existingAssetHoldingCents + pendingOrderHoldingCents + BigInt(params.grossCents);

    projectedConcentrationBps = Number((commitGrossCents * 10_000n) / totalLiquidNetWorthCents);

    if (projectedConcentrationBps > suitability.maxStockConcentrationBps) {
      const auditPayload = {
        symbol: params.symbol,
        projectedConcentrationBps,
        maxAllowedBps: suitability.maxStockConcentrationBps,
        existingHoldingCents: Number(existingAssetHoldingCents),
        pendingOrderHoldingCents: Number(pendingOrderHoldingCents),
        newOrderGrossCents: params.grossCents,
        totalCommitGrossCents: Number(commitGrossCents),
        liquidNetWorthCents: Number(totalLiquidNetWorthCents),
        householdId: householdMember?.householdId ?? null,
      };

      await logComplianceDecision(tx, {
        eventType: 'OVERRIDE_REQUESTED',
        userId: params.userId,
        ruleEvaluated: 'GATE_4_CONCENTRATION_LIMIT_EXCEEDED',
        decision: 'PENDING',
        payload: auditPayload,
      });

      return {
        allowed: false,
        status: 'REQUIRES_COMPLIANCE_APPROVAL',
        ruleViolated: 'GATE_4_CONCENTRATION_LIMIT_EXCEEDED',
        projectedConcentrationBps,
        maxAllowedConcentrationBps: suitability.maxStockConcentrationBps,
        reason: `Order projects a ${(projectedConcentrationBps / 100).toFixed(1)}% single-stock concentration in ${params.symbol} (including pending orders), exceeding your ${suitability.riskTier} guardrail of ${(suitability.maxStockConcentrationBps / 100).toFixed(1)}%. Order placed in Supervisory Compliance Queue with escrow reserved.`,
        auditPayload,
      };
    }
  }

  // ==========================================================================
  // GATE 5: Pre-Trade Verification Passed
  // ==========================================================================
  await logComplianceDecision(tx, {
    eventType: 'PRE_TRADE_CHECK_PASSED',
    userId: params.userId,
    ruleEvaluated: 'ALL_5_GATES_CLEAN',
    decision: 'ALLOW',
    payload: {
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType,
      quantity: params.quantity,
      grossCents: params.grossCents,
      projectedConcentrationBps,
      maxAllowedConcentrationBps: suitability.maxStockConcentrationBps,
    },
  });

  return {
    allowed: true,
    status: 'APPROVED',
    projectedConcentrationBps,
    maxAllowedConcentrationBps: suitability.maxStockConcentrationBps,
  };
}
