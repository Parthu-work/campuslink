import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createApp } from './app.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);

mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);

const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });

async function main() {
  await Promise.all([mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 }), redis.connect()]);
  logger.info('connected to MongoDB and Redis');

  const app = createApp({
    env,
    logger,
    readiness: {
      mongo: async () => mongoose.connection.readyState === 1,
      redis: async () => (await redis.ping()) === 'PONG',
    },
  });

  const server = app.listen(env.API_PORT, () => logger.info({ port: env.API_PORT }, 'api listening'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await Promise.allSettled([mongoose.disconnect(), redis.quit()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
