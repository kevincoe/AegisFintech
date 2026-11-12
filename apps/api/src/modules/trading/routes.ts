import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PlaceOrderInputSchema, type CurrencyCode } from '@aegis/shared';
import { db } from '../../db/index.js';
import { accounts, assets, portfolios, tradeOrders } from '../../db/schema.js';
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
import {
  matchOpenLimitOrdersForSymbol,
  stepMarketSimulation,
  subscribeToMarketStream,
} from '../market/engine.js';
import { getAllFxPairs } from '../fx/rates.js';

export async function tradingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/market/assets
   * Returns all listed equities/ETFs with current price, day change %, high/low, and FX pairs.
   */
  app.get('/api/market/assets', async () => {
    const rows = await db.select().from(assets).orderBy(asc(assets.symbol));
    return {
      assets: rows.map((a) => {
        const changeCents = a.currentPriceCents - a.openPriceCents;
        const changePercent =
          a.openPriceCents > 0 ? Number(((changeCents / a.openPriceCents) * 100).toFixed(2)) : 0;
        return {
          ...a,
          changeCents,
          changePercent,
          updatedAt: a.updatedAt.toISOString(),
        };
      }),
      fxPairs: getAllFxPairs(),
    };
  });

  /**
   * GET /api/market/stream
   * Server-Sent Events (SSE) live stream pushing real-time stock ticks and FX updates.
   */
  app.get('/api/market/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': request.headers.origin ?? '*',
      'Access-Control-Allow-Credentials': 'true',
    });

    const initialAssets = await db.select().from(assets).orderBy(asc(assets.symbol));
    reply.raw.write(
      `data: ${JSON.stringify({
        assets: initialAssets.map((a) => ({
          ...a,
          changeCents: a.currentPriceCents - a.openPriceCents,
          changePercent: Number(
            (((a.currentPriceCents - a.openPriceCents) / a.openPriceCents) * 100).toFixed(2)
          ),
        })),
        fxPairs: getAllFxPairs(),
        filledOrdersCount: 0,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    const unsubscribe = subscribeToMarketStream((payload) => {
      reply.raw.write(
        `data: ${JSON.stringify({
          ...payload,
          assets: payload.assets.map((a) => ({
            ...a,
            changeCents: a.currentPriceCents - a.openPriceCents,
            changePercent: Number(
              (((a.currentPriceCents - a.openPriceCents) / a.openPriceCents) * 100).toFixed(2)
            ),
          })),
        })}\n\n`
      );
    });

    request.raw.on('close', () => {
      unsubscribe();
    });
  });

  /**
   * POST /api/market/set-price
   * Didactic & Testing Endpoint: Sets an asset's price deterministically and runs the Limit Order
   * Matching Engine immediately so the learner can test Limit Order execution on demand!
   */
  app.post('/api/market/set-price', { preHandler: [requireAuth] }, async (request) => {
    const schema = z.object({
      symbol: z.string().trim().toUpperCase(),
      priceCents: z.number().int().positive(),
    });
    const body = schema.parse(request.body);

    const result = await db.transaction(async (tx) => {
      const [asset] = await tx
        .select()
        .from(assets)
        .where(eq(assets.symbol, body.symbol))
        .limit(1);

      if (!asset) {
        throw new AppError('NOT_FOUND', `Asset ${body.symbol} not found`, 404);
      }

      const [updated] = await tx
        .update(assets)
        .set({
          currentPriceCents: body.priceCents,
          highPriceCents: Math.max(asset.highPriceCents, body.priceCents),
          lowPriceCents: Math.min(asset.lowPriceCents, body.priceCents),
          updatedAt: new Date(),
        })
        .where(eq(assets.symbol, body.symbol))
        .returning();

      const filledOrdersCount = await matchOpenLimitOrdersForSymbol(
        tx,
        body.symbol,
        body.priceCents
      );

      return { asset: updated!, filledOrdersCount };
    });

    return result;
  });

  app.post('/api/market/tick', { preHandler: [requireAuth] }, async () => {
    return stepMarketSimulation();
  });

  /**
   * GET /api/trading/portfolio
   * Returns user's stock holdings with weighted average cost, unrealized P&L, realized P&L,
   * and recent/open trade orders.
   */
  app.get('/api/trading/portfolio', { preHandler: [requireAuth] }, async (request) => {
    const userId = request.authUser!.id;

    const holdings = await db
      .select({
        id: portfolios.id,
        symbol: portfolios.symbol,
        name: assets.name,
        sector: assets.sector,
        exchange: assets.exchange,
        currency: assets.currency,
        quantity: portfolios.quantity,
        lockedQuantity: portfolios.lockedQuantity,
        averagePriceCents: portfolios.averagePriceCents,
        realizedPnlCents: portfolios.realizedPnlCents,
        currentPriceCents: assets.currentPriceCents,
      })
      .from(portfolios)
      .innerJoin(assets, eq(portfolios.symbol, assets.symbol))
      .where(eq(portfolios.userId, userId))
      .orderBy(asc(portfolios.symbol));

    const orders = await db
      .select()
      .from(tradeOrders)
      .where(eq(tradeOrders.userId, userId))
      .orderBy(desc(tradeOrders.createdAt))
      .limit(40);

    const enrichedHoldings = holdings
      .filter((h) => h.quantity > 0 || h.realizedPnlCents !== 0)
      .map((h) => {
        const availableQuantity = h.quantity - h.lockedQuantity;
        const totalCostBasisCents = h.quantity * h.averagePriceCents;
        const marketValueCents = h.quantity * h.currentPriceCents;
        const unrealizedPnlCents = marketValueCents - totalCostBasisCents;
        const unrealizedPnlPercent =
          totalCostBasisCents > 0
            ? Number(((unrealizedPnlCents / totalCostBasisCents) * 100).toFixed(2))
            : 0;

        return {
          ...h,
          availableQuantity,
          totalCostBasisCents,
          marketValueCents,
          unrealizedPnlCents,
          unrealizedPnlPercent,
        };
      });

    return {
      holdings: enrichedHoldings,
      orders: orders.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
        executedAt: o.executedAt ? o.executedAt.toISOString() : null,
      })),
    };
  });

  /**
   * POST /api/trading/orders
   * Places a MARKET or LIMIT order (`BUY` or `SELL`) with full Idempotency and Escrow Locking.
   */
  app.post('/api/trading/orders', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.authUser!.id;
    const body = PlaceOrderInputSchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    const result = await executeIdempotent({
      userId,
      idempotencyKey,
      endpoint: 'POST /api/trading/orders',
      payload: body,
      statusCode: 201,
      handler: async (tx) => {
        const [asset] = await tx
          .select()
          .from(assets)
          .where(eq(assets.symbol, body.symbol))
          .limit(1);

        if (!asset) {
          throw new AppError('NOT_FOUND', `Asset "${body.symbol}" is not listed on the exchange.`, 404);
        }

        const currency = asset.currency as CurrencyCode;

        // Lock user's checking account for this currency
        const [userChecking] = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, userId),
              eq(accounts.currency, currency),
              eq(accounts.accountType, 'CHECKING')
            )
          )
          .limit(1);

        if (!userChecking) {
          throw new AppError('NOT_FOUND', `User does not have a ${currency} checking account`, 404);
        }

        // Determine if this order executes immediately (MARKET, or marketable LIMIT order)
        const isImmediateFill =
          body.orderType === 'MARKET' ||
          (body.side === 'BUY' && (body.limitPriceCents ?? 0) >= asset.currentPriceCents) ||
          (body.side === 'SELL' && (body.limitPriceCents ?? Infinity) <= asset.currentPriceCents);

        const referencePriceCents = isImmediateFill
          ? asset.currentPriceCents
          : body.limitPriceCents!;

        const grossCents = body.quantity * referencePriceCents;
        const feeCents = calculateBrokerageFee(grossCents);

        if (isImmediateFill) {
          const clearingAccount = await getOrCreateSystemAccount(
            tx,
            'SYS-MARKET-CLEARING',
            currency
          );

          if (body.side === 'BUY') {
            const totalDebitCents = grossCents + feeCents;
            const receipt = await postLedgerTransaction(tx, {
              idempotencyKey,
              category: 'STOCK_BUY',
              description: `Stock Buy (${body.orderType}): ${body.quantity} ${asset.symbol} @ ${(referencePriceCents / 100).toFixed(2)} ${currency}`,
              metadata: {
                symbol: asset.symbol,
                side: 'BUY',
                orderType: body.orderType,
                quantity: body.quantity,
                executionPriceCents: referencePriceCents,
                feeCents,
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

            const [existingPos] = await tx
              .select()
              .from(portfolios)
              .where(and(eq(portfolios.userId, userId), eq(portfolios.symbol, asset.symbol)))
              .limit(1);

            const nextPos = calculatePortfolioAfterBuy({
              currentQuantity: existingPos?.quantity ?? 0,
              currentAvgPriceCents: existingPos?.averagePriceCents ?? 0,
              buyQuantity: body.quantity,
              executionPriceCents: referencePriceCents,
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
                userId,
                symbol: asset.symbol,
                quantity: nextPos.newQuantity,
                lockedQuantity: 0,
                averagePriceCents: nextPos.newAveragePriceCents,
                realizedPnlCents: 0,
              });
            }

            const [order] = await tx
              .insert(tradeOrders)
              .values({
                userId,
                symbol: asset.symbol,
                side: 'BUY',
                orderType: body.orderType,
                quantity: body.quantity,
                limitPriceCents: body.limitPriceCents ?? null,
                executedPriceCents: referencePriceCents,
                totalGrossCents: grossCents,
                feeCents,
                currency,
                status: 'FILLED',
                ledgerTransactionId: receipt.transactionId,
                executedAt: new Date(),
              })
              .returning();

            return {
              order: {
                ...order!,
                createdAt: order!.createdAt.toISOString(),
                executedAt: order!.executedAt?.toISOString() ?? null,
              },
              ledgerReceipt: receipt,
            };
          } else {
            // Immediate SELL fill
            const [existingPos] = await tx
              .select()
              .from(portfolios)
              .where(and(eq(portfolios.userId, userId), eq(portfolios.symbol, asset.symbol)))
              .limit(1);

            const availableShares = (existingPos?.quantity ?? 0) - (existingPos?.lockedQuantity ?? 0);
            if (!existingPos || availableShares < body.quantity) {
              throw new AppError(
                'INSUFFICIENT_SHARES',
                `Insufficient available shares of ${asset.symbol}. Available: ${availableShares}, Requested: ${body.quantity}.`,
                422
              );
            }

            const nextPos = calculatePortfolioAfterSell({
              currentQuantity: existingPos.quantity,
              currentAvgPriceCents: existingPos.averagePriceCents,
              currentRealizedPnlCents: existingPos.realizedPnlCents,
              sellQuantity: body.quantity,
              executionPriceCents: referencePriceCents,
              feeCents,
            });

            await tx
              .update(portfolios)
              .set({
                quantity: nextPos.newQuantity,
                averagePriceCents: nextPos.newAveragePriceCents,
                realizedPnlCents: nextPos.newTotalRealizedPnlCents,
                updatedAt: new Date(),
              })
              .where(eq(portfolios.id, existingPos.id));

            const netProceedsCents = Math.max(1, grossCents - feeCents);

            const receipt = await postLedgerTransaction(tx, {
              idempotencyKey,
              category: 'STOCK_SELL',
              description: `Stock Sell (${body.orderType}): ${body.quantity} ${asset.symbol} @ ${(referencePriceCents / 100).toFixed(2)} ${currency}`,
              metadata: {
                symbol: asset.symbol,
                side: 'SELL',
                orderType: body.orderType,
                quantity: body.quantity,
                executionPriceCents: referencePriceCents,
                feeCents,
                realizedPnlCents: nextPos.tradeRealizedPnlCents,
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

            const [order] = await tx
              .insert(tradeOrders)
              .values({
                userId,
                symbol: asset.symbol,
                side: 'SELL',
                orderType: body.orderType,
                quantity: body.quantity,
                limitPriceCents: body.limitPriceCents ?? null,
                executedPriceCents: referencePriceCents,
                totalGrossCents: grossCents,
                feeCents,
                currency,
                status: 'FILLED',
                ledgerTransactionId: receipt.transactionId,
                executedAt: new Date(),
              })
              .returning();

            return {
              order: {
                ...order!,
                createdAt: order!.createdAt.toISOString(),
                executedAt: order!.executedAt?.toISOString() ?? null,
              },
              ledgerReceipt: receipt,
            };
          }
        } else {
          // Non-marketable LIMIT Order -> Place in Order Book with Escrow Lock!
          if (body.side === 'BUY') {
            const requiredEscrowCents = grossCents + feeCents;
            const lockedRows = (await tx.execute(sql`
              SELECT balance_cents, locked_balance_cents
              FROM accounts
              WHERE id = ${userChecking.id}::uuid
              FOR UPDATE
            `)) as unknown as Array<{ balance_cents: number; locked_balance_cents: number }>;

            const row = lockedRows[0]!;
            const availableCents = Number(row.balance_cents) - Number(row.locked_balance_cents);
            if (availableCents < requiredEscrowCents) {
              throw new AppError(
                'INSUFFICIENT_FUNDS',
                `Insufficient available funds to lock Limit Buy escrow (${(requiredEscrowCents / 100).toFixed(2)} ${currency}).`,
                422
              );
            }

            await tx.execute(sql`
              UPDATE accounts
              SET locked_balance_cents = locked_balance_cents + ${requiredEscrowCents}
              WHERE id = ${userChecking.id}::uuid
            `);
          } else {
            // LIMIT SELL -> Lock shares in portfolio
            const [existingPos] = await tx
              .select()
              .from(portfolios)
              .where(and(eq(portfolios.userId, userId), eq(portfolios.symbol, asset.symbol)))
              .limit(1);

            const availableShares =
              (existingPos?.quantity ?? 0) - (existingPos?.lockedQuantity ?? 0);
            if (!existingPos || availableShares < body.quantity) {
              throw new AppError(
                'INSUFFICIENT_SHARES',
                `Insufficient available shares to place Limit Sell order. Available: ${availableShares}.`,
                422
              );
            }

            await tx
              .update(portfolios)
              .set({
                lockedQuantity: existingPos.lockedQuantity + body.quantity,
                updatedAt: new Date(),
              })
              .where(eq(portfolios.id, existingPos.id));
          }

          const [order] = await tx
            .insert(tradeOrders)
            .values({
              userId,
              symbol: asset.symbol,
              side: body.side,
              orderType: 'LIMIT',
              quantity: body.quantity,
              limitPriceCents: body.limitPriceCents!,
              executedPriceCents: null,
              totalGrossCents: grossCents,
              feeCents,
              currency,
              status: 'OPEN',
              ledgerTransactionId: null,
              executedAt: null,
            })
            .returning();

          return {
            order: {
              ...order!,
              createdAt: order!.createdAt.toISOString(),
              executedAt: null,
            },
            ledgerReceipt: null,
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
  });

  /**
   * POST /api/trading/orders/:orderId/cancel
   * Cancels an OPEN limit order and releases its locked cash escrow or locked shares.
   */
  app.post(
    '/api/trading/orders/:orderId/cancel',
    { preHandler: [requireAuth] },
    async (request) => {
      const userId = request.authUser!.id;
      const { orderId } = request.params as { orderId: string };

      return db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(tradeOrders)
          .where(and(eq(tradeOrders.id, orderId), eq(tradeOrders.userId, userId)))
          .limit(1);

        if (!order) {
          throw new AppError('NOT_FOUND', 'Trade order not found', 404);
        }

        if (order.status !== 'OPEN') {
          throw new AppError(
            'INVALID_ORDER_STATE',
            `Cannot cancel order in status "${order.status}".`,
            400
          );
        }

        if (order.side === 'BUY') {
          const lockedEscrow = order.totalGrossCents + order.feeCents;
          await tx.execute(sql`
            UPDATE accounts
            SET locked_balance_cents = GREATEST(0, locked_balance_cents - ${lockedEscrow})
            WHERE user_id = ${userId}::uuid
              AND currency = ${order.currency}
              AND account_type = 'CHECKING'
          `);
        } else {
          await tx.execute(sql`
            UPDATE portfolios
            SET locked_quantity = GREATEST(0, locked_quantity - ${order.quantity})
            WHERE user_id = ${userId}::uuid
              AND symbol = ${order.symbol}
          `);
        }

        const [cancelled] = await tx
          .update(tradeOrders)
          .set({ status: 'CANCELLED' })
          .where(eq(tradeOrders.id, order.id))
          .returning();

        return {
          order: {
            ...cancelled!,
            createdAt: cancelled!.createdAt.toISOString(),
            executedAt: null,
          },
        };
      });
    }
  );
}
