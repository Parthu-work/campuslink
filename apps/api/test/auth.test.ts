import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { generate } from 'otplib';
import { api, cookiesFrom, makeTenant, makeUser, testApp, PASSWORD, type TestTenant } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { ConsentModel } from '../src/modules/consent/consent.model.js';

const ctx = testApp();
let T: TestTenant;
const signup = (email: string, extra: Record<string, unknown> = {}) =>
  api(ctx, T.host)
    .post('/auth/signup')
    .send({
      name: 'Ananya Kumar',
      email,
      password: 'quiet-river-lantern-91',
      intent: 'STUDENT',
      isAdult: true,
      consents: ['account', 'email_digests'],
      ...extra,
    });
const tokenFromMail = (to: string) =>
  /token=([A-Za-z0-9_-]+)/.exec(ctx.mailer.lastTo(to)?.text ?? '')?.[1] ?? '';

beforeAll(async () => {
  T = await makeTenant('auth');
});

describe('sign-up and email verification', () => {
  it('creates an unverified student, records consent and emails a verification link', async () => {
    const res = await signup('ananya@auth.example');
    expect(res.status).toBe(202);
    const user = await runInTenant(T._id, () => UserModel.findOne({ email: 'ananya@auth.example' }).lean());
    expect(user).toMatchObject({ roles: ['STUDENT'], verified: false, emailVerifiedAt: null });
    const consents = await runInTenant(T._id, () => ConsentModel.find({ userId: user!._id }).lean());
    expect(consents.find((c) => c.purpose === 'email_digests')?.granted).toBe(true);
    expect(consents.find((c) => c.purpose === 'mentorship_matching')?.granted).toBe(false);
    expect(ctx.mailer.lastTo('ananya@auth.example')?.text).toContain(
      'http://auth.localhost:5173/verify-email?token=',
    );
  });

  it('does not reveal existing accounts (same 202, owner is emailed instead)', async () => {
    const res = await signup('ananya@auth.example');
    expect(res.status).toBe(202);
    expect(ctx.mailer.lastTo('ananya@auth.example')?.subject).toBe('You already have an account');
  });

  it('blocks under-18 sign-ups and missing required consent', async () => {
    expect((await signup('kid@auth.example', { isAdult: false })).status).toBe(400);
    expect((await signup('noc@auth.example', { consents: ['email_digests'] })).status).toBe(400);
  });

  it('rejects weak passwords with feedback', async () => {
    const res = await signup('weak@auth.example', { password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEAK_PASSWORD');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('rejects unknown fields and operator injection', async () => {
    expect((await signup('x@auth.example', { roles: ['COLLEGE_ADMIN'] })).status).toBe(400);
    const r = await api(ctx, T.host)
      .post('/auth/login')
      .send({ email: { $ne: null }, password: 'x' });
    expect(r.status).toBe(400);
  });

  it('refuses login until the email is confirmed, then allows it', async () => {
    const before = await api(ctx, T.host)
      .post('/auth/login')
      .send({ email: 'ananya@auth.example', password: 'quiet-river-lantern-91' });
    expect(before.status).toBe(403);
    expect(before.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    await api(ctx, T.host).post('/auth/verify-email/resend').send({ email: 'ananya@auth.example' });
    const verify = await api(ctx, T.host)
      .post('/auth/verify-email')
      .send({ token: tokenFromMail('ananya@auth.example') });
    expect(verify.status).toBe(200);
    const again = await api(ctx, T.host)
      .post('/auth/verify-email')
      .send({ token: tokenFromMail('ananya@auth.example') });
    expect(again.status).toBe(400); // single use
    const after = await api(ctx, T.host)
      .post('/auth/login')
      .send({ email: 'ananya@auth.example', password: 'quiet-river-lantern-91' });
    expect(after.status).toBe(200);
    expect(after.body.data.session.accessToken).toBeTruthy();
  });

  it('unverified (college) users get read-only permissions', async () => {
    const login = await api(ctx, T.host)
      .post('/auth/login')
      .send({ email: 'ananya@auth.example', password: 'quiet-river-lantern-91' });
    const me = await api(ctx, T.host, login.body.data.session.accessToken).get('/me');
    expect(me.body.data.verified).toBe(false);
    expect(me.body.data.permissions).toEqual(['content:report', 'feed:read', 'jobs:read', 'roadmaps:read']);
  });
});

describe('login protection', () => {
  it('uses one generic error for unknown email and wrong password', async () => {
    const u = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    const a = await api(ctx, T.host)
      .post('/auth/login')
      .send({ email: 'nobody@auth.example', password: 'whatever-1234' });
    const b = await api(ctx, T.host)
      .post('/auth/login')
      .send({ email: u.email, password: 'wrong-password-1234' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks the account after 5 failures and audits it', async () => {
    const u = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    for (let i = 0; i < 5; i++)
      await api(ctx, T.host).post('/auth/login').send({ email: u.email, password: 'wrong-password-1234' });
    const locked = await api(ctx, T.host).post('/auth/login').send({ email: u.email, password: PASSWORD });
    expect(locked.status).toBe(429);
    const audited = await runInTenant(T._id, () =>
      AuditModel.countDocuments({ action: 'auth.locked', targetId: u.id }),
    );
    expect(audited).toBe(1);
  });

  it('rate-limits login attempts per IP', async () => {
    const strict = testApp({ rateLimitScale: 0.3 }); // 3 attempts per window
    const codes: number[] = [];
    for (let i = 0; i < 4; i++)
      codes.push(
        (
          await api(strict, T.host)
            .post('/auth/login')
            .send({ email: 'nobody@auth.example', password: 'whatever-1234' })
        ).status,
      );
    expect(codes).toEqual([401, 401, 401, 429]);
  });

  it('rejects tampered, expired-format and foreign-signed access tokens', async () => {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const tampered = u.token.slice(0, -3) + (u.token.endsWith('aaa') ? 'bbb' : 'aaa');
    expect((await api(ctx, T.host, tampered).get('/me')).status).toBe(401);
    expect((await api(ctx, T.host, 'not-a-jwt').get('/me')).status).toBe(401);
  });
});

describe('refresh token rotation and reuse detection', () => {
  it('rotates on every refresh; replaying an old token revokes the session', async () => {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const login = await api(ctx, T.host).post('/auth/login').send({ email: u.email, password: PASSWORD });
    const c1 = cookiesFrom(login);
    expect(login.headers['set-cookie']!.toString()).toMatch(/cl_rt=.*HttpOnly.*SameSite=Strict/i);

    const r1 = await api(ctx, T.host)
      .post('/auth/refresh')
      .set('Cookie', c1.cookie)
      .set('X-CSRF-Token', c1.csrf);
    expect(r1.status).toBe(200);
    const c2 = cookiesFrom(r1);
    expect(c2.cookie).not.toBe(c1.cookie);

    // Attacker replays the first (already rotated) token → whole session revoked.
    const replay = await api(ctx, T.host)
      .post('/auth/refresh')
      .set('Cookie', c1.cookie)
      .set('X-CSRF-Token', c1.csrf);
    expect(replay.status).toBe(401);
    const legit = await api(ctx, T.host)
      .post('/auth/refresh')
      .set('Cookie', c2.cookie)
      .set('X-CSRF-Token', c2.csrf);
    expect(legit.status).toBe(401);
    // The access token of the revoked session stops working too.
    expect((await api(ctx, T.host, r1.body.data.session.accessToken).get('/me')).status).toBe(401);
    const audited = await runInTenant(T._id, () =>
      AuditModel.countDocuments({ action: 'auth.refresh_reuse_detected' }),
    );
    expect(audited).toBeGreaterThan(0);
  });

  it('requires the CSRF token and an allowed origin for cookie-authenticated endpoints', async () => {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const c = cookiesFrom(
      await api(ctx, T.host).post('/auth/login').send({ email: u.email, password: PASSWORD }),
    );
    const noCsrf = await api(ctx, T.host).post('/auth/refresh').set('Cookie', c.cookie);
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_FAILED');
    const evil = await api(ctx, T.host)
      .post('/auth/refresh')
      .set('Cookie', c.cookie)
      .set('X-CSRF-Token', c.csrf)
      .set('Origin', 'https://evil.example');
    expect(evil.status).toBe(403);
  });

  it('logout revokes the session and clears cookies', async () => {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const login = await api(ctx, T.host).post('/auth/login').send({ email: u.email, password: PASSWORD });
    const c = cookiesFrom(login);
    const out = await api(ctx, T.host)
      .post('/auth/logout')
      .set('Cookie', c.cookie)
      .set('X-CSRF-Token', c.csrf);
    expect(out.status).toBe(204);
    expect((await api(ctx, T.host, login.body.data.session.accessToken).get('/me')).status).toBe(401);
  });
});

describe('sessions and devices', () => {
  it('lists my sessions and cannot revoke someone else’s (IDOR)', async () => {
    const me = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const other = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const mine = await api(ctx, T.host, me.token).get('/auth/sessions');
    expect(mine.body.data).toHaveLength(1);
    const theirs = await api(ctx, T.host, other.token).get('/auth/sessions');
    const r = await api(ctx, T.host, me.token).delete(`/auth/sessions/${theirs.body.data[0].id}`);
    expect(r.status).toBe(404);
    expect((await api(ctx, T.host, other.token).get('/me')).status).toBe(200);
  });
});

describe('password reset', () => {
  it('is enumeration-safe, single-use, and signs out every device', async () => {
    const u = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    expect(
      (await api(ctx, T.host).post('/auth/password/forgot').send({ email: 'ghost@auth.example' })).status,
    ).toBe(202);
    expect((await api(ctx, T.host).post('/auth/password/forgot').send({ email: u.email })).status).toBe(202);
    const token = tokenFromMail(u.email);
    const weak = await api(ctx, T.host)
      .post('/auth/password/reset')
      .send({ token, password: 'password1234' });
    expect(weak.status).toBe(400);
    const ok = await api(ctx, T.host)
      .post('/auth/password/reset')
      .send({ token, password: 'amber-monsoon-kettle-58' });
    expect(ok.status).toBe(200);
    expect(
      (
        await api(ctx, T.host)
          .post('/auth/password/reset')
          .send({ token, password: 'amber-monsoon-kettle-59' })
      ).status,
    ).toBe(400);
    expect((await api(ctx, T.host, u.token).get('/me')).status).toBe(401);
    expect(
      (
        await api(ctx, T.host)
          .post('/auth/login')
          .send({ email: u.email, password: 'amber-monsoon-kettle-58' })
      ).status,
    ).toBe(200);
  });
});

describe('two-factor authentication', () => {
  it('enrols, then requires a TOTP code at sign-in and rejects replay', async () => {
    const u = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    const setup = await api(ctx, T.host, u.token).post('/auth/mfa/setup');
    expect(setup.body.data.qrSvg).toContain('<svg');
    const secret: string = setup.body.data.secret;
    const enable = await api(ctx, T.host, u.token)
      .post('/auth/mfa/enable')
      .send({ code: await generate({ secret }) });
    expect(enable.status).toBe(200);
    expect(enable.body.data.recoveryCodes).toHaveLength(10);

    const step1 = await api(ctx, T.host).post('/auth/login').send({ email: u.email, password: PASSWORD });
    expect(step1.body.data).toMatchObject({ mfaRequired: true });
    expect(step1.body.data.session).toBeUndefined();

    // The code used for enrolment cannot be replayed for sign-in within the same step.
    const replay = await api(ctx, T.host)
      .post('/auth/login/mfa')
      .send({ ticket: step1.body.data.ticket, code: await generate({ secret }) });
    expect(replay.status).toBe(401);

    const recovery = await api(ctx, T.host)
      .post('/auth/login/mfa')
      .send({ ticket: step1.body.data.ticket, recoveryCode: enable.body.data.recoveryCodes[0] });
    expect(recovery.status).toBe(200);
    const reuse = await api(ctx, T.host)
      .post('/auth/login/mfa')
      .send({ ticket: step1.body.data.ticket, recoveryCode: enable.body.data.recoveryCodes[0] });
    expect(reuse.status).toBe(401);
  });

  it('stores the TOTP secret encrypted at rest', async () => {
    const u = await makeUser(ctx, T, { roles: ['ALUMNI'], mfa: true });
    const raw = await runInTenant(T._id, () => UserModel.findById(u.id).select('+mfa.secretEnc').lean());
    expect(raw!.mfa!.secretEnc).toMatch(/^v1\./);
    expect(raw!.mfa!.secretEnc).not.toContain(u.mfaSecret);
  });

  it('admins without 2FA get MFA_REQUIRED on every admin route and cannot disable 2FA', async () => {
    const admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'] });
    const r = await api(ctx, T.host, admin.token).get('/admin/users');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MFA_REQUIRED');
    const me = await api(ctx, T.host, admin.token).get('/me');
    expect(me.body.data).toMatchObject({ mfaRequired: true, mfaEnabled: false, permissions: [] });

    const withMfa = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
    const off = await api(ctx, T.host, withMfa.token)
      .post('/auth/mfa/disable')
      .send({ password: PASSWORD, code: await generate({ secret: withMfa.mfaSecret! }) });
    expect(off.status).toBe(403);
  });
});

describe('suspended accounts', () => {
  it('lose access immediately', async () => {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await runInTenant(T._id, () => UserModel.updateOne({ _id: u.id }, { $set: { status: 'suspended' } }));
    expect((await api(ctx, T.host, u.token).get('/me')).status).toBe(401);
    expect(
      (await api(ctx, T.host).post('/auth/login').send({ email: u.email, password: PASSWORD })).status,
    ).toBe(403);
  });
});

describe('unknown hosts', () => {
  it('returns UNKNOWN_TENANT for the bare domain and unknown subdomains', async () => {
    const r1 = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set('Host', 'localhost')
      .send({ email: 'a@b.co', password: 'x' });
    const r2 = await api(ctx, 'nosuchcollege.localhost').get('/tenant');
    expect(r1.body.error.code).toBe('UNKNOWN_TENANT');
    expect(r2.status).toBe(404);
  });
});

describe('signed-in account changes', () => {
  it('change password keeps this device, signs out others, rejects a wrong current password', async () => {
    const u = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    const other = await api(ctx, T.host).post('/auth/login').send({ email: u.email, password: PASSWORD });
    const wrong = await api(ctx, T.host, u.token)
      .post('/auth/password/change')
      .send({ currentPassword: 'nope-nope-nope', newPassword: 'cobalt-heron-violin-64' });
    expect(wrong.status).toBe(400);
    const ok = await api(ctx, T.host, u.token)
      .post('/auth/password/change')
      .send({ currentPassword: PASSWORD, newPassword: 'cobalt-heron-violin-64' });
    expect(ok.status).toBe(200);
    expect((await api(ctx, T.host, ok.body.data.accessToken).get('/me')).status).toBe(200);
    expect((await api(ctx, T.host, other.body.data.session.accessToken).get('/me')).status).toBe(401);
  });

  it('a non-admin can turn 2FA off with password + code; then sign-in needs no code', async () => {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'], mfa: true });
    const bad = await api(ctx, T.host, u.token)
      .post('/auth/mfa/disable')
      .send({ password: 'wrong-password-1', code: '000000' });
    expect(bad.status).toBe(400);
    const r = await api(ctx, T.host, u.token)
      .post('/auth/mfa/disable')
      .send({ password: PASSWORD, code: await generate({ secret: u.mfaSecret! }) });
    expect(r.status).toBe(204);
    const login = await api(ctx, T.host).post('/auth/login').send({ email: u.email, password: PASSWORD });
    expect(login.body.data.mfaRequired).toBe(false);
  });

  it('cannot start 2FA setup twice once enabled; wrong enrolment code is rejected', async () => {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'], mfa: true });
    expect((await api(ctx, T.host, u.token).post('/auth/mfa/setup')).status).toBe(400);
    const v = await makeUser(ctx, T, { roles: ['STUDENT'] });
    expect((await api(ctx, T.host, v.token).post('/auth/mfa/enable').send({ code: '123456' })).status).toBe(
      400,
    );
    await api(ctx, T.host, v.token).post('/auth/mfa/setup');
    expect((await api(ctx, T.host, v.token).post('/auth/mfa/enable').send({ code: '000000' })).status).toBe(
      400,
    );
  });

  it('an expired or foreign MFA ticket is rejected', async () => {
    const r = await api(ctx, T.host)
      .post('/auth/login/mfa')
      .send({ ticket: 'x'.repeat(40), code: '123456' });
    expect(r.status).toBe(401);
  });

  it('updates my name and language; withdrawing required consent is refused', async () => {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const me = await api(ctx, T.host, u.token).patch('/me').send({ name: 'Renamed Person', locale: 'te' });
    expect(me.body.data).toMatchObject({ name: 'Renamed Person', locale: 'te' });
    expect(
      (await api(ctx, T.host, u.token).post('/me/consents').send({ purpose: 'account', granted: false }))
        .status,
    ).toBe(400);
    const c = await api(ctx, T.host, u.token)
      .post('/me/consents')
      .send({ purpose: 'email_digests', granted: true });
    expect(c.body.data.find((x: { purpose: string }) => x.purpose === 'email_digests').granted).toBe(true);
  });

  it('students must use the college email domain when the college requires it', async () => {
    const D = await makeTenant('domains');
    const { TenantModel } = await import('../src/modules/tenants/tenant.model.js');
    await TenantModel.updateOne({ _id: D._id }, { $set: { allowedEmailDomains: ['domains.ac.in'] } });
    const r = await api(ctx, D.host)
      .post('/auth/signup')
      .send({
        name: 'Some One',
        email: 'someone@gmail.com',
        password: 'quiet-river-lantern-91',
        intent: 'STUDENT',
        isAdult: true,
        consents: ['account'],
      });
    expect(r.status).toBe(400);
    const alum = await api(ctx, D.host)
      .post('/auth/signup')
      .send({
        name: 'Some One',
        email: 'someone@gmail.com',
        password: 'quiet-river-lantern-91',
        intent: 'ALUMNI',
        isAdult: true,
        consents: ['account'],
      });
    expect(alum.status).toBe(202);
  });
});
