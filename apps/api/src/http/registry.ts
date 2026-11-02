import { Router, type Request, type Response, type RequestHandler } from 'express';
import type { z } from 'zod';
import { type ZodType } from 'zod';
import { APP_NAME, ErrorCode, type Feature, type Permission, type ApiSuccess } from '@campuslink/shared';
import { AppError } from '../lib/errors.js';
import type { LimiterName } from './rate-limit.js';
import { featureGate, readOnlyGate } from '../modules/tenants/features.js';
import type { IdempotencyService } from '../modules/idempotency/idempotency.service.js';

export type Access =
  | { kind: 'public' }
  /** Any signed-in user of this tenant, including users who still must enrol in MFA. */
  | { kind: 'authenticated' }
  | { kind: 'permission'; permission: Permission };

export interface HandlerResult {
  status?: number;
  data: unknown;
  meta?: ApiSuccess<unknown>['meta'];
  /** Non-JSON response (file downloads). Headers are set verbatim. */
  raw?: { body: Buffer | string; headers: Record<string, string> };
  /** The handler wrote the response itself (server-sent events); routes with `stream: true` only. */
  streamed?: boolean;
}

export interface UploadSpec {
  field: string;
  maxBytes: number;
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
  /** The feature switch this route belongs to: 403 FEATURE_DISABLED while the college has it off. */
  feature?: Feature;
  body?: B;
  query?: Q;
  params?: P;
  limiter?: LimiterName;
  /** Cookie-authenticated endpoint: requires the double-submit CSRF token and an allowed Origin. */
  csrf?: boolean;
  /** multipart/form-data with one file; parsed only after authorization. Other form fields land in `body`. */
  upload?: UploadSpec;
  /** Accepts `Idempotency-Key` (signed-in routes with JSON bodies only). */
  idempotent?: boolean;
  /** Requires a bot-protection token (`X-Bot-Token`) when bot protection is enabled. */
  bot?: boolean;
  /** Answers with server-sent events written by the handler (errors before it starts stay JSON). */
  stream?: boolean;
  /**
   * A write that still works while the college is read-only for non-payment (B10): signing in and
   * out, a member's own account, consents and privacy rights, and paying. Every other write is
   * refused with `READ_ONLY`; reads never are.
   */
  readOnlyOk?: boolean;
  handler: (ctx: {
    req: Request;
    res: Response;
    body: z.output<B>;
    query: z.output<Q>;
    params: z.output<P>;
    file: Express.Multer.File | undefined;
  }) => Promise<HandlerResult>;
}

/** Every route of an app instance; used for OpenAPI and the generated permission matrix. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous route list; each spec is checked where it is declared
export type AnyRouteSpec = RouteSpec<any, any, any>;
export type RouteRegistry = { module: string; spec: AnyRouteSpec }[];

export interface PipelineDeps {
  registry: RouteRegistry;
  uploader: (spec: UploadSpec) => RequestHandler;
  limiters: Record<LimiterName, RequestHandler>;
  authenticate: RequestHandler;
  csrf: RequestHandler;
  bot: RequestHandler;
  idempotency: IdempotencyService;
}

const parse = <T extends ZodType>(schema: T | undefined, value: unknown): unknown =>
  schema ? schema.parse(value ?? {}) : {};

/**
 * Builds a module router. Order per route:
 * rate limit → tenant scope → feature switch → read-only (writes) → CSRF → authenticate → authorize →
 * validate → handler. (Authorization runs before validation so unauthorised callers learn nothing about payload shape;
 * see ADR 0006.)
 */
export function defineModule(module: string, specs: AnyRouteSpec[], deps: PipelineDeps): Router {
  const router = Router();
  for (const spec of specs) {
    deps.registry.push({ module, spec });
    const chain: RequestHandler[] = [];
    if (spec.limiter) chain.push(deps.limiters[spec.limiter]);
    chain.push(requireScope(spec.scope ?? 'college'));
    if (spec.feature) chain.push(featureGate(spec.feature));
    if (spec.method !== 'get' && !spec.readOnlyOk) chain.push(readOnlyGate);
    if (spec.csrf) chain.push(deps.csrf);
    if (spec.access.kind !== 'public') chain.push(deps.authenticate);
    if (spec.access.kind === 'permission') chain.push(authorize(spec.access.permission));
    if (spec.bot) chain.push(deps.bot);
    if (spec.upload) chain.push(deps.uploader(spec.upload));
    if (spec.idempotent && (spec.access.kind === 'public' || spec.upload || spec.stream))
      throw new Error(`${spec.method} ${spec.path}: idempotency needs a signed-in JSON route`);
    chain.push(async (req, res) => {
      const idem =
        spec.idempotent && req.auth
          ? await deps.idempotency.begin(
              req.auth.userId,
              req.get('idempotency-key'),
              `${spec.method} ${spec.path} ${JSON.stringify(req.params)}`,
              req.body,
            )
          : ({ kind: 'none' } as const);
      if (idem.kind === 'replay') {
        res.setHeader('Idempotent-Replayed', 'true');
        return void res.status(idem.status).json(idem.response);
      }
      const ctx = {
        req,
        res,
        body: parse(spec.body, req.body),
        query: parse(spec.query, req.query),
        params: parse(spec.params, req.params),
        file: req.file,
      };
      let result: HandlerResult;
      try {
        result = await spec.handler(ctx as never);
      } catch (e) {
        if (idem.kind === 'fresh') await idem.abort();
        throw e;
      }
      if (result.streamed) {
        if (!spec.stream)
          throw new Error(`${spec.method} ${spec.path}: only stream routes write their own response`);
        return;
      }
      if (idem.kind === 'fresh') {
        const envelope = { ok: true, data: result.data, ...(result.meta ? { meta: result.meta } : {}) };
        await idem.finish(result.status ?? 200, envelope);
      }
      if (result.raw) {
        for (const [k, v] of Object.entries(result.raw.headers)) res.setHeader(k, v);
        return void res.status(result.status ?? 200).send(result.raw.body);
      }
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
          `This address does not belong to a college on ${APP_NAME}`,
        ),
      );
    }
    if (t.status === 'suspended') {
      return next(
        new AppError(
          403,
          ErrorCode.TENANT_SUSPENDED,
          `This college’s ${APP_NAME} is paused. Contact your college administrator.`,
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
