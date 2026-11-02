import { beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  makeTenant,
  makeUser,
  phoneCodeFrom,
  testApp,
  totp,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { SessionModel } from '../src/modules/auth/session.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { ConsentModel } from '../src/modules/consent/consent.model.js';
import { OtpChallengeModel } from '../src/modules/verification/verification.model.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { DisabledSmsProvider } from '../src/lib/sms.js';
import { DisabledWhatsAppProvider } from '../src/lib/whatsapp.js';
import { loadEnv } from '../src/config/env.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { clearTenantCache } from '../src/modules/tenants/tenant.cache.js';

const ctx = testApp();
let T: TestTenant;
let n = 0;
/** A fresh, valid Indian mobile number per call. */
const newPhone = () => `+9198${String(48_000_000 + ++n * 7919).padStart(8, '0')}`;
const pub = () => api(ctx, T.host);
const signupFields = (extra: Record<string, unknown> = {}) => ({
  name: 'Phone Person',
  intent: 'STUDENT',
  birthMonth: '2000-04',
  consents: ['account'],
  locale: 'en',
  ...extra,
});

async function start(phone: string, purpose: 'signup' | 'login', extra: Record<string, unknown> = {}) {
  return pub()
    .post('/auth/phone/start')
    .send({ phone, purpose, ...extra });
}
async function signUp(phone: string, fields: Record<string, unknown> = {}) {
  const s = await start(phone, 'signup');
  expect(s.status, JSON.stringify(s.body)).toBe(202);
  return pub()
    .post('/auth/phone/verify')
    .send({
      challengeId: s.body.data.challengeId,
      code: phoneCodeFrom(ctx, phone).code,
      signup: signupFields(fields),
    });
}
async function setPhone(u: TestUser, phone: string) {
  const c = ctx.services.cipher;
  await runInTenant(T._id, () =>
    UserModel.updateOne(
      { _id: u.id },
      { $set: { phoneEnc: c.encrypt(phone), phoneIndex: c.blindIndex(phone), phoneVerifiedAt: new Date() } },
    ),
  );
}

beforeAll(async () => {
  T = await makeTenant('phoneauth');
});

describe('phone sign-up and sign-in (B2)', () => {
  it('the college says phone sign-in works, and refuses it when no channel can carry codes', async () => {
    expect((await pub().get('/tenant')).body.data.phoneSignIn).toBe(true);
    const bare = testApp({ sms: new DisabledSmsProvider(), whatsapp: new DisabledWhatsAppProvider() });
    expect((await api(bare, T.host).get('/tenant')).body.data.phoneSignIn).toBe(false);
    const r = await api(bare, T.host)
      .post('/auth/phone/start')
      .send({ phone: newPhone(), purpose: 'signup' });
    expect([r.status, r.body.error.code]).toEqual([503, 'CHANNEL_UNAVAILABLE']);
  });

  it('signs up with only a phone: WhatsApp code, session, consent, no email or password', async () => {
    const phone = newPhone();
    const r = await signUp(phone);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({
      mfaRequired: false,
      created: true,
      session: { accessToken: expect.any(String) },
    });
    expect(r.headers['set-cookie']?.toString()).toContain('cl_rt=');
    expect(phoneCodeFrom(ctx, phone).channel).toBe('whatsapp');
    const me = (await api(ctx, T.host, r.body.data.session.accessToken).get('/me')).body.data;
    expect(me).toMatchObject({
      email: null,
      phone,
      hasPassword: false,
      guardianPending: false,
      minor: false,
      verified: false,
      roles: ['STUDENT'],
    });
    const consent = await runInTenant(T._id, () =>
      ConsentModel.findOne({ userId: me.id, purpose: 'account' }).lean(),
    );
    expect(consent?.granted).toBe(true);
    // No number in the audit log, and no birth month stored for an adult.
    const logs = await runInTenant(T._id, () => AuditModel.find({ action: /phone|signup/ }).lean());
    expect(JSON.stringify(logs)).not.toContain(phone.slice(-6));
    const u = await runInTenant(T._id, () => UserModel.findById(me.id).lean());
    expect(u?.adultOn).toBeNull();
    expect(u?.ageCheckedAt).toBeInstanceOf(Date);
  });

  it('answers the same for numbers with and without an account (no enumeration)', async () => {
    const known = newPhone();
    await signUp(known);
    const unknown = newPhone();
    const a = await start(known, 'login');
    const b = await start(unknown, 'login');
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(Object.keys(a.body.data).sort()).toEqual(Object.keys(b.body.data).sort());
    expect(b.body.data.channel).toBe(a.body.data.channel);
    // Only the real account's number gets a (paid) message.
    expect(phoneCodeFrom(ctx, unknown).count).toBe(0);
    const guess = await pub()
      .post('/auth/phone/verify')
      .send({ challengeId: b.body.data.challengeId, code: '123456' });
    expect(guess.status).toBe(400);
    // Signing up with a number that has an account signs in to that account instead.
    const again = await signUp(known, { name: 'Someone Else' });
    expect(again.body.data).toMatchObject({ mfaRequired: false, created: false });
    expect(await runInTenant(T._id, () => UserModel.countDocuments({ name: 'Someone Else' }))).toBe(0);
  });

  it('signs in with a code, honours the SMS choice, and lets the code be used once', async () => {
    const phone = newPhone();
    await signUp(phone);
    const s = await start(phone, 'login', { channel: 'sms' });
    const sent = phoneCodeFrom(ctx, phone);
    expect(sent.channel).toBe('sms');
    const ok = await pub()
      .post('/auth/phone/verify')
      .send({ challengeId: s.body.data.challengeId, code: sent.code });
    expect(ok.body.data).toMatchObject({ mfaRequired: false, created: false });
    const replay = await pub()
      .post('/auth/phone/verify')
      .send({ challengeId: s.body.data.challengeId, code: sent.code });
    expect(replay.status).toBe(400);
  });

  it('stops brute force: 5 wrong codes per challenge, and wrong codes lock the account', async () => {
    const phone = newPhone();
    await signUp(phone);
    const s = await start(phone, 'login');
    const { code } = phoneCodeFrom(ctx, phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      expect(
        (await pub().post('/auth/phone/verify').send({ challengeId: s.body.data.challengeId, code: wrong }))
          .status,
      ).toBe(400);
    const sixth = await pub().post('/auth/phone/verify').send({ challengeId: s.body.data.challengeId, code });
    expect(sixth.status).toBe(429);
    const u = await runInTenant(T._id, () =>
      UserModel.findOne({ phoneIndex: ctx.services.cipher.blindIndex(phone) }).lean(),
    );
    expect(u?.failedLogins).toBe(5);
    expect(u?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    // Locked: even a right code on a new challenge is refused until the lock lapses.
    const s2 = await start(phone, 'login');
    const right = await pub()
      .post('/auth/phone/verify')
      .send({ challengeId: s2.body.data.challengeId, code: phoneCodeFrom(ctx, phone).code });
    expect(right.status).toBe(429);
  });

  it('caps codes at 5 a day per number', async () => {
    const phone = newPhone();
    for (let i = 0; i < 5; i++) expect((await start(phone, 'signup')).status).toBe(202);
    const sixth = await start(phone, 'signup');
    expect(sixth.status).toBe(429);
  });

  it('refuses expired codes', async () => {
    const phone = newPhone();
    const s = await start(phone, 'signup');
    await runInTenant(T._id, () =>
      OtpChallengeModel.updateOne(
        { _id: s.body.data.challengeId },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      ),
    );
    const r = await pub()
      .post('/auth/phone/verify')
      .send({
        challengeId: s.body.data.challengeId,
        code: phoneCodeFrom(ctx, phone).code,
        signup: signupFields(),
      });
    expect(r.status).toBe(400);
  });

  it('administrators cannot sign in by phone; a member with TOTP still needs it', async () => {
    const admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
    const adminPhone = newPhone();
    await setPhone(admin, adminPhone);
    const s = await start(adminPhone, 'login');
    const r = await pub()
      .post('/auth/phone/verify')
      .send({ challengeId: s.body.data.challengeId, code: phoneCodeFrom(ctx, adminPhone).code });
    expect([r.status, r.body.error.code]).toEqual([403, 'USE_PASSWORD_AND_2FA']);

    const alum = await makeUser(ctx, T, { roles: ['ALUMNI'], mfa: true });
    const alumPhone = newPhone();
    await setPhone(alum, alumPhone);
    const s2 = await start(alumPhone, 'login');
    const r2 = await pub()
      .post('/auth/phone/verify')
      .send({ challengeId: s2.body.data.challengeId, code: phoneCodeFrom(ctx, alumPhone).code });
    expect(r2.body.data).toMatchObject({ mfaRequired: true, ticket: expect.any(String) });
    const done = await pub()
      .post('/auth/login/mfa')
      .send({ ticket: r2.body.data.ticket, code: await totp(alum.mfaSecret ?? '') });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  });

  it('a proved number verifies the member when exactly one roster record has it', async () => {
    const c = ctx.services.cipher;
    const solo = newPhone();
    const shared = newPhone();
    await runInTenant(T._id, async () => {
      await WhitelistModel.create({
        rollNumber: '22PH1A0001',
        name: 'Solo',
        kind: 'student',
        gradYear: 2026,
        source: 'manual',
        phoneEnc: c.encrypt(solo),
        phoneIndex: c.blindIndex(solo),
      });
      for (const roll of ['22PH1A0002', '22PH1A0003'])
        await WhitelistModel.create({
          rollNumber: roll,
          name: 'Sibling',
          kind: 'student',
          gradYear: 2026,
          source: 'manual',
          phoneEnc: c.encrypt(shared),
          phoneIndex: c.blindIndex(shared),
        });
    });
    const a = await signUp(solo);
    expect((await api(ctx, T.host, a.body.data.session.accessToken).get('/me')).body.data.verified).toBe(
      true,
    );
    const b = await signUp(shared);
    expect((await api(ctx, T.host, b.body.data.session.accessToken).get('/me')).body.data.verified).toBe(
      false,
    );
  });
});

describe('notifications for members without email', () => {
  it('delivers in the app and skips email for a phone-only member', async () => {
    const r = await signUp(newPhone());
    const me = (await api(ctx, T.host, r.body.data.session.accessToken).get('/me')).body.data;
    const before = ctx.mailer.outbox.length;
    const notifications = (
      ctx.app.locals.services as {
        notifications: { notify: (u: string, t: string, d: Record<string, string>) => Promise<unknown> };
      }
    ).notifications;
    await runInTenant(T._id, () => notifications.notify(me.id, 'adult_now', {}));
    await ctx.queue.drain();
    expect(ctx.mailer.outbox.length).toBe(before);
    const list = (await api(ctx, T.host, r.body.data.session.accessToken).get('/notifications')).body.data;
    expect(list[0]?.type).toBe('adult_now');
  });
});

describe('changing the number (B2)', () => {
  it('needs a code to the old number, then one to the new; other sessions end; both steps audited', async () => {
    const old = newPhone();
    const first = await signUp(old);
    const token = first.body.data.session.accessToken as string;
    const s2 = await start(old, 'login');
    const second = await pub()
      .post('/auth/phone/verify')
      .send({ challengeId: s2.body.data.challengeId, code: phoneCodeFrom(ctx, old).code });
    const otherToken = second.body.data.session.accessToken as string;

    const next = newPhone();
    const step1 = await api(ctx, T.host, token).post('/me/phone/change').send({ phone: next });
    expect(step1.status).toBe(202);
    expect(step1.body.data.step).toBe('old');
    expect(phoneCodeFrom(ctx, next).count).toBe(0);
    const step2 = await api(ctx, T.host, token)
      .post('/me/phone/change/confirm')
      .send({ challengeId: step1.body.data.challengeId, code: phoneCodeFrom(ctx, old).code });
    expect(step2.body.data).toMatchObject({ done: false, next: { step: 'new' } });
    const step3 = await api(ctx, T.host, token)
      .post('/me/phone/change/confirm')
      .send({ challengeId: step2.body.data.next.challengeId, code: phoneCodeFrom(ctx, next).code });
    expect(step3.body.data).toEqual({ done: true });
    expect((await api(ctx, T.host, token).get('/me')).body.data.phone).toBe(next);
    expect((await api(ctx, T.host, otherToken).get('/me')).status).toBe(401);
    const actions = (
      await runInTenant(T._id, () => AuditModel.find({ action: /^auth\.phone_change/ }).lean())
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['auth.phone_change_started', 'auth.phone_change_old_confirmed']),
    );
    expect(
      await runInTenant(T._id, () => AuditModel.countDocuments({ action: 'auth.phone_changed' })),
    ).toBeGreaterThan(0);
  });

  it('a password can stand in for the old number; a wrong one cannot; a taken number is refused', async () => {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const as = api(ctx, T.host, u.token);
    expect((await as.post('/me/phone/change').send({ phone: newPhone() })).status).toBe(400);
    expect(
      (await as.post('/me/phone/change').send({ phone: newPhone(), password: 'wrong-password' })).status,
    ).toBe(400);
    const taken = newPhone();
    await signUp(taken);
    const s = await as
      .post('/me/phone/change')
      .send({ phone: taken, password: 'Correct-Horse-Battery-Staple-42' });
    expect(s.body.data.step).toBe('new');
    const c = await as
      .post('/me/phone/change/confirm')
      .send({ challengeId: s.body.data.challengeId, code: phoneCodeFrom(ctx, taken).code });
    expect(c.status).toBe(409);
  });

  it('another member cannot confirm my challenge', async () => {
    const mine = newPhone();
    const me = await signUp(mine);
    const other = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const s = await api(ctx, T.host, me.body.data.session.accessToken)
      .post('/me/phone/change')
      .send({ phone: newPhone() });
    const r = await api(ctx, T.host, other.token)
      .post('/me/phone/change/confirm')
      .send({ challengeId: s.body.data.challengeId, code: phoneCodeFrom(ctx, mine).code });
    expect(r.status).toBe(400);
    expect(
      await runInTenant(T._id, () => SessionModel.countDocuments({ userId: other.id, revokedAt: null })),
    ).toBe(1);
  });
});

describe('read-only for non-payment (B10)', () => {
  it('phone codes still sign members in, but create no new accounts', async () => {
    const known = newPhone();
    expect((await signUp(known)).status).toBe(200);
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'billing.readOnlyAt': new Date() } });
    clearTenantCache();
    try {
      const fresh = await signUp(newPhone());
      expect([fresh.status, fresh.body.error?.code]).toEqual([403, 'READ_ONLY']);
      const s = await start(known, 'login');
      const ok = await pub()
        .post('/auth/phone/verify')
        .send({ challengeId: s.body.data.challengeId, code: phoneCodeFrom(ctx, known).code });
      expect(ok.body.data).toMatchObject({ mfaRequired: false, created: false });
    } finally {
      await TenantModel.updateOne({ _id: T._id }, { $set: { 'billing.readOnlyAt': null } });
      clearTenantCache();
    }
  });
});

describe('development outbox', () => {
  it('shows the console messages to a number outside production only', async () => {
    const phone = newPhone();
    await start(phone, 'signup');
    const r = await api(ctx, T.host).get(`/dev/outbox?to=${encodeURIComponent(phone)}`);
    expect(r.body.data[0]).toMatchObject({ channel: 'whatsapp', to: phone, template: 'auth_code' });
  });

  it('production refuses the console providers', () => {
    const prod = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(64),
      JWT_TICKET_SECRET: 'b'.repeat(64),
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      MALWARE_SCANNER: 'clamav',
    };
    expect(() => loadEnv(prod)).not.toThrow();
    expect(() => loadEnv({ ...prod, SMS_PROVIDER: 'console' })).toThrow(/console/);
    expect(() => loadEnv({ ...prod, WHATSAPP_PROVIDER: 'console' })).toThrow(/console/);
  });
});
