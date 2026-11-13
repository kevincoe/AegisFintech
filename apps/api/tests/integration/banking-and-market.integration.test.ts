import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { db, queryClient } from '../../src/db/index.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Aegis FinTech — Real PostgreSQL Integration & Concurrency Suite', () => {
  let app: FastifyInstance;
  let userAToken = '';
  let userBToken = '';
  let userBEmail = '';

  const runSuffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    await seedDatabase();
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queryClient.end();
  });

  it('1. Registers two isolated users and provisions multi-currency accounts via Double-Entry Ledger', async () => {
    const resA = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Test Trader Alpha',
        email: `alpha.${runSuffix}@aegis.bank`,
        documentNumber: `91111${runSuffix}`,
        password: 'password123',
      },
    });
    expect(resA.statusCode).toBe(201);
    const bodyA = resA.json();
    userAToken = bodyA.token;

    const resB = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Test Trader Beta',
        email: `beta.${runSuffix}@aegis.bank`,
        documentNumber: `92222${runSuffix}`,
        password: 'password123',
      },
    });
    expect(resB.statusCode).toBe(201);
    const bodyB = resB.json();
    userBToken = bodyB.token;
    userBEmail = bodyB.user.email;

    // Verify Alpha's initial welcome balances (R$ 25.000,00 BRL, US$ 2,000.00 USD, € 500,00 EUR)
    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/accounts/summary',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(summaryRes.statusCode).toBe(200);
    const summary = summaryRes.json();
    const brl = summary.checkingAccounts.find((a: { currency: string }) => a.currency === 'BRL');
    expect(brl.balanceCents).toBe(2_500_000);
  });

  it('2. Enforces Idempotency-Key on P2P Transfers (safe replay & payload tamper conflict)', async () => {
    const idempKey = `idemp-transfer-${runSuffix}`;
    const payload = {
      recipientIdentifier: userBEmail,
      currency: 'BRL',
      amountCents: 100_000, // R$ 1.000,00
      description: 'Idempotent Pix Test',
    };

    // First call: executes transfer
    const firstRes = await app.inject({
      method: 'POST',
      url: '/api/transfers/p2p',
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': idempKey,
      },
      payload,
    });
    expect(firstRes.statusCode).toBe(201);
    expect(firstRes.json().idempotency.replayed).toBe(false);

    // Second call with identical Idempotency-Key and payload: returns cached response without double debit
    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/transfers/p2p',
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': idempKey,
      },
      payload,
    });
    expect(replayRes.statusCode).toBe(201);
    expect(replayRes.json().idempotency.replayed).toBe(true);
    expect(replayRes.json().transfer.transactionId).toBe(firstRes.json().transfer.transactionId);

    // Third call with SAME Idempotency-Key but DIFFERENT amount: rejected with 409 CONFLICT
    const tamperedRes = await app.inject({
      method: 'POST',
      url: '/api/transfers/p2p',
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': idempKey,
      },
      payload: {
        ...payload,
        amountCents: 999_999,
      },
    });
    expect(tamperedRes.statusCode).toBe(409);
    expect(tamperedRes.json().error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('3. Defends against a 10x Concurrent Race-Condition Overdraft Attack via SELECT FOR UPDATE', async () => {
    // Alpha currently has R$ 24.000,00 (2_400_000 cents).
    // We launch 10 simultaneous parallel requests each attempting to transfer R$ 10.000,00 (1_000_000 cents).
    // Only 2 requests can legally succeed (total R$ 20.000,00), leaving R$ 4.000,00.
    // The other 8 MUST be rejected with 422 INSUFFICIENT_FUNDS.
    const attackPromises = Array.from({ length: 10 }, (_, idx) =>
      app.inject({
        method: 'POST',
        url: '/api/transfers/p2p',
        headers: {
          authorization: `Bearer ${userAToken}`,
          'idempotency-key': `race-attack-${runSuffix}-${idx}`,
        },
        payload: {
          recipientIdentifier: userBEmail,
          currency: 'BRL',
          amountCents: 1_000_000, // R$ 10.000,00 each
          description: `Parallel Race Attack #${idx + 1}`,
        },
      })
    );

    const responses = await Promise.all(attackPromises);
    const succeeded = responses.filter((r) => r.statusCode === 201);
    const rejectedInsufficient = responses.filter(
      (r) => r.statusCode === 422 && r.json().error?.code === 'INSUFFICIENT_FUNDS'
    );

    expect(succeeded.length).toBe(2);
    expect(rejectedInsufficient.length).toBe(8);

    // Verify Alpha's balance is strictly R$ 4.000,00 (400_000 cents) and never went negative
    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/accounts/summary',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    const brl = summaryRes
      .json()
      .checkingAccounts.find((a: { currency: string }) => a.currency === 'BRL');
    expect(brl.balanceCents).toBe(400_000);
  });

  it('4. Prevents AB-BA Database Deadlocks when Alpha->Beta and Beta->Alpha transfer simultaneously', async () => {
    const alphaEmail = `alpha.${runSuffix}@aegis.bank`;

    // Fire 5 simultaneous transfers from Alpha -> Beta (R$ 100,00 each)
    // AND 5 simultaneous transfers from Beta -> Alpha (R$ 100,00 each)
    const crossPromises = [
      ...Array.from({ length: 5 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/transfers/p2p',
          headers: {
            authorization: `Bearer ${userAToken}`,
            'idempotency-key': `deadlock-a2b-${runSuffix}-${i}`,
          },
          payload: {
            recipientIdentifier: userBEmail,
            currency: 'BRL',
            amountCents: 10_000,
          },
        })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/transfers/p2p',
          headers: {
            authorization: `Bearer ${userBToken}`,
            'idempotency-key': `deadlock-b2a-${runSuffix}-${i}`,
          },
          payload: {
            recipientIdentifier: alphaEmail,
            currency: 'BRL',
            amountCents: 10_000,
          },
        })
      ),
    ];

    const results = await Promise.all(crossPromises);
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
  });

  it('5. Executes Savings Vault creation, Time-Travel Compound Interest accrual, and Redemption', async () => {
    // Create a CDB 120% CDI vault with R$ 1.000,00 initial deposit
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/savings/vaults',
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': `vault-create-${runSuffix}`,
      },
      payload: {
        name: 'Study Case CDB 120%',
        productType: 'CDB_PLUS_120_CDI',
        currency: 'BRL',
        initialDepositCents: 100_000, // R$ 1.000,00
      },
    });
    expect(createRes.statusCode).toBe(201);
    const vaultId = createRes.json().vault.id;

    // Simulate +252 business days (1 full year @ 13.50% p.a. -> R$ 135,00 = 13_500 cents yield)
    const yieldRes = await app.inject({
      method: 'POST',
      url: `/api/savings/vaults/${vaultId}/simulate-yield`,
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': `vault-yield-${runSuffix}`,
      },
      payload: {
        businessDays: 252,
      },
    });
    expect(yieldRes.statusCode).toBe(200);
    expect(yieldRes.json().yieldAccruedCents).toBe(13_500);
    expect(yieldRes.json().vault.totalBalanceCents).toBe(113_500);

    // Redeem R$ 500,00 back to checking
    const redeemRes = await app.inject({
      method: 'POST',
      url: `/api/savings/vaults/${vaultId}/redeem`,
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': `vault-redeem-${runSuffix}`,
      },
      payload: {
        amountCents: 50_000,
      },
    });
    expect(redeemRes.statusCode).toBe(200);
    expect(redeemRes.json().vault.totalBalanceCents).toBe(63_500);
  });

  it('6. Executes Atomic 4-Leg Multi-Currency FX Exchange (USD -> BRL)', async () => {
    const fxRes = await app.inject({
      method: 'POST',
      url: '/api/fx/exchange',
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': `fx-usd-brl-${runSuffix}`,
      },
      payload: {
        fromCurrency: 'USD',
        toCurrency: 'BRL',
        sourceAmountCents: 50_000, // US$ 500.00
      },
    });
    expect(fxRes.statusCode).toBe(201);
    const body = fxRes.json();
    expect(body.ledgerReceipt.entries.length).toBe(4);
    expect(body.exchange.quote.targetAmountCents).toBeGreaterThan(250_000);
  });

  it('7. Executes Stock Market Orders, Limit Order Escrow Locking, and Automatic Limit Order Fill on Price Crossing', async () => {
    // Reset PETR4 price to R$ 38,50 (3850 cents)
    await app.inject({
      method: 'POST',
      url: '/api/market/set-price',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: { symbol: 'PETR4', priceCents: 3850 },
    });

    // Place a MARKET BUY order for 10 shares of PETR4 @ R$ 38,50
    const marketBuyRes = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': `trade-mkt-buy-${runSuffix}`,
      },
      payload: {
        symbol: 'PETR4',
        side: 'BUY',
        orderType: 'MARKET',
        quantity: 10,
      },
    });
    expect(marketBuyRes.statusCode).toBe(201);
    expect(marketBuyRes.json().order.status).toBe('FILLED');

    // Place a non-marketable LIMIT BUY order for 20 shares of PETR4 @ R$ 36,00 (3600 cents)
    const limitBuyRes = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': `trade-lim-buy-${runSuffix}`,
      },
      payload: {
        symbol: 'PETR4',
        side: 'BUY',
        orderType: 'LIMIT',
        quantity: 20,
        limitPriceCents: 3600,
      },
    });
    expect(limitBuyRes.statusCode).toBe(201);
    expect(limitBuyRes.json().order.status).toBe('OPEN');

    // Verify cash escrow is locked in Alpha's BRL checking account
    const summaryBeforeFill = await app.inject({
      method: 'GET',
      url: '/api/accounts/summary',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    const brlBefore = summaryBeforeFill
      .json()
      .checkingAccounts.find((a: { currency: string }) => a.currency === 'BRL');
    expect(brlBefore.lockedBalanceCents).toBeGreaterThanOrEqual(72_000);

    // Move PETR4 market price down to R$ 35,50 (3550 cents) -> crosses the R$ 36,00 Limit Buy!
    const priceDropRes = await app.inject({
      method: 'POST',
      url: '/api/market/set-price',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: { symbol: 'PETR4', priceCents: 3550 },
    });
    expect(priceDropRes.statusCode).toBe(200);
    expect(priceDropRes.json().filledOrdersCount).toBeGreaterThanOrEqual(1);

    // Verify portfolio now holds 30 shares of PETR4 (10 Market + 20 Limit) and escrow is unlocked
    const portfolioRes = await app.inject({
      method: 'GET',
      url: '/api/trading/portfolio',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    const petr4Holding = portfolioRes
      .json()
      .holdings.find((h: { symbol: string }) => h.symbol === 'PETR4');
    expect(petr4Holding.quantity).toBe(30);
  });

  it('8. Enforces Salesforce FSC Client 360 Overview, Compliant Interaction Redaction, and Gate 1 KYC Tier Block', async () => {
    // Fetch CRM Client 360 overview for Alpha
    const overviewRes = await app.inject({
      method: 'GET',
      url: '/api/crm/overview',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(overviewRes.statusCode).toBe(200);
    expect(overviewRes.json().kycProfile.tier).toBe('TIER_2_STANDARD');

    // Log a RESTRICTED_MNPI interaction note and verify automatic Chinese Wall redaction
    const interactionRes = await app.inject({
      method: 'POST',
      url: '/api/crm/interactions',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        channel: 'IN_PERSON',
        subject: 'Confidential M&A Mandate Briefing',
        notes: 'Sensitive board restructuring details for mining sector counterparty.',
        confidentialityLevel: 'RESTRICTED_MNPI',
      },
    });
    expect(interactionRes.statusCode).toBe(201);
    expect(interactionRes.json().interaction.redactedNotes).toContain('REDACTED');

    // Downgrade Alpha to TIER_1_SIMPLIFIED -> Gate 1 MUST block stock trading with 403
    const kycDowngradeRes = await app.inject({
      method: 'PUT',
      url: '/api/crm/kyc',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        tier: 'TIER_1_SIMPLIFIED',
        isPep: true,
        pepCategory: 'SENIOR_GOV',
      },
    });
    expect(kycDowngradeRes.statusCode).toBe(200);

    const blockedOrderRes = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': `kyc-block-${runSuffix}`,
      },
      payload: {
        symbol: 'ITUB4',
        side: 'BUY',
        orderType: 'MARKET',
        quantity: 1,
      },
    });
    expect(blockedOrderRes.statusCode).toBe(403);
    expect(blockedOrderRes.json().error.code).toBe('KYC_TIER_INSUFFICIENT');

    // Upgrade Alpha to TIER_3_ENHANCED so subsequent trading gates can be evaluated
    const kycUpgradeRes = await app.inject({
      method: 'PUT',
      url: '/api/crm/kyc',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        tier: 'TIER_3_ENHANCED',
        isPep: false,
      },
    });
    expect(kycUpgradeRes.statusCode).toBe(200);
  });

  it('9. Enforces Gate 2 Restricted Securities Blackout (403) and Gate 3 Conservative Volatility Attestation (422 -> 201)', async () => {
    // Ensure VALE3 is active on Restricted Securities List (Gate 2)
    await app.inject({
      method: 'POST',
      url: '/api/compliance/restricted-securities',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        symbol: 'VALE3',
        restrictionType: 'RESTRICTED_ALL',
        reason: 'M_AND_A_ADVISORY',
        isActive: true,
      },
    });

    // Attempting to BUY restricted VALE3 must be hard-blocked by Gate 2 with 403 RESTRICTED_SECURITY
    const restrictedBuyRes = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': `restricted-vale3-${runSuffix}`,
      },
      payload: {
        symbol: 'VALE3',
        side: 'BUY',
        orderType: 'MARKET',
        quantity: 2,
      },
    });
    expect(restrictedBuyRes.statusCode).toBe(403);
    expect(restrictedBuyRes.json().error.code).toBe('RESTRICTED_SECURITY');

    // Calibrate Beta (userBToken) to a CONSERVATIVE suitability profile (15% max concentration cap)
    const suitRes = await app.inject({
      method: 'PUT',
      url: '/api/crm/suitability',
      headers: { authorization: `Bearer ${userBToken}` },
      payload: {
        investmentObjective: 'CAPITAL_PRESERVATION',
        horizonMonths: 12,
        liquidityNeed: 'HIGH_IMMEDIATE',
        experienceLevel: 'BASIC_FIXED_INCOME',
        maxDrawdownTolerancePct: 5,
      },
    });
    expect(suitRes.statusCode).toBe(200);
    expect(suitRes.json().suitabilityProfile.riskTier).toBe('CONSERVATIVE');
    expect(suitRes.json().suitabilityProfile.maxStockConcentrationBps).toBe(1500);

    // Beta (CONSERVATIVE) attempts to buy high-volatility PETR4 (140 bps) WITHOUT client attestation -> 422
    const unattestedRes = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      headers: {
        authorization: `Bearer ${userBToken}`,
        'idempotency-key': `gate3-unattested-${runSuffix}`,
      },
      payload: {
        symbol: 'PETR4',
        side: 'BUY',
        orderType: 'MARKET',
        quantity: 5,
        hasClientAttestation: false,
      },
    });
    expect(unattestedRes.statusCode).toBe(422);
    expect(unattestedRes.json().error.code).toBe('SUITABILITY_ATTESTATION_REQUIRED');

    // Beta resubmits with signed digital attestation (hasClientAttestation: true) -> 201 FILLED!
    const attestedRes = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      headers: {
        authorization: `Bearer ${userBToken}`,
        'idempotency-key': `gate3-attested-${runSuffix}`,
      },
      payload: {
        symbol: 'PETR4',
        side: 'BUY',
        orderType: 'MARKET',
        quantity: 5,
        hasClientAttestation: true,
        attestationText: 'Client digitally accepted volatility waiver.',
      },
    });
    expect(attestedRes.statusCode).toBe(201);
    expect(attestedRes.json().order.status).toBe('FILLED');
  });

  it('10. Enforces Gate 4 Concentration Escrow Hold (PENDING_COMPLIANCE_APPROVAL) and Supervisory APPROVE / REJECT Settlement', async () => {
    // Beta has ~R$ 46.000 BRL checking + USD/EUR (~R$ 60.000 liquid net worth) and a 15% (1500 bps) concentration cap.
    // Buying 500 shares of ITUB4 @ R$ 34,80 = R$ 17.400,00 (> 28% concentration) breaches Gate 4!
    const holdOrderRes = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      headers: {
        authorization: `Bearer ${userBToken}`,
        'idempotency-key': `gate4-hold-approve-${runSuffix}`,
      },
      payload: {
        symbol: 'ITUB4',
        side: 'BUY',
        orderType: 'MARKET',
        quantity: 500,
      },
    });
    expect(holdOrderRes.statusCode).toBe(201);
    const heldOrder = holdOrderRes.json().order;
    expect(heldOrder.status).toBe('PENDING_COMPLIANCE_APPROVAL');

    // Verify cash escrow is locked in Beta's BRL checking account while awaiting supervisory sign-off
    const summaryDuringHold = await app.inject({
      method: 'GET',
      url: '/api/accounts/summary',
      headers: { authorization: `Bearer ${userBToken}` },
    });
    const betaBrlDuringHold = summaryDuringHold
      .json()
      .checkingAccounts.find((a: { currency: string }) => a.currency === 'BRL');
    expect(betaBrlDuringHold.lockedBalanceCents).toBeGreaterThanOrEqual(
      heldOrder.totalGrossCents + heldOrder.feeCents
    );

    // Compliance Officer (Alpha) APPROVES the held order -> Escrow unlocks, Ledger settles, status becomes FILLED!
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/compliance/overrides/${heldOrder.id}/resolve`,
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': `override-approve-${runSuffix}`,
      },
      payload: {
        action: 'APPROVE',
        rationale: 'Approved after reviewing consolidated household liquidity.',
      },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().orderStatus).toBe('FILLED');
    expect(approveRes.json().overrideStatus).toBe('APPROVED');

    // Place a second concentration-breaching order (200 ITUB4) and REJECT it -> Escrow must be released and status CANCELLED
    const secondHoldRes = await app.inject({
      method: 'POST',
      url: '/api/trading/orders',
      headers: {
        authorization: `Bearer ${userBToken}`,
        'idempotency-key': `gate4-hold-reject-${runSuffix}`,
      },
      payload: {
        symbol: 'ITUB4',
        side: 'BUY',
        orderType: 'MARKET',
        quantity: 200,
      },
    });
    expect(secondHoldRes.statusCode).toBe(201);
    const secondHeldOrder = secondHoldRes.json().order;
    expect(secondHeldOrder.status).toBe('PENDING_COMPLIANCE_APPROVAL');

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/compliance/overrides/${secondHeldOrder.id}/resolve`,
      headers: {
        authorization: `Bearer ${userAToken}`,
        'idempotency-key': `override-reject-${runSuffix}`,
      },
      payload: {
        action: 'REJECT',
        rationale: 'Rejected due to excessive single-issuer banking sector exposure.',
      },
    });
    expect(rejectRes.statusCode).toBe(200);
    expect(rejectRes.json().orderStatus).toBe('CANCELLED');
    expect(rejectRes.json().overrideStatus).toBe('REJECTED');

    // Verify Beta's locked escrow is now completely released (0 locked cents)
    const summaryAfterReject = await app.inject({
      method: 'GET',
      url: '/api/accounts/summary',
      headers: { authorization: `Bearer ${userBToken}` },
    });
    const betaBrlAfter = summaryAfterReject
      .json()
      .checkingAccounts.find((a: { currency: string }) => a.currency === 'BRL');
    expect(betaBrlAfter.lockedBalanceCents).toBe(0);
  });

  it('11. Verifies the Global Double-Entry Zero-Sum Invariant and SEC 17a-4 Audit Hash Integrity across PostgreSQL', async () => {
    const rows = (await db.execute(sql`
      SELECT
        currency,
        SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE 0 END)::bigint AS total_debits,
        SUM(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END)::bigint AS total_credits
      FROM ledger_entries
      GROUP BY currency
    `)) as unknown as Array<{
      currency: string;
      total_debits: string;
      total_credits: string;
    }>;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.total_debits).toBe(row.total_credits);
    }

    const auditCountRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM compliance_audit_logs
      WHERE length(record_hash) = 64
    `)) as unknown as Array<{ count: number }>;
    expect(Number(auditCountRows[0]?.count ?? 0)).toBeGreaterThanOrEqual(6);
  });
});
