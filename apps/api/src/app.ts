import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Redis } from 'ioredis';
import { API_PREFIX } from '@campuslink/shared';
import type { Env } from './config/env.js';
import type { Logger } from './lib/logger.js';
import { requestId } from './middleware/request-id.js';
import { rejectOperatorKeys } from './middleware/no-operators.js';
import { corsMiddleware, buildOriginMatcher } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter, type ReadinessCheck } from './modules/health/health.routes.js';
import { tenantResolver } from './http/tenant.middleware.js';
import { createLimiters } from './http/rate-limit.js';
import { authenticate, csrfProtection } from './http/auth.middleware.js';
import { defineModule, type RouteRegistry, type PipelineDeps } from './http/registry.js';
import { buildOpenApi } from './http/openapi.js';
import { TokenService } from './lib/jwt.js';
import { FieldCipher } from './lib/crypto.js';
import type { MailProvider } from './lib/mailer.js';
import { AuthService } from './modules/auth/auth.service.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { UsersService } from './modules/users/users.service.js';
import { meRoutes, adminUserRoutes } from './modules/users/users.routes.js';
import { tenantRoutes } from './modules/tenants/tenants.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { PlatformService } from './modules/platform/platform.service.js';
import { platformRoutes } from './modules/platform/platform.routes.js';

export interface AppDeps {
  env: Env;
  logger: Logger;
  readiness: Record<string, ReadinessCheck>;
  mailer: MailProvider;
  redis?: Redis | undefined;
  /** Multiplies every rate limit (tests use a large value except where limits are under test). */
  rateLimitScale?: number;
  fetchImpl?: typeof fetch;
}

export function createApp({ env, logger, readiness, mailer, redis, rateLimitScale = 1, fetchImpl }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.set('query parser', 'simple');

  const isAllowedOrigin = buildOriginMatcher(env.CORS_ALLOWED_ORIGINS);
  const tokens = new TokenService(env.JWT_ACCESS_SECRET, env.JWT_TICKET_SECRET, env.JWT_ACCESS_TTL_SECONDS);
  const cipher = new FieldCipher(env.FIELD_ENCRYPTION_KEY);
  const limiters = createLimiters(redis, rateLimitScale);
  const registry: RouteRegistry = [];
  const pipeline: PipelineDeps = {
    registry,
    limiters,
    authenticate: authenticate(tokens),
    csrf: csrfProtection(isAllowedOrigin),
  };

  const authService = new AuthService({
    tokens,
    mailer,
    cipher,
    logger,
    webOrigin: env.WEB_ORIGIN,
    refreshTtlSec: env.JWT_REFRESH_TTL_SECONDS,
    hibpEnabled: env.HIBP_ENABLED,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const usersService = new UsersService(authService);
  const platformService = new PlatformService(authService);
  const cookie = {
    secure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    refreshTtlSec: env.JWT_REFRESH_TTL_SECONDS,
  };

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => String(req.id), autoLogging: env.NODE_ENV !== 'test' }));
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: env.NODE_ENV === 'production',
    }),
  );
  app.use(corsMiddleware(env.CORS_ALLOWED_ORIGINS));
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(rejectOperatorKeys);
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(API_PREFIX, healthRouter(readiness));
  app.use(API_PREFIX, limiters.global, tenantResolver(env.APP_ROOT_DOMAIN));
  app.use(API_PREFIX, defineModule('tenants', tenantRoutes(), pipeline));
  app.use(API_PREFIX, defineModule('auth', authRoutes(authService, cookie), pipeline));
  app.use(
    API_PREFIX,
    defineModule('users', [...meRoutes(usersService), ...adminUserRoutes(usersService)], pipeline),
  );
  app.use(API_PREFIX, defineModule('audit', auditRoutes(), pipeline));
  app.use(API_PREFIX, defineModule('platform', platformRoutes(platformService, readiness), pipeline));

  const openapi = buildOpenApi(registry);
  app.get(`${API_PREFIX}/openapi.json`, (_req, res) => res.json(openapi));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  app.locals.registry = registry;
  app.locals.services = { auth: authService, users: usersService, platform: platformService, tokens, cipher };
  return app;
}
