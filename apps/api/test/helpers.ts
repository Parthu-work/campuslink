import request from 'supertest';
import { Types } from 'mongoose';
import { generate } from 'otplib';
import type { Role, Capability } from '@campuslink/shared';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { createApp, type AppDeps } from '../src/app.js';
import { MemoryMailProvider } from '../src/lib/mailer.js';
import { runInTenant } from '../src/lib/context.js';
import { hashPassword } from '../src/lib/passwords.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';
import type { FieldCipher } from '../src/lib/crypto.js';
import { generateSecret } from 'otplib';

export const PASSWORD = 'Correct-Horse-Battery-Staple-42';
let cachedHash: Promise<string> | undefined;
const passwordHash = () => (cachedHash ??= hashPassword(PASSWORD));

export function testApp(overrides: Partial<AppDeps> = {}) {
  const env = loadEnv({
    NODE_ENV: 'test',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://*.localhost:5173',
    HIBP_ENABLED: 'false',
  });
  const mailer = new MemoryMailProvider();
  const app = createApp({
    env,
    logger: createLogger('silent'),
    readiness: {},
    mailer,
    rateLimitScale: 1000,
    ...overrides,
  });
  return {
    app,
    mailer: (overrides.mailer as MemoryMailProvider | undefined) ?? mailer,
    services: app.locals.services as { auth: AuthService; cipher: FieldCipher },
  };
}

export type TestTenant = { _id: Types.ObjectId; slug: string; host: string };

export async function makeTenant(
  slug: string,
  kind: 'college' | 'platform' = 'college',
): Promise<TestTenant> {
  const t = await TenantModel.create({
    slug,
    kind,
    branding: {
      displayName: `${slug.toUpperCase()} College of Engineering`,
      shortName: slug.toUpperCase(),
      primary: '#3fb8e6',
      secondary: '#6d5ae6',
      accent: '#f2b705',
      monogram: slug.slice(0, 2).toUpperCase(),
    },
  });
  return { _id: t._id, slug, host: `${slug}.localhost` };
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  tenant: TestTenant;
  mfaSecret?: string;
}

export async function makeUser(
  ctx: ReturnType<typeof testApp>,
  tenant: TestTenant,
  opts: {
    roles: Role[];
    email?: string;
    verified?: boolean;
    mfa?: boolean;
    capabilities?: Capability[];
    emailVerified?: boolean;
  },
): Promise<TestUser> {
  const email =
    opts.email ??
    `${opts.roles[0]!.toLowerCase()}-${new Types.ObjectId().toString().slice(-6)}@${tenant.slug}.example`;
  const mfaSecret = opts.mfa ? generateSecret() : undefined;
  return runInTenant(tenant._id, async () => {
    const user = await UserModel.create({
      email,
      name: 'Test Person',
      passwordHash: await passwordHash(),
      roles: opts.roles,
      capabilities: opts.capabilities ?? [],
      verified: opts.verified ?? true,
      emailVerifiedAt: opts.emailVerified === false ? null : new Date(),
      ageDeclaredAt: new Date(),
      ...(mfaSecret ? { mfa: { enabled: true, secretEnc: ctx.services.cipher.encrypt(mfaSecret) } } : {}),
    });
    const s = await ctx.services.auth.createSession(user._id, 0, { device: 'test' });
    return { id: String(user._id), email, token: s.accessToken, tenant, ...(mfaSecret ? { mfaSecret } : {}) };
  });
}

export const totp = (secret: string) => generate({ secret });

/** Supertest agent bound to a tenant host, optionally authenticated. */
export function api(ctx: ReturnType<typeof testApp>, host: string, token?: string) {
  const wrap = (r: request.Test) => {
    r.set('Host', host);
    if (token) r.set('Authorization', `Bearer ${token}`);
    return r;
  };
  const agent = request(ctx.app);
  return {
    get: (p: string) => wrap(agent.get(`/api/v1${p}`)),
    post: (p: string) => wrap(agent.post(`/api/v1${p}`)),
    patch: (p: string) => wrap(agent.patch(`/api/v1${p}`)),
    put: (p: string) => wrap(agent.put(`/api/v1${p}`)),
    delete: (p: string) => wrap(agent.delete(`/api/v1${p}`)),
  };
}

/** Extract cookies from a response into a Cookie header + the CSRF value. */
export function cookiesFrom(res: request.Response): { cookie: string; csrf: string } {
  const raw = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const pairs = raw.map((c) => c.split(';')[0]!).filter((c) => !c.endsWith('='));
  const csrf = pairs.find((p) => p.startsWith('cl_csrf='))?.split('=')[1] ?? '';
  return { cookie: pairs.join('; '), csrf };
}
