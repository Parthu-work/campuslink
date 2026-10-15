import { rateLimit, ipKeyGenerator, type Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { Redis } from 'ioredis';
import type { RequestHandler, Request } from 'express';
import { ErrorCode } from '@campuslink/shared';

export type LimiterName =
  | 'global'
  | 'login'
  | 'mfa'
  | 'signup'
  | 'emailAction'
  | 'refresh'
  | 'adminWrite'
  | 'verify'
  | 'search'
  | 'upload'
  | 'requests'
  | 'messages'
  | 'reports'
  | 'push';

const RULES: Record<LimiterName, { windowMs: number; limit: number; perUser?: boolean }> = {
  global: { windowMs: 60_000, limit: 600 },
  login: { windowMs: 15 * 60_000, limit: 10 },
  mfa: { windowMs: 15 * 60_000, limit: 10 },
  signup: { windowMs: 60 * 60_000, limit: 10 },
  emailAction: { windowMs: 60 * 60_000, limit: 5 },
  refresh: { windowMs: 15 * 60_000, limit: 120 },
  adminWrite: { windowMs: 60_000, limit: 60, perUser: true },
  verify: { windowMs: 60 * 60_000, limit: 10, perUser: true },
  search: { windowMs: 60_000, limit: 60, perUser: true },
  upload: { windowMs: 60 * 60_000, limit: 20, perUser: true },
  requests: { windowMs: 60 * 60_000, limit: 10, perUser: true },
  messages: { windowMs: 60_000, limit: 30, perUser: true },
  reports: { windowMs: 60 * 60_000, limit: 20, perUser: true },
  push: { windowMs: 60 * 60_000, limit: 20, perUser: true },
};

const key = (req: Request, perUser?: boolean) =>
  `${req.tenant?.slug ?? '-'}:${perUser && req.auth ? 'u:' + req.auth.userId : ipKeyGenerator(req.ip ?? '0.0.0.0')}`;

/** Redis-backed in dev/prod (shared across instances); in-memory when no Redis (unit tests). */
export function createLimiters(redis: Redis | undefined, scale = 1): Record<LimiterName, RequestHandler> {
  const make = (name: LimiterName): RequestHandler => {
    const rule = RULES[name];
    const store: Store | undefined = redis
      ? new RedisStore({
          prefix: `rl:${name}:`,
          sendCommand: (command: string, ...args: string[]) =>
            redis.call(command, ...args) as Promise<RedisReply>,
        })
      : undefined;
    return rateLimit({
      windowMs: rule.windowMs,
      limit: Math.max(1, Math.round(rule.limit * scale)),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => key(req, rule.perUser),
      ...(store ? { store } : {}),
      handler: (req, res) =>
        res.status(429).json({
          ok: false,
          error: {
            code: ErrorCode.RATE_LIMITED,
            message: 'Too many requests. Please wait a moment and try again.',
            requestId: String(req.id),
          },
        }),
    });
  };
  return Object.fromEntries((Object.keys(RULES) as LimiterName[]).map((n) => [n, make(n)])) as Record<
    LimiterName,
    RequestHandler
  >;
}
