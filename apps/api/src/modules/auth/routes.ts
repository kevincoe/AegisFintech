import type { FastifyInstance } from 'fastify';
import { eq, asc } from 'drizzle-orm';
import { LoginInputSchema, RegisterInputSchema } from '@aegis/shared';
import { db, type DbTransaction } from '../../db/index.js';
import { accounts, users } from '../../db/schema.js';
import { AppError } from '../../core/errors.js';
import { hashPassword, requireAuth, signJwt, verifyPassword } from '../../core/auth.js';
import { postLedgerTransaction } from '../../domain/ledger/post-ledger-transaction.js';
import { getOrCreateSystemAccount } from '../../domain/ledger/system-accounts.js';

/**
 * Provisions a new user along with their multi-currency checking accounts (BRL, USD, EUR)
 * and credits an initial welcome capital from the System Treasury so they can immediately
 * practice transfers, FX conversions, savings, and stock trading.
 */
export async function createUserWithAccounts(
  tx: DbTransaction,
  input: {
    name: string;
    email: string;
    documentNumber: string;
    password: string;
    accountPrefix?: string;
    welcomeBrlCents?: number;
    welcomeUsdCents?: number;
    welcomeEurCents?: number;
  }
) {
  const existingEmail = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  if (existingEmail.length > 0) {
    throw new AppError('CONFLICT', 'An account with this email already exists.', 409);
  }

  const existingDoc = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.documentNumber, input.documentNumber))
    .limit(1);

  if (existingDoc.length > 0) {
    throw new AppError('CONFLICT', 'An account with this document number already exists.', 409);
  }

  const passwordHash = await hashPassword(input.password);

  const [user] = await tx
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      documentNumber: input.documentNumber,
      passwordHash,
    })
    .returning();

  if (!user) {
    throw new AppError('INTERNAL_ERROR', 'Failed to create user', 500);
  }

  const prefix =
    input.accountPrefix ??
    `${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1 + Math.random() * 9)}`;

  const createdAccounts = await tx
    .insert(accounts)
    .values([
      {
        userId: user.id,
        accountNumber: prefix,
        currency: 'BRL',
        accountType: 'CHECKING',
        label: `${user.name} Checking (BRL)`,
        balanceCents: 0,
        lockedBalanceCents: 0,
      },
      {
        userId: user.id,
        accountNumber: prefix,
        currency: 'USD',
        accountType: 'CHECKING',
        label: `${user.name} Global Account (USD)`,
        balanceCents: 0,
        lockedBalanceCents: 0,
      },
      {
        userId: user.id,
        accountNumber: prefix,
        currency: 'EUR',
        accountType: 'CHECKING',
        label: `${user.name} Global Account (EUR)`,
        balanceCents: 0,
        lockedBalanceCents: 0,
      },
    ])
    .returning();

  const brlAcc = createdAccounts.find((a) => a.currency === 'BRL')!;
  const usdAcc = createdAccounts.find((a) => a.currency === 'USD')!;
  const eurAcc = createdAccounts.find((a) => a.currency === 'EUR')!;

  const welcomeBrl = input.welcomeBrlCents ?? 2_500_000; // R$ 25.000,00
  const welcomeUsd = input.welcomeUsdCents ?? 200_000; // US$ 2,000.00
  const welcomeEur = input.welcomeEurCents ?? 50_000; // € 500,00

  const postings = [];

  if (welcomeBrl > 0) {
    const sysBrl = await getOrCreateSystemAccount(tx, 'SYS-TREASURY', 'BRL');
    postings.push(
      { accountId: sysBrl.id, direction: 'DEBIT' as const, amountCents: welcomeBrl, currency: 'BRL' as const },
      { accountId: brlAcc.id, direction: 'CREDIT' as const, amountCents: welcomeBrl, currency: 'BRL' as const }
    );
  }

  if (welcomeUsd > 0) {
    const sysUsd = await getOrCreateSystemAccount(tx, 'SYS-TREASURY', 'USD');
    postings.push(
      { accountId: sysUsd.id, direction: 'DEBIT' as const, amountCents: welcomeUsd, currency: 'USD' as const },
      { accountId: usdAcc.id, direction: 'CREDIT' as const, amountCents: welcomeUsd, currency: 'USD' as const }
    );
  }

  if (welcomeEur > 0) {
    const sysEur = await getOrCreateSystemAccount(tx, 'SYS-TREASURY', 'EUR');
    postings.push(
      { accountId: sysEur.id, direction: 'DEBIT' as const, amountCents: welcomeEur, currency: 'EUR' as const },
      { accountId: eurAcc.id, direction: 'CREDIT' as const, amountCents: welcomeEur, currency: 'EUR' as const }
    );
  }

  if (postings.length > 0) {
    await postLedgerTransaction(tx, {
      category: 'WELCOME_BONUS',
      description: 'Welcome Onboarding Capital Provisioning',
      postings,
      metadata: { onboardingUserId: user.id },
    });
  }

  return { user, accountNumber: prefix };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (request, reply) => {
    const body = RegisterInputSchema.parse(request.body);

    const { user, accountNumber } = await db.transaction(async (tx) =>
      createUserWithAccounts(tx, body)
    );

    const token = signJwt({ id: user.id, email: user.email, name: user.name });
    reply.setCookie('aegis_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 86400 * 7,
    });

    return reply.status(201).send({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        documentNumber: user.documentNumber,
        accountNumber,
      },
    });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = LoginInputSchema.parse(request.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new AppError('UNAUTHORIZED', 'Invalid email or password.', 401);
    }

    const [primaryAcc] = await db
      .select({ accountNumber: accounts.accountNumber })
      .from(accounts)
      .where(eq(accounts.userId, user.id))
      .limit(1);

    const token = signJwt({ id: user.id, email: user.email, name: user.name });
    reply.setCookie('aegis_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 86400 * 7,
    });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        documentNumber: user.documentNumber,
        accountNumber: primaryAcc?.accountNumber ?? '',
      },
    };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie('aegis_token', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: [requireAuth] }, async (request) => {
    const userId = request.authUser!.id;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'Session user no longer exists', 401);
    }

    const userAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, user.id))
      .orderBy(asc(accounts.currency));

    const checkingAccounts = userAccounts.filter((a) => a.accountType === 'CHECKING');

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        documentNumber: user.documentNumber,
        accountNumber: checkingAccounts[0]?.accountNumber ?? '',
      },
      accounts: checkingAccounts.map((a) => ({
        id: a.id,
        accountNumber: a.accountNumber,
        currency: a.currency,
        balanceCents: a.balanceCents,
        lockedBalanceCents: a.lockedBalanceCents,
        availableBalanceCents: a.balanceCents - a.lockedBalanceCents,
      })),
    };
  });

  /**
   * Didactic Helper: Lists pre-seeded users so the learner can switch between Alice and Bob
   * with a single click to observe both sides of P2P transfers and stock trades.
   */
  app.get('/api/auth/demo-users', async () => {
    const allUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        documentNumber: users.documentNumber,
      })
      .from(users)
      .orderBy(asc(users.createdAt))
      .limit(10);

    const enriched = await Promise.all(
      allUsers.map(async (u) => {
        const [acc] = await db
          .select({ accountNumber: accounts.accountNumber })
          .from(accounts)
          .where(eq(accounts.userId, u.id))
          .limit(1);
        return {
          ...u,
          accountNumber: acc?.accountNumber ?? '',
        };
      })
    );

    return { users: enriched };
  });

  app.post('/api/auth/quick-switch/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new AppError('NOT_FOUND', 'Target demo user not found', 404);
    }

    const [primaryAcc] = await db
      .select({ accountNumber: accounts.accountNumber })
      .from(accounts)
      .where(eq(accounts.userId, user.id))
      .limit(1);

    const token = signJwt({ id: user.id, email: user.email, name: user.name });
    reply.setCookie('aegis_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 86400 * 7,
    });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        documentNumber: user.documentNumber,
        accountNumber: primaryAcc?.accountNumber ?? '',
      },
    };
  });
}
