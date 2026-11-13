import { eq } from 'drizzle-orm';
import { db, queryClient, type DbTransaction } from './index.js';
import { ensureSchema } from './migrate.js';
import {
  accounts,
  financialAccountRoles,
  householdMembers,
  households,
  interactionLogs,
  kycProfiles,
  partyRelationships,
  personLifeEvents,
  portfolios,
  restrictedSecurities,
  savingsVaults,
  suitabilityProfiles,
  tradeOrders,
  users,
} from './schema.js';
import { createUserWithAccounts } from '../modules/auth/routes.js';
import { ensureDefaultAssets } from '../modules/market/engine.js';
import { getOrCreateSystemAccount } from '../domain/ledger/system-accounts.js';
import { postLedgerTransaction } from '../domain/ledger/post-ledger-transaction.js';
import { calculateBrokerageFee } from '../domain/money/financial-math.js';

async function ensureCrmSeedData(
  tx: DbTransaction,
  alice: typeof users.$inferSelect,
  bob: typeof users.$inferSelect
): Promise<void> {
  const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  // 1. Ensure KYC profiles for Alice (Tier 3 Enhanced) & Bob (Tier 2 Standard)
  await tx
    .insert(kycProfiles)
    .values({
      userId: alice.id,
      tier: 'TIER_3_ENHANCED',
      status: 'VERIFIED',
      isPep: false,
      dailyTransferLimitCents: 25_000_000, // R$ 250.000,00
      nextReviewDueAt: oneYearFromNow,
      verifiedBy: bob.id,
    })
    .onConflictDoNothing({ target: kycProfiles.userId });

  await tx
    .insert(kycProfiles)
    .values({
      userId: bob.id,
      tier: 'TIER_2_STANDARD',
      status: 'VERIFIED',
      isPep: true,
      pepCategory: 'SENIOR_GOV',
      pepDescription: 'Advisory Board Member — State Infrastructure Development Fund (Enhanced AML Monitoring)',
      dailyTransferLimitCents: 5_000_000, // R$ 50.000,00
      nextReviewDueAt: oneYearFromNow,
      verifiedBy: alice.id,
    })
    .onConflictDoNothing({ target: kycProfiles.userId });

  // 2. Ensure Suitability profiles for Alice & Bob
  const existingAliceSuit = await tx
    .select()
    .from(suitabilityProfiles)
    .where(eq(suitabilityProfiles.userId, alice.id))
    .limit(1);

  if (existingAliceSuit.length === 0) {
    await tx.insert(suitabilityProfiles).values({
      userId: alice.id,
      riskTier: 'BALANCED_GROWTH',
      score: 74,
      horizonMonths: 60,
      maxStockConcentrationBps: 2500, // 25.00% max single-stock concentration
      maxSingleTradeCents: 2_500_000,
      questionnaireAnswers: {
        investmentObjective: 'BALANCED_GROWTH',
        horizonMonths: 60,
        liquidityNeed: 'MEDIUM_6_TO_12M',
        experienceLevel: 'EQUITIES_AND_ETFS',
        maxDrawdownTolerancePct: 20,
      },
      expiresAt: oneYearFromNow,
    });
  }

  const existingBobSuit = await tx
    .select()
    .from(suitabilityProfiles)
    .where(eq(suitabilityProfiles.userId, bob.id))
    .limit(1);

  if (existingBobSuit.length === 0) {
    await tx.insert(suitabilityProfiles).values({
      userId: bob.id,
      riskTier: 'CONSERVATIVE',
      score: 32,
      horizonMonths: 18,
      maxStockConcentrationBps: 1500, // 15.00% max single-stock concentration
      maxSingleTradeCents: 750_000,
      questionnaireAnswers: {
        investmentObjective: 'CAPITAL_PRESERVATION',
        horizonMonths: 18,
        liquidityNeed: 'HIGH_IMMEDIATE',
        experienceLevel: 'BASIC_FIXED_INCOME',
        maxDrawdownTolerancePct: 5,
      },
      expiresAt: oneYearFromNow,
    });
  }

  // 3. Ensure Household ("Silva & Santos Family Office")
  const existingHousehold = await tx
    .select()
    .from(households)
    .where(eq(households.name, 'Silva & Santos Family Office'))
    .limit(1);

  if (existingHousehold.length === 0) {
    const [household] = await tx
      .insert(households)
      .values({
        name: 'Silva & Santos Family Office',
        taxIdentifier: '48.912.340/0001-77',
        notes: 'Private Wealth Multi-Currency Household Group • Consolidated B3 & Global Equities Rollup',
      })
      .returning();

    if (household) {
      await tx.insert(householdMembers).values([
        {
          householdId: household.id,
          userId: alice.id,
          role: 'HEAD_OF_HOUSEHOLD',
          isDecisionMaker: true,
          includeInRollup: true,
        },
        {
          householdId: household.id,
          userId: bob.id,
          role: 'SPOUSE',
          isDecisionMaker: true,
          includeInRollup: true,
        },
      ]);
    }

    // 4. Party Role Relationships (UBO & Reciprocal Graph)
    await tx
      .insert(partyRelationships)
      .values([
        {
          sourceUserId: alice.id,
          targetUserId: bob.id,
          relationshipType: 'UBO_CONTROLLER',
          reciprocalType: 'MANAGING_PARTNER',
          ownershipPercentageBps: 6000, // 60.00% UBO Controlling Stake
          isUbo: true,
          isActive: true,
        },
      ])
      .onConflictDoNothing();

    // 5. Financial Account Roles (Joint / Authorized Trader visibility)
    const aliceAccs = await tx.select().from(accounts).where(eq(accounts.userId, alice.id));
    for (const acc of aliceAccs) {
      await tx
        .insert(financialAccountRoles)
        .values([
          {
            accountId: acc.id,
            userId: alice.id,
            roleType: 'PRIMARY_OWNER',
            canTrade: true,
            canWithdraw: true,
          },
          {
            accountId: acc.id,
            userId: bob.id,
            roleType: 'AUTHORIZED_TRADER',
            canTrade: true,
            canWithdraw: false,
          },
        ])
        .onConflictDoNothing();
    }

    // 6. Advisor Interaction Logs (with Compliant Data Sharing / MNPI Redaction)
    await tx.insert(interactionLogs).values([
      {
        clientId: alice.id,
        advisorId: bob.id,
        channel: 'VIDEO',
        subject: 'Q3 Family Office Asset Allocation & FX Hedge Review',
        notes:
          'Reviewed consolidated BRL/USD/EUR exposure across checking, CDB 110% CDI vault, and B3 equity holdings. Client reaffirmed 25% single-stock concentration guardrail and requested opportunistic USD accumulation when PTAX dips below R$ 5.75.',
        confidentialityLevel: 'STANDARD',
      },
      {
        clientId: alice.id,
        advisorId: bob.id,
        channel: 'IN_PERSON',
        subject: 'Executive M&A Advisory Cross-Wall Clearance & Estate Trust',
        notes:
          'Client disclosed advisory involvement in Mining & Metals sector restructuring. Placed VALE3 on MNPI Restricted Trading List (Gate 2 Hard Block) and structured offshore UBO succession schedule.',
        redactedNotes:
          'Client discussed sector blackout compliance [REDACTED — MNPI CHINESE WALL] and updated family office succession schedule.',
        confidentialityLevel: 'RESTRICTED_MNPI',
      },
    ]);

    // 7. Person Life Events (Salesforce FSC Milestones)
    await tx.insert(personLifeEvents).values([
      {
        userId: alice.id,
        eventType: 'CAREER_CHANGE',
        title: 'Board Appointment & Long-Term Equity Vesting',
        description: 'Annual R$ 450.000,00 liquidity inflow scheduled across Q4 tranches.',
        eventDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        financialImpactCents: 45_000_000,
        requiresSuitabilityReview: false,
      },
      {
        userId: alice.id,
        eventType: 'HOME_PURCHASE',
        title: 'Jardins Commercial Office Acquisition Target',
        description: 'Target down-payment reserve held in CDB Liquidez 110% CDI vault.',
        eventDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        financialImpactCents: 120_000_000,
        requiresSuitabilityReview: true,
      },
    ]);

    // 8. Restricted Securities List (VALE3 restricted by default due to M&A Advisory Blackout)
    await tx.insert(restrictedSecurities).values({
      symbol: 'VALE3',
      restrictionType: 'RESTRICTED_ALL',
      reason: 'M_AND_A_ADVISORY',
      notes: 'Active Investment Banking M&A Advisory Mandate — Trading Blackout enforced by Gate 2.',
      effectiveFrom: oneYearAgo,
      effectiveTo: oneYearFromNow,
      addedBy: bob.id,
      isActive: true,
    });
  }
}

export async function seedDatabase(): Promise<void> {
  await ensureSchema();

  await db.transaction(async (tx) => {
    // 1. Ensure System Liquidity Accounts for all currencies
    for (const currency of ['BRL', 'USD', 'EUR'] as const) {
      await getOrCreateSystemAccount(tx, 'SYS-TREASURY', currency);
      await getOrCreateSystemAccount(tx, 'SYS-FX-POOL', currency);
      await getOrCreateSystemAccount(tx, 'SYS-MARKET-CLEARING', currency);
      await getOrCreateSystemAccount(tx, 'SYS-BILL-SETTLEMENT', currency);
    }

    // 2. Ensure Default Stock Market Assets
    await ensureDefaultAssets(tx);

    // 3. Check if Alice already exists
    const [existingAlice] = await tx
      .select()
      .from(users)
      .where(eq(users.email, 'alice@aegis.bank'))
      .limit(1);

    if (existingAlice) {
      const [existingBob] = await tx
        .select()
        .from(users)
        .where(eq(users.email, 'bob@aegis.bank'))
        .limit(1);
      if (existingBob) {
        await ensureCrmSeedData(tx, existingAlice, existingBob);
      }
      return;
    }

    // 4. Create Demo User 1: Alice Silva (Primary Learner Account)
    const { user: alice } = await createUserWithAccounts(tx, {
      name: 'Alice Silva',
      email: 'alice@aegis.bank',
      documentNumber: '11122233344',
      password: 'password123',
      accountPrefix: '1001-1',
      welcomeBrlCents: 5_000_000, // R$ 50.000,00
      welcomeUsdCents: 350_000, // US$ 3,500.00
      welcomeEurCents: 120_000, // € 1.200,00
    });

    // 5. Create Demo User 2: Bob Santos (Counterparty for P2P Pix Transfers)
    const { user: bob } = await createUserWithAccounts(tx, {
      name: 'Bob Santos',
      email: 'bob@aegis.bank',
      documentNumber: '55566677788',
      password: 'password123',
      accountPrefix: '1002-9',
      welcomeBrlCents: 1_800_000, // R$ 18.000,00
      welcomeUsdCents: 150_000, // US$ 1,500.00
      welcomeEurCents: 50_000, // € 500,00
    });

    const aliceAccounts = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.userId, alice.id));
    const bobAccounts = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.userId, bob.id));

    const aliceBrl = aliceAccounts.find((a) => a.currency === 'BRL' && a.accountType === 'CHECKING')!;
    const bobBrl = bobAccounts.find((a) => a.currency === 'BRL' && a.accountType === 'CHECKING')!;

    // 6. Seed a sample Pix transfer from Alice to Bob (R$ 450,00)
    await postLedgerTransaction(tx, {
      idempotencyKey: 'seed-pix-alice-to-bob-1',
      category: 'TRANSFER',
      description: 'Pix Transfer: Dinner & Concert Split to Bob Santos',
      metadata: {
        senderUserId: alice.id,
        recipientAccountId: bobBrl.id,
        recipientName: bob.name,
      },
      postings: [
        { accountId: aliceBrl.id, direction: 'DEBIT', amountCents: 45_000, currency: 'BRL' },
        { accountId: bobBrl.id, direction: 'CREDIT', amountCents: 45_000, currency: 'BRL' },
      ],
    });

    // 7. Seed a Savings Vault (CDB 110% CDI) for Alice with R$ 10.000,00 + R$ 118,50 accrued yield
    const [vaultBacking] = await tx
      .insert(accounts)
      .values({
        userId: alice.id,
        accountNumber: 'VAULT-100101',
        currency: 'BRL',
        accountType: 'SAVINGS_VAULT',
        label: 'Vault: Emergency & Opportunity Reserve (BRL)',
        balanceCents: 0,
        lockedBalanceCents: 0,
      })
      .returning();

    await postLedgerTransaction(tx, {
      idempotencyKey: 'seed-alice-vault-deposit',
      category: 'SAVINGS_DEPOSIT',
      description: 'Initial Deposit into Vault "Emergency & Opportunity Reserve"',
      postings: [
        { accountId: aliceBrl.id, direction: 'DEBIT', amountCents: 1_000_000, currency: 'BRL' },
        { accountId: vaultBacking!.id, direction: 'CREDIT', amountCents: 1_000_000, currency: 'BRL' },
      ],
    });

    const sysTreasuryBrl = await getOrCreateSystemAccount(tx, 'SYS-TREASURY', 'BRL');
    await postLedgerTransaction(tx, {
      idempotencyKey: 'seed-alice-vault-yield',
      category: 'SAVINGS_YIELD',
      description: 'CDI Yield Accrual (+25 business days @ 110% CDI)',
      postings: [
        { accountId: sysTreasuryBrl.id, direction: 'DEBIT', amountCents: 11_850, currency: 'BRL' },
        { accountId: vaultBacking!.id, direction: 'CREDIT', amountCents: 11_850, currency: 'BRL' },
      ],
    });

    await tx.insert(savingsVaults).values({
      userId: alice.id,
      backingAccountId: vaultBacking!.id,
      name: 'Emergency & Opportunity Reserve',
      productType: 'CDB_LIQUIDEZ_110_CDI',
      currency: 'BRL',
      annualRateBps: 1238,
      cdiPercentage: 110,
      principalCents: 1_000_000,
      accruedYieldCents: 11_850,
      simulatedDaysElapsed: 25,
    });

    // 8. Seed a sample Stock Purchase for Alice (100 PETR4 @ R$ 37,50 -> R$ 3.750,00 + fee)
    const clearingBrl = await getOrCreateSystemAccount(tx, 'SYS-MARKET-CLEARING', 'BRL');
    const grossBuy = 100 * 3750;
    const feeBuy = calculateBrokerageFee(grossBuy);
    const totalBuy = grossBuy + feeBuy;

    const stockReceipt = await postLedgerTransaction(tx, {
      idempotencyKey: 'seed-alice-buy-petr4',
      category: 'STOCK_BUY',
      description: 'Stock Buy (MARKET): 100 PETR4 @ 37.50 BRL',
      metadata: {
        symbol: 'PETR4',
        side: 'BUY',
        quantity: 100,
        executionPriceCents: 3750,
        feeCents: feeBuy,
      },
      postings: [
        { accountId: aliceBrl.id, direction: 'DEBIT', amountCents: totalBuy, currency: 'BRL' },
        { accountId: clearingBrl.id, direction: 'CREDIT', amountCents: totalBuy, currency: 'BRL' },
      ],
    });

    await tx.insert(portfolios).values({
      userId: alice.id,
      symbol: 'PETR4',
      quantity: 100,
      lockedQuantity: 0,
      averagePriceCents: Math.floor(totalBuy / 100),
      realizedPnlCents: 0,
    });

    await tx.insert(tradeOrders).values({
      userId: alice.id,
      symbol: 'PETR4',
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 100,
      limitPriceCents: null,
      executedPriceCents: 3750,
      totalGrossCents: grossBuy,
      feeCents: feeBuy,
      currency: 'BRL',
      status: 'FILLED',
      ledgerTransactionId: stockReceipt.transactionId,
      executedAt: new Date(),
    });

    await ensureCrmSeedData(tx, alice, bob);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase()
    .then(async () => {
      console.log('🌱 Database seeded with System Accounts, Market Assets, and Demo Users (Alice & Bob).');
      await queryClient.end();
    })
    .catch(async (err) => {
      console.error('❌ Database seed failed:', err);
      await queryClient.end();
      process.exit(1);
    });
}
