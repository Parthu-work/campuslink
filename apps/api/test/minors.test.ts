import { beforeAll, describe, expect, it } from 'vitest';
import { adultOnFromBirthMonth } from '@campuslink/shared';
import {
  api,
  makeTenant,
  makeUser,
  phoneCodeFrom,
  testApp,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { ConsentModel } from '../src/modules/consent/consent.model.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { ADULT_JOB } from '../src/modules/verification/guardian.service.js';
import type { RouteRegistry } from '../src/http/registry.js';
import type { GamificationService } from '../src/modules/gamification/gamification.service.js';

const ctx = testApp();
let T: TestTenant;
let tpo: TestUser;
let n = 0;
const newPhone = () => `+9197${String(31_000_000 + ++n * 6113).padStart(8, '0')}`;
const year = new Date().getUTCFullYear();
/** A birth month that makes the member 16. */
const MINOR_MONTH = `${year - 16}-06`;
const pub = () => api(ctx, T.host);

async function rosterRecord(roll: string, phone: string, guardianPhone?: string) {
  const c = ctx.services.cipher;
  await runInTenant(T._id, () =>
    WhitelistModel.create({
      rollNumber: roll,
      name: 'Young Student',
      kind: 'student',
      gradYear: year + 3,
      source: 'import',
      phoneEnc: c.encrypt(phone),
      phoneIndex: c.blindIndex(phone),
      ...(guardianPhone
        ? { guardianPhoneEnc: c.encrypt(guardianPhone), guardianPhoneIndex: c.blindIndex(guardianPhone) }
        : {}),
    }),
  );
}

/** Signs up by phone as a 16-year-old; returns the access token and user id. */
async function minorSignUp(phone: string) {
  const s = await pub().post('/auth/phone/start').send({ phone, purpose: 'signup' });
  const r = await pub()
    .post('/auth/phone/verify')
    .send({
      challengeId: s.body.data.challengeId,
      code: phoneCodeFrom(ctx, phone).code,
      signup: {
        name: 'Young Student',
        intent: 'STUDENT',
        birthMonth: MINOR_MONTH,
        consents: ['account'],
        locale: 'en',
      },
    });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const token = r.body.data.session.accessToken as string;
  const me = (await api(ctx, T.host, token).get('/me')).body.data;
  return { token, id: me.id as string, me };
}

async function consentWithGuardian(token: string, guardianPhone: string) {
  const as = api(ctx, T.host, token);
  const s = await as.post('/me/guardian/start').send({});
  expect(s.status, JSON.stringify(s.body)).toBe(202);
  return as.post('/me/guardian/confirm').send({
    challengeId: s.body.data.challengeId,
    code: phoneCodeFrom(ctx, guardianPhone).code,
    language: 'te',
  });
}

beforeAll(async () => {
  T = await makeTenant('minors', 'college', { leaderboards: true });
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
});

describe('members under 18 (B2)', () => {
  it('a 16-year-old starts waiting for a guardian; only the date they turn 18 is stored', async () => {
    const phone = newPhone();
    const { id, me } = await minorSignUp(phone);
    expect(me).toMatchObject({ guardianPending: true, minor: true, permissions: [] });
    const u = await runInTenant(T._id, () => UserModel.findById(id).lean());
    expect(u?.status).toBe('guardian_pending');
    expect(u?.adultOn?.toISOString()).toBe(adultOnFromBirthMonth(MINOR_MONTH).toISOString());
    expect(JSON.stringify(u)).not.toContain(MINOR_MONTH);
  });

  it('email sign-up treats a minor the same way', async () => {
    const r = await pub()
      .post('/auth/signup')
      .send({
        name: 'Email Minor',
        email: 'emailminor@minors.example',
        password: 'Correct-Horse-Battery-Staple-42',
        intent: 'STUDENT',
        birthMonth: MINOR_MONTH,
        consents: ['account'],
        locale: 'en',
      });
    expect(r.status).toBe(202);
    const u = await runInTenant(T._id, () =>
      UserModel.findOne({ email: 'emailminor@minors.example' }).lean(),
    );
    expect(u?.status).toBe('guardian_pending');
  });

  it('while waiting, every permission-guarded route is refused; verification and the guardian step work', async () => {
    const { token } = await minorSignUp(newPhone());
    const as = api(ctx, T.host, token);
    const registry = ctx.app.locals.registry as RouteRegistry;
    const guarded = registry.filter(
      (r) => r.spec.access.kind === 'permission' && (r.spec.scope ?? 'college') === 'college',
    );
    expect(guarded.length).toBeGreaterThan(100);
    const id = '0123456789abcdef01234567';
    for (const { spec } of guarded) {
      const r = await as[spec.method](spec.path.replace(/:[A-Za-z]+/g, id)).send({});
      expect(r.status, `${spec.method} ${spec.path}`).toBe(403);
    }
    expect((await as.get('/me')).status).toBe(200);
    expect((await as.get('/verification')).status).toBe(200);
    expect((await as.get('/me/guardian')).body.data).toMatchObject({ required: true, rosterMatched: false });
    expect((await as.get('/me/privacy/export')).status).not.toBe(403);
  });

  it('the guardian confirms with a code to the number on the college record', async () => {
    const phone = newPhone();
    const guardian = newPhone();
    await rosterRecord('24MN1A0001', phone, guardian);
    const { token, id } = await minorSignUp(phone);
    const as = api(ctx, T.host, token);
    // Matched to the roster by the proved number.
    expect((await as.get('/me')).body.data.verified).toBe(true);
    const st = (await as.get('/me/guardian')).body.data;
    expect(st).toMatchObject({
      required: true,
      rosterMatched: true,
      manualPending: false,
      declarationVersion: 1,
    });
    expect(st.guardianPhone).toBe(`+91 ••••• ••${guardian.slice(-3)}`);
    const wrong = await as.post('/me/guardian/start').send({});
    await as
      .post('/me/guardian/confirm')
      .send({ challengeId: wrong.body.data.challengeId, code: '000000', language: 'en' })
      .expect(400);
    const done = await consentWithGuardian(token, guardian);
    expect(done.body.data).toEqual({ consented: true });
    const me = (await as.get('/me')).body.data;
    expect(me).toMatchObject({ guardianPending: false, minor: true });
    expect(me.permissions).toContain('feed:read');
    const consent = await runInTenant(T._id, () =>
      ConsentModel.findOne({ userId: id, purpose: 'guardian_consent' }).lean(),
    );
    expect(consent).toMatchObject({
      granted: true,
      version: 1,
      source: 'guardian',
      evidence: { language: 'te', channel: 'whatsapp' },
    });
    expect(JSON.stringify(consent)).not.toContain(guardian.slice(-6));
    expect(
      await runInTenant(T._id, () => AuditModel.countDocuments({ action: 'guardian.consent_recorded' })),
    ).toBe(1);
  });

  it('without a guardian number on record, the college approves the one the student enters', async () => {
    const phone = newPhone();
    const guardian = newPhone();
    await rosterRecord('24MN1A0002', phone);
    const { token, id } = await minorSignUp(phone);
    const as = api(ctx, T.host, token);
    expect((await as.post('/me/guardian/start').send({})).status).toBe(400);
    expect((await as.post('/me/guardian/manual').send({ phone: guardian })).status).toBe(201);
    expect((await as.post('/me/guardian/manual').send({ phone: guardian })).status).toBe(409);
    expect((await as.get('/me/guardian')).body.data.manualPending).toBe(true);
    const queue = (await api(ctx, T.host, tpo.token).get('/admin/verification?status=pending')).body.data;
    const item = queue.find((x: { user: { id: string } }) => x.user.id === id);
    expect(item).toMatchObject({
      method: 'guardian_manual',
      fileId: null,
      guardianPhone: guardian,
    });
    await api(ctx, T.host, tpo.token)
      .post(`/admin/verification/${item.id}/decision`)
      .send({ decision: 'approve' })
      .expect(200);
    expect(
      await runInTenant(T._id, () =>
        NotificationModel.countDocuments({ userId: id, type: 'guardian_number_approved' }),
      ),
    ).toBe(1);
    expect((await consentWithGuardian(token, guardian)).body.data).toEqual({ consented: true });
  });

  it('a minor never shows contact details to others, never appears on leaderboards, and gets a chronological feed', async () => {
    const phone = newPhone();
    const guardian = newPhone();
    await rosterRecord('24MN1A0003', phone, guardian);
    const { token, id } = await minorSignUp(phone);
    await consentWithGuardian(token, guardian);
    const as = api(ctx, T.host, token);
    // Even with phone visible to members, others do not see it.
    await as.put('/me/profile').send({ phone, visibility: { phone: 'members' } });
    const peer = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const seen = (await api(ctx, T.host, peer.token).get(`/profiles/${id}`)).body.data;
    expect(seen.fields.phone).toBeUndefined();
    expect((await as.get('/me/profile')).body.data.profile.fields.phone).toBe(phone);
    expect(
      await runInTenant(T._id, () =>
        ProfileModel.findOne({ userId: id })
          .lean()
          .then((p) => p?.minorUntil),
      ),
    ).toBeInstanceOf(Date);

    await as.put('/me/progress/settings').send({ showOnLeaderboard: true, showOnWall: false }).expect(200);
    const gamification = (ctx.app.locals.services as { gamification: GamificationService }).gamification;
    await runInTenant(T._id, () => gamification.award(id, 'roadmap_step', 'minor-step-1'));
    await api(ctx, T.host, peer.token)
      .put('/me/progress/settings')
      .send({ showOnLeaderboard: true, showOnWall: false });
    await runInTenant(T._id, () => gamification.award(peer.id, 'roadmap_step', 'peer-step-1'));
    const board = (await as.get('/leaderboard')).body.data as { person: { userId: string } }[];
    expect(board.map((r) => r.person.userId)).toContain(peer.id);
    expect(board.map((r) => r.person.userId)).not.toContain(id);

    expect((await as.get('/feed?tab=for_you')).status).toBe(200);
    // No route opens a direct message outside an accepted mentorship (conversations come only from
    // mentorship), so a minor cannot be messaged by strangers.
    const registry = ctx.app.locals.registry as RouteRegistry;
    expect(registry.some((r) => r.spec.method === 'post' && r.spec.path === '/conversations')).toBe(false);
  });

  it('turning 18 lifts the rules, clears the date and tells the member', async () => {
    const pending = await minorSignUp(newPhone());
    const phone = newPhone();
    const guardian = newPhone();
    await rosterRecord('24MN1A0004', phone, guardian);
    const consented = await minorSignUp(phone);
    await consentWithGuardian(consented.token, guardian);
    await runInTenant(T._id, () =>
      UserModel.updateMany(
        { _id: { $in: [pending.id, consented.id] } },
        { $set: { adultOn: new Date(Date.now() - 60_000) } },
      ),
    );
    await ctx.queue.enqueue(ADULT_JOB, { tenantId: String(T._id) });
    await ctx.queue.drain();
    for (const m of [pending, consented]) {
      const me = (await api(ctx, T.host, m.token).get('/me')).body.data;
      expect(me).toMatchObject({ minor: false, guardianPending: false });
      const u = await runInTenant(T._id, () => UserModel.findById(m.id).lean());
      expect([u?.adultOn, u?.status]).toEqual([null, 'active']);
      expect(
        await runInTenant(T._id, () => NotificationModel.countDocuments({ userId: m.id, type: 'adult_now' })),
      ).toBe(1);
    }
    // Running again finds nobody.
    await ctx.queue.enqueue(ADULT_JOB, { tenantId: String(T._id) });
    await ctx.queue.drain();
    expect(
      await runInTenant(T._id, () =>
        NotificationModel.countDocuments({ userId: pending.id, type: 'adult_now' }),
      ),
    ).toBe(1);
  });
});
