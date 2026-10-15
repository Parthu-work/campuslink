import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { API_PREFIX } from '@campuslink/shared';
import type { Env } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { requestId } from './middleware/request-id.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter, type ReadinessCheck } from './modules/health/health.routes.js';

export interface AppDeps {
  env: Env;
  logger: Logger;
  readiness: Record<string, ReadinessCheck>;
}

export function createApp({ env, logger, readiness }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
  app.set('query parser', 'simple');

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => String(req.id), autoLogging: env.NODE_ENV !== 'test' }));
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: env.NODE_ENV === 'production',
    }),
  );
  app.use(corsMiddleware(env.CORS_ALLOWED_ORIGINS));
  app.use(express.json({ limit: '100kb', strict: true }));

  app.use(API_PREFIX, healthRouter(readiness));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
