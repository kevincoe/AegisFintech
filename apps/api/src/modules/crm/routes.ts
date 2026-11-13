import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import {
  CreateInteractionLogInputSchema,
  CreateLifeEventInputSchema,
  ResolveComplianceOverrideInputSchema,
  UpdateKycProfileInputSchema,
  UpdateSuitabilityInputSchema,
  UpsertRestrictedSecurityInputSchema,
  type CurrencyCode,
} from '@aegis/shared';
import { db } from '../../db/index.js';
import {
  accounts,
  assets,
  complianceAuditLogs,
  complianceOverrides,
  financialAccountRoles,
  householdMembers,
  households,
  interactionLogs,
  kycProfiles,
  partyRelationships,
  personLifeEvents,
  portfolios,
  restrictedSecurities,
  suitabilityProfiles,
  tradeOrders,
  users,
} from '../../db/schema.js';
import { AppError } from '../../core/errors.js';
import { requireAuth } from '../../core/auth.js';
import { executeIdempotent } from '../../core/idempotency.js';
import {
  calculateBrokerageFee,
  calculatePortfolioAfterBuy,
  calculatePortfolioAfterSell,
} from '../../domain/money/financial-math.js';
import { postLedgerTransaction } from '../../domain/ledger/post-ledger-transaction.js';
import { getOrCreateSystemAccount } from '../../domain/ledger/system-accounts.js';
import { matchOpenLimitOrdersForSymbol } from '../market/engine.js';
import {
  calculateSuitabilityProfileMetrics,
  logComplianceDecision,
} from '../trading/compliance-engine.js';

export async function crmRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/crm/overview
   * Returns the complete Salesforce FSC-inspired Client 360, Household Rollup, Suitability,
   * Interaction Timeline, Restricted Securities List, and Supervisory Compliance Queue.
   */
  app.get('/api/crm/overview', { preHandler: [requireAuth] }, async (request) => {
    const userId = request.authUser!.id;
    const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    // 1. Ensure KYC Profile exists for user
    let [kyc] = await db
      .select()
      .from(kycProfiles)
      .where(eq(kycProfiles.userId, userId))
      .limit(1);

    if (!kyc) {
      [kyc] = await db
        .insert(kycProfiles)
        .values({
          userId,
          tier: 'TIER_2_STANDARD',
          status: 'VERIFIED',
          isPep: false,
          dailyTransferLimitCents: 5_000_000,
          nextReviewDueAt: oneYearFromNow,
        })
        .returning();
    }

    // 2. Ensure Suitability Profile exists for user
    let [suitability] = await db
      .select()
      .from(suitabilityProfiles)
      .where(eq(suitabilityProfiles.userId, userId))
      .orderBy(desc(suitabilityProfiles.assessedAt))
      .limit(1);

    if (!suitability) {
      [suitability] = await db
        .insert(suitabilityProfiles)
        .values({
          userId,
          riskTier: 'BALANCED_GROWTH',
          score: 68,
          horizonMonths: 36,
          maxStockConcentrationBps: 2500,
          maxSingleTradeCents: 1_500_000,
          questionnaireAnswers: {
            investmentObjective: 'BALANCED_GROWTH',
            horizonMonths: 36,
            liquidityNeed: 'MEDIUM_6_TO_12M',
            experienceLevel: 'EQUITIES_AND_ETFS',
            maxDrawdownTolerancePct: 20,
          },
          expiresAt: oneYearFromNow,
        })
        .returning();
    }

    // 3. Household & Party Relationships
    const [memberLink] = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId))
      .limit(1);

    let householdData: {
      id: string;
      name: string;
      taxIdentifier: string | null;
      notes: string | null;
      consolidatedCashCents: number;
      consolidatedLockedCashCents: number;
      consolidatedEquityCents: number;
      consolidatedNetWorthCents: number;
      members: Array<{
        userId: string;
        name: string;
        email: string;
        role: string;
        isDecisionMaker: boolean;
        includeInRollup: boolean;
      }>;
      partyRelationships: Array<{
        id: string;
        sourceUserName: string;
        targetUserName: string;
        relationshipType: string;
        reciprocalType: string;
        ownershipPercentageBps: number;
        isUbo: boolean;
      }>;
    } | null = null;

    if (memberLink) {
      const [hh] = await db
        .select()
        .from(households)
        .where(eq(households.id, memberLink.householdId))
        .limit(1);

      if (hh) {
        const viewRows = (await db.execute(sql`
          SELECT
            total_cash_cents,
            total_locked_cash_cents,
            total_equity_cents,
            consolidated_net_worth_cents
          FROM view_household_net_worth
          WHERE household_id = ${hh.id}::uuid
          LIMIT 1
        `)) as unknown as Array<{
          total_cash_cents: string;
          total_locked_cash_cents: string;
          total_equity_cents: string;
          consolidated_net_worth_cents: string;
        }>;

        const rollup = viewRows[0];

        const members = await db
          .select({
            userId: householdMembers.userId,
            name: users.name,
            email: users.email,
            role: householdMembers.role,
            isDecisionMaker: householdMembers.isDecisionMaker,
            includeInRollup: householdMembers.includeInRollup,
          })
          .from(householdMembers)
          .innerJoin(users, eq(householdMembers.userId, users.id))
          .where(eq(householdMembers.householdId, hh.id))
          .orderBy(desc(householdMembers.isDecisionMaker), asc(users.name));

        const relRows = await db
          .select()
          .from(partyRelationships)
          .where(
            or(
              eq(partyRelationships.sourceUserId, userId),
              eq(partyRelationships.targetUserId, userId)
            )
          );

        const allUsersMap = new Map(members.map((m) => [m.userId, m.name]));

        householdData = {
          id: hh.id,
          name: hh.name,
          taxIdentifier: hh.taxIdentifier,
          notes: hh.notes,
          consolidatedCashCents: Number(rollup?.total_cash_cents ?? 0),
          consolidatedLockedCashCents: Number(rollup?.total_locked_cash_cents ?? 0),
          consolidatedEquityCents: Number(rollup?.total_equity_cents ?? 0),
          consolidatedNetWorthCents: Number(rollup?.consolidated_net_worth_cents ?? 0),
          members,
          partyRelationships: relRows.map((r) => ({
            id: r.id,
            sourceUserName: allUsersMap.get(r.sourceUserId) ?? 'Partner Entity',
            targetUserName: allUsersMap.get(r.targetUserId) ?? 'Counterparty',
            relationshipType: r.relationshipType,
            reciprocalType: r.reciprocalType,
            ownershipPercentageBps: r.ownershipPercentageBps,
            isUbo: r.isUbo,
          })),
        };
      }
    }

    // 4. Financial Account Roles
    const accountRoleRows = await db
      .select({
        id: financialAccountRoles.id,
        accountId: financialAccountRoles.accountId,
        accountNumber: accounts.accountNumber,
        currency: accounts.currency,
        accountLabel: accounts.label,
        userName: users.name,
        roleType: financialAccountRoles.roleType,
        canTrade: financialAccountRoles.canTrade,
        canWithdraw: financialAccountRoles.canWithdraw,
      })
      .from(financialAccountRoles)
      .innerJoin(accounts, eq(financialAccountRoles.accountId, accounts.id))
      .innerJoin(users, eq(financialAccountRoles.userId, users.id))
      .where(eq(accounts.userId, userId))
      .orderBy(asc(accounts.currency), asc(financialAccountRoles.roleType));

    // 5. Advisor Interaction Logs & Person Life Events
    const [interactions, lifeEvents, restrictions, overrides, auditLogs] = await Promise.all([
      db
        .select({
          id: interactionLogs.id,
          channel: interactionLogs.channel,
          subject: interactionLogs.subject,
          notes: interactionLogs.notes,
          redactedNotes: interactionLogs.redactedNotes,
          confidentialityLevel: interactionLogs.confidentialityLevel,
          advisorName: users.name,
          createdAt: interactionLogs.createdAt,
        })
        .from(interactionLogs)
        .innerJoin(users, eq(interactionLogs.advisorId, users.id))
        .where(eq(interactionLogs.clientId, userId))
        .orderBy(desc(interactionLogs.createdAt))
        .limit(20),
      db
        .select()
        .from(personLifeEvents)
        .where(eq(personLifeEvents.userId, userId))
        .orderBy(desc(personLifeEvents.eventDate))
        .limit(15),
      db
        .select()
        .from(restrictedSecurities)
        .orderBy(desc(restrictedSecurities.isActive), asc(restrictedSecurities.symbol)),
      db
        .select({
          id: complianceOverrides.id,
          orderId: complianceOverrides.orderId,
          userId: complianceOverrides.userId,
          clientName: users.name,
          symbol: tradeOrders.symbol,
          side: tradeOrders.side,
          orderType: tradeOrders.orderType,
          quantity: tradeOrders.quantity,
          limitPriceCents: tradeOrders.limitPriceCents,
          totalGrossCents: tradeOrders.totalGrossCents,
          feeCents: tradeOrders.feeCents,
          currency: tradeOrders.currency,
          orderStatus: tradeOrders.status,
          overrideType: complianceOverrides.overrideType,
          status: complianceOverrides.status,
          riskViolationReason: complianceOverrides.riskViolationReason,
          clientAttestationText: complianceOverrides.clientAttestationText,
          reviewerRationale: complianceOverrides.reviewerRationale,
          reviewedAt: complianceOverrides.reviewedAt,
          createdAt: complianceOverrides.createdAt,
        })
        .from(complianceOverrides)
        .innerJoin(tradeOrders, eq(complianceOverrides.orderId, tradeOrders.id))
        .innerJoin(users, eq(complianceOverrides.userId, users.id))
        .orderBy(desc(complianceOverrides.createdAt))
        .limit(25),
      db
        .select()
        .from(complianceAuditLogs)
        .orderBy(desc(complianceAuditLogs.createdAt))
        .limit(25),
    ]);

    return {
      kycProfile: {
        ...kyc!,
        lastVerifiedAt: kyc!.lastVerifiedAt.toISOString(),
        nextReviewDueAt: kyc!.nextReviewDueAt.toISOString(),
      },
      suitabilityProfile: {
        ...suitability!,
        assessedAt: suitability!.assessedAt.toISOString(),
        expiresAt: suitability!.expiresAt.toISOString(),
      },
      household: householdData,
      accountRoles: accountRoleRows,
      interactions: interactions.map((i) => ({
        ...i,
        createdAt: i.createdAt.toISOString(),
      })),
      lifeEvents: lifeEvents.map((e) => ({
        ...e,
        eventDate: e.eventDate.toISOString(),
        createdAt: e.createdAt.toISOString(),
      })),
      restrictedSecurities: restrictions.map((r) => ({
        ...r,
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: r.effectiveTo.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
      complianceOverrides: overrides.map((o) => ({
        ...o,
        reviewedAt: o.reviewedAt ? o.reviewedAt.toISOString() : null,
        createdAt: o.createdAt.toISOString(),
      })),
      complianceAuditLogs: auditLogs.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  });

  /**
   * PUT /api/crm/kyc
   * Updates user's KYC verification tier & PEP status for Gate 1 compliance testing & Client 360 management.
   */
  app.put('/api/crm/kyc', { preHandler: [requireAuth] }, async (request) => {
    const userId = request.authUser!.id;
    const body = UpdateKycProfileInputSchema.parse(request.body);
    const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const dailyLimitByTier: Record<typeof body.tier, number> = {
      TIER_0_UNVERIFIED: 50_000,
      TIER_1_SIMPLIFIED: 500_000,
      TIER_2_STANDARD: 5_000_000,
      TIER_3_ENHANCED: 25_000_000,
    };

    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(kycProfiles)
        .where(eq(kycProfiles.userId, userId))
        .limit(1);

      let updated;
      if (existing) {
        [updated] = await tx
          .update(kycProfiles)
          .set({
            tier: body.tier,
            status: body.tier === 'TIER_0_UNVERIFIED' ? 'PENDING' : 'VERIFIED',
            isPep: body.isPep,
            pepCategory: body.isPep ? (body.pepCategory ?? 'SENIOR_GOV') : null,
            pepDescription: body.isPep ? (body.pepDescription ?? null) : null,
            dailyTransferLimitCents: dailyLimitByTier[body.tier],
            lastVerifiedAt: new Date(),
            nextReviewDueAt: oneYearFromNow,
          })
          .where(eq(kycProfiles.id, existing.id))
          .returning();
      } else {
        [updated] = await tx
          .insert(kycProfiles)
          .values({
            userId,
            tier: body.tier,
            status: body.tier === 'TIER_0_UNVERIFIED' ? 'PENDING' : 'VERIFIED',
            isPep: body.isPep,
            pepCategory: body.isPep ? (body.pepCategory ?? 'SENIOR_GOV') : null,
            pepDescription: body.isPep ? (body.pepDescription ?? null) : null,
            dailyTransferLimitCents: dailyLimitByTier[body.tier],
            nextReviewDueAt: oneYearFromNow,
          })
          .returning();
      }

      await logComplianceDecision(tx, {
        eventType: 'KYC_PROFILE_UPDATED',
        userId,
        operatorId: userId,
        ruleEvaluated: 'GATE_1_KYC_VERIFICATION_TIER_CHECK',
        decision: body.tier === 'TIER_0_UNVERIFIED' || body.tier === 'TIER_1_SIMPLIFIED' ? 'PENDING' : 'ALLOW',
        payload: {
          newTier: body.tier,
          isPep: body.isPep,
          dailyTransferLimitCents: dailyLimitByTier[body.tier],
        },
      });

      return {
        kycProfile: {
          ...updated!,
          lastVerifiedAt: updated!.lastVerifiedAt.toISOString(),
          nextReviewDueAt: updated!.nextReviewDueAt.toISOString(),
        },
      };
    });
  });

  /**
   * PUT /api/crm/suitability
   * Evaluates the 5-Dimension Investor Suitability Questionnaire and updates Gate 3 & Gate 4 guardrails.
   */
  app.put('/api/crm/suitability', { preHandler: [requireAuth] }, async (request) => {
    const userId = request.authUser!.id;
    const body = UpdateSuitabilityInputSchema.parse(request.body);
    const metrics = calculateSuitabilityProfileMetrics(body);
    const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    return db.transaction(async (tx) => {
      const [profile] = await tx
        .insert(suitabilityProfiles)
        .values({
          userId,
          riskTier: metrics.riskTier,
          score: metrics.score,
          horizonMonths: body.horizonMonths,
          maxStockConcentrationBps: metrics.maxStockConcentrationBps,
          maxSingleTradeCents: metrics.maxSingleTradeCents,
          questionnaireAnswers: body,
          assessedAt: new Date(),
          expiresAt: oneYearFromNow,
        })
        .returning();

      // Clear pending suitability review flags on life events
      await tx
        .update(personLifeEvents)
        .set({ requiresSuitabilityReview: false })
        .where(eq(personLifeEvents.userId, userId));

      await logComplianceDecision(tx, {
        eventType: 'SUITABILITY_ASSESSED',
        userId,
        operatorId: userId,
        ruleEvaluated: 'GATE_3_AND_4_SUITABILITY_CALIBRATION',
        decision: 'ALLOW',
        payload: {
          riskTier: metrics.riskTier,
          score: metrics.score,
          maxStockConcentrationBps: metrics.maxStockConcentrationBps,
          horizonMonths: body.horizonMonths,
        },
      });

      return {
        suitabilityProfile: {
          ...profile!,
          assessedAt: profile!.assessedAt.toISOString(),
          expiresAt: profile!.expiresAt.toISOString(),
        },
      };
    });
  });

  /**
   * POST /api/crm/interactions
   * Logs an advisor/client interaction summary with Compliant Data Sharing level.
   */
  app.post('/api/crm/interactions', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.id;
    const body = CreateInteractionLogInputSchema.parse(request.body);

    const [created] = await db
      .insert(interactionLogs)
      .values({
        clientId: userId,
        advisorId: userId,
        channel: body.channel,
        subject: body.subject,
        notes: body.notes,
        redactedNotes:
          body.redactedNotes ??
          (body.confidentialityLevel === 'RESTRICTED_MNPI'
            ? `${body.subject} — [REDACTED BY MNPI CHINESE WALL POLICY]`
            : null),
        confidentialityLevel: body.confidentialityLevel,
      })
      .returning();

    return reply.status(201).send({
      interaction: {
        ...created!,
        advisorName: request.authUser!.name,
        createdAt: created!.createdAt.toISOString(),
      },
    });
  });

  /**
   * POST /api/crm/life-events
   * Logs a Salesforce FSC Person Life Event milestone.
   */
  app.post('/api/crm/life-events', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.id;
    const body = CreateLifeEventInputSchema.parse(request.body);

    const parsedDate = new Date(body.eventDate);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new AppError('VALIDATION_ERROR', 'Invalid eventDate format', 400);
    }

    const [created] = await db
      .insert(personLifeEvents)
      .values({
        userId,
        eventType: body.eventType,
        title: body.title,
        description: body.description ?? null,
        eventDate: parsedDate,
        financialImpactCents: body.financialImpactCents,
        requiresSuitabilityReview: body.requiresSuitabilityReview,
      })
      .returning();

    return reply.status(201).send({
      lifeEvent: {
        ...created!,
        eventDate: created!.eventDate.toISOString(),
        createdAt: created!.createdAt.toISOString(),
      },
    });
  });

  /**
   * POST /api/compliance/restricted-securities
   * Adds, updates, or toggles an asset on the Gate 2 Restricted Securities List (MNPI / M&A Blackout).
   */
  app.post(
    '/api/compliance/restricted-securities',
    { preHandler: [requireAuth] },
    async (request) => {
      const userId = request.authUser!.id;
      const body = UpsertRestrictedSecurityInputSchema.parse(request.body);

      return db.transaction(async (tx) => {
        const [asset] = await tx
          .select()
          .from(assets)
          .where(eq(assets.symbol, body.symbol))
          .limit(1);

        if (!asset) {
          throw new AppError('NOT_FOUND', `Asset "${body.symbol}" is not listed.`, 404);
        }

        const [existing] = await tx
          .select()
          .from(restrictedSecurities)
          .where(eq(restrictedSecurities.symbol, body.symbol))
          .limit(1);

        const now = new Date();
        const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
        const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

        let record;
        if (existing) {
          [record] = await tx
            .update(restrictedSecurities)
            .set({
              restrictionType: body.restrictionType,
              reason: body.reason,
              notes: body.notes ?? existing.notes,
              isActive: body.isActive,
              effectiveFrom: oneYearAgo,
              effectiveTo: oneYearFromNow,
              addedBy: userId,
            })
            .where(eq(restrictedSecurities.id, existing.id))
            .returning();
        } else {
          [record] = await tx
            .insert(restrictedSecurities)
            .values({
              symbol: body.symbol,
              restrictionType: body.restrictionType,
              reason: body.reason,
              notes:
                body.notes ??
                `Compliance blackout restriction (${body.reason}) activated by ${request.authUser!.name}.`,
              effectiveFrom: oneYearAgo,
              effectiveTo: oneYearFromNow,
              addedBy: userId,
              isActive: body.isActive,
            })
            .returning();
        }

        await logComplianceDecision(tx, {
          eventType: body.isActive ? 'RESTRICTED_SECURITY_ADDED' : 'RESTRICTED_SECURITY_LIFTED',
          userId,
          operatorId: userId,
          ruleEvaluated: 'GATE_2_RESTRICTED_SECURITIES_LIST_UPDATE',
          decision: body.isActive ? 'BLOCK' : 'ALLOW',
          payload: {
            symbol: body.symbol,
            restrictionType: body.restrictionType,
            reason: body.reason,
            isActive: body.isActive,
            updatedAt: now.toISOString(),
          },
        });

        return {
          restrictedSecurity: {
            ...record!,
            effectiveFrom: record!.effectiveFrom.toISOString(),
            effectiveTo: record!.effectiveTo.toISOString(),
            createdAt: record!.createdAt.toISOString(),
          },
        };
      });
    }
  );

  /**
   * POST /api/compliance/overrides/:orderId/resolve
   * Supervisory Compliance Officer Sign-Off (APPROVE or REJECT) for orders held in PENDING_COMPLIANCE_APPROVAL.
   * Enforces deterministic row-level locking, Restricted List re-verification, and Double-Entry Ledger settlement.
   */
  app.post(
    '/api/compliance/overrides/:orderId/resolve',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const officerId = request.authUser!.id;
      const { orderId } = request.params as { orderId: string };
      const body = ResolveComplianceOverrideInputSchema.parse(request.body);
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      const result = await executeIdempotent({
        userId: officerId,
        idempotencyKey,
        endpoint: `POST /api/compliance/overrides/${orderId}/resolve`,
        payload: { orderId, ...body },
        statusCode: 200,
        handler: async (tx) => {
          const [override] = await tx
            .select()
            .from(complianceOverrides)
            .where(
              and(
                eq(complianceOverrides.orderId, orderId),
                eq(complianceOverrides.status, 'PENDING')
              )
            )
            .limit(1);

          if (!override) {
            throw new AppError(
              'NOT_FOUND',
              'Pending compliance override record not found for this order.',
              404
            );
          }

          // Acquire pessimistic lock on trade_orders row
          const lockedOrderRows = (await tx.execute(sql`
            SELECT id FROM trade_orders WHERE id = ${orderId}::uuid FOR UPDATE
          `)) as unknown as Array<{ id: string }>;

          if (lockedOrderRows.length === 0) {
            throw new AppError('NOT_FOUND', 'Order not found.', 404);
          }

          const [order] = await tx
            .select()
            .from(tradeOrders)
            .where(eq(tradeOrders.id, orderId))
            .limit(1);

          if (!order || order.status !== 'PENDING_COMPLIANCE_APPROVAL') {
            throw new AppError(
              'INVALID_ORDER_STATE',
              `Order is not awaiting compliance approval (current status: ${order?.status ?? 'UNKNOWN'}).`,
              400
            );
          }

          const currency = order.currency as CurrencyCode;

          const [userChecking] = await tx
            .select()
            .from(accounts)
            .where(
              and(
                eq(accounts.userId, order.userId),
                eq(accounts.currency, currency),
                eq(accounts.accountType, 'CHECKING')
              )
            )
            .limit(1);

          if (!userChecking) {
            throw new AppError(
              'NOT_FOUND',
              `Checking account in currency "${currency}" not found for order owner.`,
              404
            );
          }

          // Lock user's checking account row
          await tx.execute(sql`
            SELECT id FROM accounts WHERE id = ${userChecking.id}::uuid FOR UPDATE
          `);

          const now = new Date();

          if (body.action === 'APPROVE') {
            // Re-check Gate 2 Restricted Securities List immediately prior to supervisory settlement
            const [activeRestriction] = await tx
              .select()
              .from(restrictedSecurities)
              .where(
                and(
                  eq(restrictedSecurities.symbol, order.symbol),
                  eq(restrictedSecurities.isActive, true),
                  lte(restrictedSecurities.effectiveFrom, now),
                  gte(restrictedSecurities.effectiveTo, now)
                )
              )
              .limit(1);

            if (activeRestriction) {
              const isBlocked =
                activeRestriction.restrictionType === 'RESTRICTED_ALL' ||
                (order.side === 'BUY' &&
                  activeRestriction.restrictionType === 'RESTRICTED_BUY_ONLY') ||
                (order.side === 'SELL' &&
                  activeRestriction.restrictionType === 'RESTRICTED_SELL_ONLY');

              if (isBlocked) {
                throw new AppError(
                  'RESTRICTED_SECURITY',
                  `Cannot approve order: Asset "${order.symbol}" is currently under active trading restriction (${activeRestriction.reason}).`,
                  403
                );
              }
            }

            const [asset] = await tx
              .select()
              .from(assets)
              .where(eq(assets.symbol, order.symbol))
              .limit(1);

            if (!asset) {
              throw new AppError('NOT_FOUND', `Asset "${order.symbol}" not found.`, 404);
            }

            const isImmediateFill =
              order.orderType === 'MARKET' ||
              (order.side === 'BUY' && (order.limitPriceCents ?? 0) >= asset.currentPriceCents) ||
              (order.side === 'SELL' &&
                (order.limitPriceCents ?? Infinity) <= asset.currentPriceCents);

            if (isImmediateFill) {
              const executionPriceCents =
                order.orderType === 'MARKET'
                  ? asset.currentPriceCents
                  : Math.min(order.limitPriceCents ?? asset.currentPriceCents, asset.currentPriceCents);
              const executedGrossCents = order.quantity * executionPriceCents;
              const feeCents = calculateBrokerageFee(executedGrossCents);
              const clearingAccount = await getOrCreateSystemAccount(
                tx,
                'SYS-MARKET-CLEARING',
                currency
              );

              let receiptId: string;

              if (order.side === 'BUY') {
                // Release reserved escrow cash before debiting actual execution cost
                const originallyReservedCents = order.totalGrossCents + order.feeCents;
                await tx.execute(sql`
                  UPDATE accounts
                  SET locked_balance_cents = GREATEST(0, locked_balance_cents - ${originallyReservedCents})
                  WHERE id = ${userChecking.id}::uuid
                `);

                const totalDebitCents = executedGrossCents + feeCents;
                const receipt = await postLedgerTransaction(tx, {
                  category: 'STOCK_BUY',
                  description: `Supervisory Approved Buy (${order.orderType}): ${order.quantity} ${order.symbol} @ ${(executionPriceCents / 100).toFixed(2)} ${currency}`,
                  metadata: {
                    orderId: order.id,
                    symbol: order.symbol,
                    quantity: order.quantity,
                    executionPriceCents,
                    feeCents,
                    complianceOfficerId: officerId,
                  },
                  postings: [
                    {
                      accountId: userChecking.id,
                      direction: 'DEBIT',
                      amountCents: totalDebitCents,
                      currency,
                    },
                    {
                      accountId: clearingAccount.id,
                      direction: 'CREDIT',
                      amountCents: totalDebitCents,
                      currency,
                    },
                  ],
                });
                receiptId = receipt.transactionId;

                const [existingPos] = await tx
                  .select()
                  .from(portfolios)
                  .where(
                    and(eq(portfolios.userId, order.userId), eq(portfolios.symbol, order.symbol))
                  )
                  .limit(1);

                const nextPos = calculatePortfolioAfterBuy({
                  currentQuantity: existingPos?.quantity ?? 0,
                  currentAvgPriceCents: existingPos?.averagePriceCents ?? 0,
                  buyQuantity: order.quantity,
                  executionPriceCents,
                  feeCents,
                });

                if (existingPos) {
                  await tx
                    .update(portfolios)
                    .set({
                      quantity: nextPos.newQuantity,
                      averagePriceCents: nextPos.newAveragePriceCents,
                      updatedAt: new Date(),
                    })
                    .where(eq(portfolios.id, existingPos.id));
                } else {
                  await tx.insert(portfolios).values({
                    userId: order.userId,
                    symbol: order.symbol,
                    quantity: nextPos.newQuantity,
                    lockedQuantity: 0,
                    averagePriceCents: nextPos.newAveragePriceCents,
                    realizedPnlCents: 0,
                  });
                }
              } else {
                // SELL immediate fill
                const [existingPos] = await tx
                  .select()
                  .from(portfolios)
                  .where(
                    and(eq(portfolios.userId, order.userId), eq(portfolios.symbol, order.symbol))
                  )
                  .limit(1);

                if (!existingPos || existingPos.quantity < order.quantity) {
                  throw new AppError(
                    'INSUFFICIENT_SHARES',
                    'Insufficient custody shares for sell settlement.',
                    422
                  );
                }

                const nextPos = calculatePortfolioAfterSell({
                  currentQuantity: existingPos.quantity,
                  currentAvgPriceCents: existingPos.averagePriceCents,
                  currentRealizedPnlCents: existingPos.realizedPnlCents,
                  sellQuantity: order.quantity,
                  executionPriceCents,
                  feeCents,
                });

                await tx
                  .update(portfolios)
                  .set({
                    quantity: nextPos.newQuantity,
                    lockedQuantity: Math.max(0, existingPos.lockedQuantity - order.quantity),
                    averagePriceCents: nextPos.newAveragePriceCents,
                    realizedPnlCents: nextPos.newTotalRealizedPnlCents,
                    updatedAt: new Date(),
                  })
                  .where(eq(portfolios.id, existingPos.id));

                const netProceedsCents = Math.max(1, executedGrossCents - feeCents);
                const receipt = await postLedgerTransaction(tx, {
                  category: 'STOCK_SELL',
                  description: `Supervisory Approved Sell (${order.orderType}): ${order.quantity} ${order.symbol} @ ${(executionPriceCents / 100).toFixed(2)} ${currency}`,
                  metadata: {
                    orderId: order.id,
                    symbol: order.symbol,
                    quantity: order.quantity,
                    executionPriceCents,
                    feeCents,
                    complianceOfficerId: officerId,
                  },
                  postings: [
                    {
                      accountId: clearingAccount.id,
                      direction: 'DEBIT',
                      amountCents: netProceedsCents,
                      currency,
                    },
                    {
                      accountId: userChecking.id,
                      direction: 'CREDIT',
                      amountCents: netProceedsCents,
                      currency,
                    },
                  ],
                });
                receiptId = receipt.transactionId;
              }

              const [filledOrder] = await tx
                .update(tradeOrders)
                .set({
                  status: 'FILLED',
                  executedPriceCents: executionPriceCents,
                  totalGrossCents: executedGrossCents,
                  feeCents,
                  ledgerTransactionId: receiptId,
                  executedAt: now,
                })
                .where(eq(tradeOrders.id, order.id))
                .returning();

              await tx
                .update(complianceOverrides)
                .set({
                  status: 'APPROVED',
                  reviewerId: officerId,
                  reviewerRationale: body.rationale,
                  reviewedAt: now,
                })
                .where(eq(complianceOverrides.id, override.id));

              await logComplianceDecision(tx, {
                eventType: 'OVERRIDE_APPROVED',
                userId: order.userId,
                operatorId: officerId,
                ruleEvaluated: 'SUPERVISORY_OVERRIDE_SIGN_OFF',
                decision: 'ALLOW',
                payload: {
                  orderId: order.id,
                  symbol: order.symbol,
                  rationale: body.rationale,
                  executionType: 'IMMEDIATE_FILL',
                  executedPriceCents: executionPriceCents,
                  ledgerTransactionId: receiptId,
                },
              });

              return {
                orderStatus: 'FILLED',
                overrideStatus: 'APPROVED',
                order: {
                  ...filledOrder!,
                  createdAt: filledOrder!.createdAt.toISOString(),
                  executedAt: filledOrder!.executedAt?.toISOString() ?? null,
                },
              };
            } else {
              // Non-marketable LIMIT order -> Transition to OPEN in the order book (escrow stays locked)
              const [openOrder] = await tx
                .update(tradeOrders)
                .set({ status: 'OPEN' })
                .where(eq(tradeOrders.id, order.id))
                .returning();

              await tx
                .update(complianceOverrides)
                .set({
                  status: 'APPROVED',
                  reviewerId: officerId,
                  reviewerRationale: body.rationale,
                  reviewedAt: now,
                })
                .where(eq(complianceOverrides.id, override.id));

              await matchOpenLimitOrdersForSymbol(tx, order.symbol, asset.currentPriceCents);

              await logComplianceDecision(tx, {
                eventType: 'OVERRIDE_APPROVED',
                userId: order.userId,
                operatorId: officerId,
                ruleEvaluated: 'SUPERVISORY_OVERRIDE_SIGN_OFF',
                decision: 'ALLOW',
                payload: {
                  orderId: order.id,
                  symbol: order.symbol,
                  rationale: body.rationale,
                  executionType: 'LIMIT_BOOK_ENTERED',
                },
              });

              return {
                orderStatus: 'OPEN',
                overrideStatus: 'APPROVED',
                order: {
                  ...openOrder!,
                  createdAt: openOrder!.createdAt.toISOString(),
                  executedAt: null,
                },
              };
            }
          } else {
            // REJECT: Release locked cash escrow or locked custody shares
            if (order.side === 'BUY') {
              const reservedCents = order.totalGrossCents + order.feeCents;
              await tx.execute(sql`
                UPDATE accounts
                SET locked_balance_cents = GREATEST(0, locked_balance_cents - ${reservedCents})
                WHERE id = ${userChecking.id}::uuid
              `);
            } else {
              await tx.execute(sql`
                UPDATE portfolios
                SET locked_quantity = GREATEST(0, locked_quantity - ${order.quantity})
                WHERE user_id = ${order.userId}::uuid
                  AND symbol = ${order.symbol}
              `);
            }

            const [cancelledOrder] = await tx
              .update(tradeOrders)
              .set({ status: 'CANCELLED' })
              .where(eq(tradeOrders.id, order.id))
              .returning();

            await tx
              .update(complianceOverrides)
              .set({
                status: 'REJECTED',
                reviewerId: officerId,
                reviewerRationale: body.rationale,
                reviewedAt: now,
              })
              .where(eq(complianceOverrides.id, override.id));

            await logComplianceDecision(tx, {
              eventType: 'OVERRIDE_REJECTED',
              userId: order.userId,
              operatorId: officerId,
              ruleEvaluated: 'SUPERVISORY_OVERRIDE_SIGN_OFF',
              decision: 'BLOCK',
              payload: {
                orderId: order.id,
                symbol: order.symbol,
                side: order.side,
                rationale: body.rationale,
              },
            });

            return {
              orderStatus: 'CANCELLED',
              overrideStatus: 'REJECTED',
              order: {
                ...cancelledOrder!,
                createdAt: cancelledOrder!.createdAt.toISOString(),
                executedAt: null,
              },
            };
          }
        },
      });

      return reply.status(result.statusCode).send({
        ...result.body,
        idempotency: {
          key: result.idempotencyKey,
          replayed: result.replayed,
        },
      });
    }
  );
}
