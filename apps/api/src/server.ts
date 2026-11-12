import { env } from './config/env.js';
import { buildApp } from './app.js';
import { seedDatabase } from './db/seed.js';
import { startMarketTicker } from './modules/market/engine.js';

async function bootstrap() {
  await seedDatabase();
  const app = await buildApp({ logger: true });

  startMarketTicker(env.MARKET_TICK_INTERVAL_MS);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`🚀 Aegis FinTech API running on http://localhost:${env.PORT}`);
}

bootstrap().catch((err) => {
  console.error('❌ Failed to start Aegis FinTech API:', err);
  process.exit(1);
});
