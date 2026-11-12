import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { env } from './config/env.js';
import { globalErrorHandler } from './core/errors.js';
import { authRoutes } from './modules/auth/routes.js';
import { accountRoutes } from './modules/accounts/routes.js';
import { transferRoutes } from './modules/transfers/routes.js';
import { savingsRoutes } from './modules/savings/routes.js';
import { fxRoutes } from './modules/fx/routes.js';
import { tradingRoutes } from './modules/trading/routes.js';

export async function buildApp(options?: { logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options?.logger ?? env.NODE_ENV === 'development',
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(cookie, {
    secret: env.JWT_SECRET,
  });

  app.setErrorHandler(globalErrorHandler);

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'aegis-fintech-api',
    timestamp: new Date().toISOString(),
  }));

  // Register Vertical Slice Feature Modules
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(transferRoutes);
  await app.register(savingsRoutes);
  await app.register(fxRoutes);
  await app.register(tradingRoutes);

  return app;
}
