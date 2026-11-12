import { eq } from 'drizzle-orm';
import { db, queryClient } from './index.js';
import { ensureSchema } from './migrate.js';
import { accounts, portfolios, savingsVaults, tradeOrders, users } from './schema.js';
import { createUserWithAccounts } from '../modules/auth/routes.js';
import { ensureDefaultAssets } from '../modules/market/engine.js';
import { getOrCreateSystemAccount } from '../domain/ledger/system-accounts.js';
import { postLedgerTransaction } from '../domain/ledger/post-ledger-transaction.js';
import { calculateBrokerageFee } from '../domain/money/financial-math.js';

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
