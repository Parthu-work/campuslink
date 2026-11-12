import { describe, expect, it } from 'vitest';
import { APP_NAME } from '@campuslink/shared';
import { api, testApp, totp } from './helpers.js';
import { runInTenant, withPlatformScope } from '../src/lib/context.js';
import { sha256 } from '../src/lib/crypto.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { AuthTokenModel } from '../src/modules/auth/auth-token.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import type { PlatformService } from '../src/modules/platform/platform.service.js';
import { assertMayRun, parseArgs } from '../src/scripts/platform-bootstrap.js';

/** Prompt 4, P1: `platform:bootstrap`, the way into a fresh production database. */
const ctx = testApp();
const platform = (ctx.app.locals.services as { platform: PlatformService }).platform;
const EMAIL = 'owner@platform-bootstrap.example';
const PASSWORD = 'Tidal-Granite-Lantern-Orchard-58';
const HOST = 'admin.localhost';
const tokenOf = (url: string) => new URL(url).searchParams.get('token') ?? '';
const superAdmins = () =>
  withPlatformScope('test:bootstrap', () => UserModel.countDocuments({ roles: 'SUPER_ADMIN' }));

describe('the command line', () => {
  it('needs an email and a name, and never takes a password', () => {
    expect(parseArgs(['--email', EMAIL, '--name', 'Owner'])).toEqual({
      email: EMAIL,
      name: 'Owner',
      allowDev: false,
      reissue: false,
    });
    expect(() => parseArgs(['--name', 'Owner'])).toThrow(/--email is required/);
    expect(() => parseArgs(['--email', EMAIL])).toThrow(/--name is required/);
    expect(() => parseArgs(['--email', EMAIL, '--name', 'Owner', '--password', 'x'])).toThrow(
      /No password is taken/,
    );
    expect(() => parseArgs(['--email', EMAIL, '--name', 'Owner', '--force'])).toThrow(/Unknown option/);
  });

  it('runs in production, and outside it only with --allow-dev', () => {
    expect(() => assertMayRun('production', false)).not.toThrow();
    expect(() => assertMayRun('development', false)).toThrow(/is for production/);
    expect(() => assertMayRun('test', false)).toThrow(/is for production/);
    expect(() => assertMayRun('development', true)).not.toThrow();
  });
});

describe('platform bootstrap (prompt 4, P1)', () => {
  let firstUrl = '';

  it('refuses a bad email or name before writing anything', async () => {
    await expect(platform.bootstrap({ email: 'not-an-email', name: 'Owner' })).rejects.toThrow(/valid email/);
    await expect(platform.bootstrap({ email: EMAIL, name: ' ' })).rejects.toThrow(/2 to 100/);
    expect(await TenantModel.countDocuments({ kind: 'platform' })).toBe(0);
  });

  it('creates the platform tenant and one super admin, and returns a 30-minute link with a hashed token', async () => {
    const r = await platform.bootstrap({ email: ` ${EMAIL.toUpperCase()} `, name: 'Platform Owner' });
    firstUrl = r.setupUrl;
    expect(r).toMatchObject({ createdTenant: true, reissued: false, expiresInMinutes: 30 });
    const tenant = await TenantModel.findOne({ kind: 'platform' }).lean();
    expect(tenant).toMatchObject({ slug: 'admin', branding: { displayName: `${APP_NAME} Platform` } });
    expect(new URL(r.setupUrl).hostname.startsWith('admin.')).toBe(true);
    expect(new URL(r.setupUrl).pathname).toBe('/reset-password');
    expect(await superAdmins()).toBe(1);
    await runInTenant(tenant!._id, async () => {
      const user = await UserModel.findOne({ email: EMAIL }).select('+passwordHash').lean();
      expect(user).toMatchObject({ roles: ['SUPER_ADMIN'], name: 'Platform Owner', verified: true });
      expect(user?.mfa?.enabled ?? false).toBe(false);
      // Only the hash of the token is stored, and it expires within 30 minutes.
      const tokens = await AuthTokenModel.find({ userId: user!._id }).lean();
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.tokenHash).toBe(sha256(tokenOf(r.setupUrl)));
      expect(JSON.stringify(tokens)).not.toContain(tokenOf(r.setupUrl));
      const ttl = tokens[0]!.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(29 * 60_000);
      expect(ttl).toBeLessThanOrEqual(30 * 60_000);
      // The audit row names the account by id, never by email or name.
      const rows = await AuditModel.find({ action: 'platform.bootstrap' }).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ targetType: 'user', targetId: String(user!._id) });
      expect(JSON.stringify(rows)).not.toContain(EMAIL);
      expect(JSON.stringify(rows)).not.toContain('Platform Owner');
    });
    // Nothing was mailed: the link exists only in the command's output.
    expect(ctx.mailer.lastTo(EMAIL)).toBeUndefined();
  });

  it('refuses a second run, with the same or another email', async () => {
    await expect(platform.bootstrap({ email: EMAIL, name: 'Platform Owner' })).rejects.toThrow(
      /already exists/,
    );
    await expect(
      platform.bootstrap({ email: 'second@platform-bootstrap.example', name: 'Second' }),
    ).rejects.toThrow(/already exists/);
    expect(await superAdmins()).toBe(1);
    expect(await TenantModel.countDocuments({ kind: 'platform' })).toBe(1);
  });

  it('--reissue gives the unused account a new link, and nobody else', async () => {
    await expect(
      platform.bootstrap({ email: 'second@platform-bootstrap.example', name: 'Second', reissue: true }),
    ).rejects.toThrow(/already exists/);
    const r = await platform.bootstrap({ email: EMAIL, name: 'Platform Owner', reissue: true });
    expect(r).toMatchObject({ reissued: true, createdTenant: false });
    expect(tokenOf(r.setupUrl)).not.toBe(tokenOf(firstUrl));
    expect(await superAdmins()).toBe(1);
  });

  it('an expired link does nothing', async () => {
    const tenant = await TenantModel.findOne({ kind: 'platform' }).lean();
    await runInTenant(tenant!._id, () =>
      AuthTokenModel.updateOne(
        { tokenHash: sha256(tokenOf(firstUrl)) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      ),
    );
    const res = await api(ctx, HOST)
      .post('/auth/password/reset')
      .send({ token: tokenOf(firstUrl), password: PASSWORD });
    expect(res.status).toBe(400);
    const login = await api(ctx, HOST).post('/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it('the link sets the password once; a second use is refused', async () => {
    const { setupUrl } = await platform.bootstrap({ email: EMAIL, name: 'Platform Owner', reissue: true });
    const first = await api(ctx, HOST)
      .post('/auth/password/reset')
      .send({ token: tokenOf(setupUrl), password: PASSWORD });
    expect(first.status).toBe(200);
    const again = await api(ctx, HOST)
      .post('/auth/password/reset')
      .send({ token: tokenOf(setupUrl), password: `${PASSWORD}-again` });
    expect(again.status).toBe(400);
  });

  it('the first sign-in has no permission until two-factor is on', async () => {
    const login = await api(ctx, HOST).post('/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.mfaRequired).toBe(false);
    const token = login.body.data.session.accessToken as string;
    const me = await api(ctx, HOST, token).get('/me');
    expect(me.body.data.permissions).toEqual([]);
    expect((await api(ctx, HOST, token).get('/platform/tenants')).status).toBe(403);
    // Once the account has signed in, a new link is no longer printed.
    await expect(platform.bootstrap({ email: EMAIL, name: 'Platform Owner', reissue: true })).rejects.toThrow(
      /already exists/,
    );

    // Enrol, then the platform console opens.
    const setup = await api(ctx, HOST, token).post('/auth/mfa/setup').send({});
    expect(setup.status).toBe(200);
    const secret = setup.body.data.secret as string;
    const enable = await api(ctx, HOST, token)
      .post('/auth/mfa/enable')
      .send({ code: await totp(secret) });
    expect(enable.status).toBe(200);
    const fresh = (enable.body.data?.accessToken as string | undefined) ?? token;
    const list = await api(ctx, HOST, fresh).get('/platform/tenants');
    expect(list.status).toBe(200);
  });
});
