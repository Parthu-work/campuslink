import { Router, type Request, type Response, type RequestHandler } from 'express';
import type { z } from 'zod';
import { type ZodType } from 'zod';
import { ErrorCode, type Permission, type ApiSuccess } from '@campuslink/shared';
import { AppError } from '../lib/errors.js';
import type { LimiterName } from './rate-limit.js';

export type Access =
  | { kind: 'public' }
  /** Any signed-in user of this tenant, including users who still must enrol in MFA. */
  | { kind: 'authenticated' }
  | { kind: 'permission'; permission: Permission };

export interface HandlerResult {
  status?: number;
  data: unknown;
  meta?: ApiSuccess<unknown>['meta'];
}

export interface RouteSpec<
  B extends ZodType = ZodType,
  Q extends ZodType = ZodType,
  P extends ZodType = ZodType,
> {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  tag: string;
  access: Access;
  /** Which kind of tenant host serves this route. Default: college. */
  scope?: 'college' | 'platform' | 'any';
  body?: B;
  query?: Q;
  params?: P;
  limiter?: LimiterName;
  /** Cookie-authenticated endpoint: requires the double-submit CSRF token and an allowed Origin. */
  csrf?: boolean;
  handler: (ctx: {
    req: Request;
    res: Response;
    body: z.output<B>;
    query: z.output<Q>;
    params: z.output<P>;
  }) => Promise<HandlerResult>;
}

/** Every route of an app instance; used for OpenAPI and the generated permission matrix. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous route list; each spec is checked where it is declared
export type AnyRouteSpec = RouteSpec<any, any, any>;
export type RouteRegistry = { module: string; spec: AnyRouteSpec }[];

export interface PipelineDeps {
  registry: RouteRegistry;
  limiters: Record<LimiterName, RequestHandler>;
  authenticate: RequestHandler;
  csrf: RequestHandler;
}

const parse = <T extends ZodType>(schema: T | undefined, value: unknown): unknown =>
  schema ? schema.parse(value ?? {}) : {};

/**
 * Builds a module router. Order per route:
 * rate limit → tenant scope → CSRF → authenticate → authorize → validate → handler.
 * (Authorization runs before validation so unauthorised callers learn nothing about payload shape;
 * see ADR 0006.)
 */
export function defineModule(module: string, specs: AnyRouteSpec[], deps: PipelineDeps): Router {
  const router = Router();
  for (const spec of specs) {
    deps.registry.push({ module, spec });
    const chain: RequestHandler[] = [];
    if (spec.limiter) chain.push(deps.limiters[spec.limiter]);
    chain.push(requireScope(spec.scope ?? 'college'));
    if (spec.csrf) chain.push(deps.csrf);
    if (spec.access.kind !== 'public') chain.push(deps.authenticate);
    if (spec.access.kind === 'permission') chain.push(authorize(spec.access.permission));
    chain.push(async (req, res) => {
      const ctx = {
        req,
        res,
        body: parse(spec.body, req.body),
        query: parse(spec.query, req.query),
        params: parse(spec.params, req.params),
      };
      const result = await spec.handler(ctx as never);
      if (result.status === 204) return void res.status(204).end();
      res
        .status(result.status ?? 200)
        .json({ ok: true, data: result.data, ...(result.meta ? { meta: result.meta } : {}) });
    });
    router[spec.method](spec.path, ...chain);
  }
  return router;
}

export function requireScope(scope: 'college' | 'platform' | 'any'): RequestHandler {
  return (req, _res, next) => {
    const t = req.tenant;
    if (!t || (scope !== 'any' && t.kind !== scope)) {
      return next(
        new AppError(
          404,
          ErrorCode.UNKNOWN_TENANT,
          'This address does not belong to a college on CampusLink',
        ),
      );
    }
    if (t.status === 'suspended') {
      return next(
        new AppError(
          403,
          ErrorCode.TENANT_SUSPENDED,
          'This college’s CampusLink is paused. Contact your college administrator.',
        ),
      );
    }
    next();
  };
}

export function authorize(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (auth?.permissions.has(permission)) return next();
    if (auth?.mfaPending)
      return next(new AppError(403, ErrorCode.MFA_REQUIRED, 'Set up two-factor authentication to continue'));
    next(new AppError(403, ErrorCode.FORBIDDEN, 'You do not have permission to do that'));
  };
}
