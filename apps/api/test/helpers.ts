import request from 'supertest';
import { Types } from 'mongoose';
import { generate } from 'otplib';
import { LEGACY_FEATURES, type Role, type Capability, type Feature } from '@campuslink/shared';
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
import { MemoryStorage } from '../src/lib/storage.js';
import { InlineJobQueue } from '../src/lib/jobs.js';
import type { ImportsService } from '../src/modules/imports/imports.service.js';
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
  const storage = new MemoryStorage();
  const queue = new InlineJobQueue();
  const app = createApp({
    env,
    logger: createLogger('silent'),
    readiness: {},
    mailer,
    storage,
    jobs: queue,
    rateLimitScale: 1000,
    ...overrides,
  });
  return {
    app,
    mailer: (overrides.mailer as MemoryMailProvider | undefined) ?? mailer,
    storage,
    queue,
    services: app.locals.services as { auth: AuthService; cipher: FieldCipher; imports: ImportsService },
  };
}

export type TestTenant = { _id: Types.ObjectId; slug: string; host: string };

export async function makeTenant(
  slug: string,
  kind: 'college' | 'platform' = 'college',
  features: Partial<Record<Feature, boolean>> = {},
): Promise<TestTenant> {
  const t = await TenantModel.create({
    slug,
    kind,
    // Tests start with every module on, as colleges had before the switches (B1); feature tests
    // switch them off explicitly.
    features: { ...LEGACY_FEATURES, ...features },
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
    await ctx.services.auth.onUserCreated?.(String(user._id));
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

/** Last 6-digit code emailed to `to`. */
export const codeFrom = (ctx: ReturnType<typeof testApp>, to: string) =>
  /\b(\d{6})\b/.exec(ctx.mailer.lastTo(to)?.subject ?? '')?.[1] ?? '';

/** Tiny real images for upload tests. */
export async function jpegWithExif(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 40, height: 30, channels: 3, background: '#3fb8e6' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'SECRET-EXIF-MARKER', Make: 'TestCam' } })
    .toBuffer();
}

/** Minimal valid .xlsx (inline strings) built in memory. */
export async function makeXlsx(rows: string[][]): Promise<Buffer> {
  const { zipSync, strToU8 } = await import('fflate');
  const col = (i: number) => String.fromCharCode(65 + i);
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`,
    )
    .join('')}</sheetData></worksheet>`;
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      'xl/workbook.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    }),
  );
}

export const SAMPLE_CSV = [
  'Roll No,Student Name,Department,Batch,Email,Mobile',
  '21DP1A0501,Ananya Kumari,CSE,2025,ananya.k@dpit.ac.in,9848022338',
  '21DP1A0502,Bharath Reddy,ECE,2025,,9123456780',
  '17DP1A0301,Chaitanya Rao,Mechanical,2021,chaitanya@example.com,',
  '17DP1A0302,Deepika Naidu,CSE,2021,deepika@example.com,',
  ',Missing Roll,CSE,2025,,',
  '21DP1A0501,Duplicate Row,CSE,2025,,',
  '21DP1A0599,Bad Email,IT,2025,not-an-email,',
].join('\n');
