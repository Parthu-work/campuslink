import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  api,
  codeFrom,
  cookiesFrom,
  makeTenant,
  makeUser,
  phoneCodeFrom,
  testApp,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { InviteLinkModel, JoinCodeModel } from '../src/modules/verification/onboarding.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { invalidateTenant } from '../src/modules/tenants/tenant.cache.js';

const ctx = testApp();
let T: TestTenant;
let tpo: TestUser, student: TestUser;
let n = 0;
const newPhone = () => `+9197${String(31_000_000 + ++n * 7919).padStart(8, '0')}`;
const pub = () => api(ctx, T.host);
const admin = () => api(ctx, T.host, tpo.token);
const claim = (extra: Record<string, unknown> = {}) => ({
  birthMonth: '2003-05',
  consents: ['account'],
  locale: 'en',
  ...extra,
});

async function addRecord(
  o: {
    roll?: string;
    name?: string;
    kind?: 'student' | 'alumni';
    branch?: string;
    gradYear?: number;
    phone?: string | null;
    email?: string;
  } = {},
) {
  const c = ctx.services.cipher;
  const phone = o.phone === undefined ? newPhone() : o.phone;
  const roll = o.roll ?? `24OB1A${String(++n).padStart(4, '0')}`;
  await runInTenant(T._id, () =>
    WhitelistModel.create({
      rollNumber: roll,
      name: o.name ?? 'Ravi Teja Kumar',
      kind: o.kind ?? 'student',
      branch: o.branch ?? 'CSE',
      gradYear: o.gradYear ?? 2027,
      source: 'import',
      ...(phone ? { phoneEnc: c.encrypt(phone), phoneIndex: c.blindIndex(phone) } : {}),
      ...(o.email ? { emailEnc: c.encrypt(o.email), emailIndex: c.blindIndex(o.email) } : {}),
    }),
  );
  const rec = await runInTenant(T._id, () => WhitelistModel.findOne({ rollNumber: roll }).lean());
  return { id: String(rec?._id), roll, phone };
}

/** Personal links for the given records (CSV path), keyed by roll number. */
async function linksFor(ids: string[]) {
  const r = await admin().post('/admin/onboarding/invites').send({ ids, channel: 'csv' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return Object.fromEntries(
    (r.body.data.links as { rollNumber: string; link: string }[]).map((l) => [
      l.rollNumber,
      l.link.split('/invite/')[1] ?? '',
    ]),
  );
}

beforeAll(async () => {
  T = await makeTenant('onboard', 'college', { whatsapp: true });
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
});

describe('Admin › Onboarding access (B4)', () => {
  it('members without onboarding:manage are refused every admin onboarding route', async () => {
    const s = api(ctx, T.host, student.token);
    const id = new Types.ObjectId().toString();
    for (const r of [
      () => s.get('/admin/onboarding/records'),
      () => s.post('/admin/onboarding/invites').send({ channel: 'csv' }),
      () => s.get('/admin/join-codes'),
      () => s.post('/admin/join-codes').send({ kind: 'student' }),
      () => s.post(`/admin/join-codes/${id}/expire`),
      () => s.get(`/admin/join-codes/${id}/poster`),
    ])
      expect((await r()).status).toBe(403);
    expect((await pub().get('/admin/onboarding/records')).status).toBe(401);
  });

  it('the TPO lists unclaimed records with what contact the college holds', async () => {
    const rec = await addRecord({ branch: 'ECE', gradYear: 2026, phone: null, email: 'lst@x.example' });
    const r = await admin().get('/admin/onboarding/records?branch=ECE&gradYear=2026');
    expect(r.status).toBe(200);
    const row = r.body.data.find((i: { id: string }) => i.id === rec.id);
    expect(row).toMatchObject({ hasPhone: false, hasEmail: true, status: 'unclaimed', lastInvitedAt: null });
    expect(JSON.stringify(r.body)).not.toContain('lst@x.example');
  });
});

describe('invite links (B4)', () => {
  it('CSV: one personal link per unclaimed record; again within 72 hours is skipped', async () => {
    const a = await addRecord({ branch: 'MECH', gradYear: 2028 });
    const b = await addRecord({ branch: 'MECH', gradYear: 2028 });
    const first = await admin()
      .post('/admin/onboarding/invites')
      .send({ branch: 'MECH', gradYear: 2028, channel: 'csv' });
    expect(first.body.data).toMatchObject({ created: 2, skipped: 0 });
    expect(first.body.data.links.map((l: { rollNumber: string }) => l.rollNumber).sort()).toEqual(
      [a.roll, b.roll].sort(),
    );
    expect(first.body.data.links[0].link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    const again = await admin()
      .post('/admin/onboarding/invites')
      .send({ branch: 'MECH', gradYear: 2028, channel: 'csv' });
    expect(again.body.data).toMatchObject({ created: 0, skipped: 2 });
    // Only a hash of the token is stored.
    const token = first.body.data.links[0].link.split('/invite/')[1];
    const stored = await runInTenant(T._id, () => InviteLinkModel.find({ whitelistId: a.id }).lean());
    expect(JSON.stringify(stored)).not.toContain(token);
    const audit = await runInTenant(T._id, () =>
      AuditModel.findOne({ action: 'onboarding.invites_sent' }).sort({ _id: -1 }).lean(),
    );
    expect(audit?.actorId?.toString()).toBe(tpo.id);
  });

  it('the link shows a first name and masked roll number, and the code goes only to the number on record', async () => {
    const rec = await addRecord({ name: 'Lakshmi Prasanna' });
    const token = (await linksFor([rec.id]))[rec.roll] ?? '';
    const info = await pub().get(`/invite/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.data).toMatchObject({ firstName: 'Lakshmi', kind: 'student', contact: 'phone' });
    expect(info.body.data.rollNumber).not.toBe(rec.roll);
    expect(info.body.data.rollNumber).toContain('•');
    // There is no way to name another number: the body takes only a channel preference.
    const typed = await pub().post(`/invite/${token}/accept`).send({ phone: '+919999999999' });
    expect(typed.status).toBe(400);
    const sent = await pub().post(`/invite/${token}/accept`).send({});
    expect(sent.status).toBe(202);
    expect(sent.body.data.destination).toMatch(/^\+91 •••••/);
    expect(phoneCodeFrom(ctx, rec.phone ?? '').code).toMatch(/^\d{6}$/);
  });

  it('confirming creates a verified member from the record, signs them in, and the link is single use', async () => {
    const rec = await addRecord({ name: 'Sai Charan', branch: 'CSE', gradYear: 2027 });
    const token = (await linksFor([rec.id]))[rec.roll] ?? '';
    const sent = await pub().post(`/invite/${token}/accept`).send({});
    const body = {
      challengeId: sent.body.data.challengeId,
      code: phoneCodeFrom(ctx, rec.phone ?? '').code,
      ...claim(),
    };
    const wrong = await pub()
      .post(`/invite/${token}/accept/confirm`)
      .send({ ...body, code: body.code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    const done = await pub().post(`/invite/${token}/accept/confirm`).send(body);
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.data.kind).toBe('student');
    expect(done.body.data.session.accessToken).toBeTruthy();
    expect(cookiesFrom(done).cookie).toContain('cl_rt=');
    const me = await api(ctx, T.host, done.body.data.session.accessToken).get('/me');
    expect(me.body.data).toMatchObject({ name: 'Sai Charan', verified: true, roles: ['STUDENT'] });
    const user = await runInTenant(T._id, () =>
      UserModel.findOne({ _id: me.body.data.id }).select('phoneVerifiedAt email').lean(),
    );
    expect(user?.phoneVerifiedAt).toBeTruthy();
    const profile = await runInTenant(T._id, () => ProfileModel.findOne({ userId: me.body.data.id }).lean());
    expect([profile?.branch, profile?.gradYear]).toEqual(['CSE', 2027]);
    const r = await runInTenant(T._id, () => WhitelistModel.findById(rec.id).lean());
    expect(r?.status).toBe('claimed');
    // Used: the link no longer opens, and the same code cannot be replayed.
    expect((await pub().get(`/invite/${token}`)).status).toBe(404);
    expect((await pub().post(`/invite/${token}/accept/confirm`).send(body)).status).toBe(400);
  });

  it('an expired link does not open or send a code', async () => {
    const rec = await addRecord();
    const token = (await linksFor([rec.id]))[rec.roll] ?? '';
    await runInTenant(T._id, () =>
      InviteLinkModel.updateMany(
        { whitelistId: rec.id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      ),
    );
    expect((await pub().get(`/invite/${token}`)).status).toBe(404);
    expect((await pub().post(`/invite/${token}/accept`).send({})).status).toBe(404);
    expect(phoneCodeFrom(ctx, rec.phone ?? '').count).toBe(0);
    expect((await pub().get(`/invite/${'x'.repeat(43)}`)).status).toBe(404);
    expect((await pub().get('/invite/short')).status).toBe(400);
  });

  it('a record with only an email gets an email code and an email account', async () => {
    const rec = await addRecord({ phone: null, email: 'only.mail@onboard.example' });
    const token = (await linksFor([rec.id]))[rec.roll] ?? '';
    expect((await pub().get(`/invite/${token}`)).body.data.contact).toBe('email');
    const sent = await pub().post(`/invite/${token}/accept`).send({});
    expect(sent.body.data.channel).toBe('email');
    const done = await pub()
      .post(`/invite/${token}/accept/confirm`)
      .send({
        challengeId: sent.body.data.challengeId,
        code: codeFrom(ctx, 'only.mail@onboard.example'),
        ...claim(),
      });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    const me = await api(ctx, T.host, done.body.data.session.accessToken).get('/me');
    expect(me.body.data.email).toBe('only.mail@onboard.example');
  });

  it('a record with no contact cannot be claimed by link', async () => {
    const rec = await addRecord({ phone: null });
    const token = (await linksFor([rec.id]))[rec.roll] ?? '';
    expect((await pub().get(`/invite/${token}`)).body.data.contact).toBeNull();
    expect((await pub().post(`/invite/${token}/accept`).send({})).status).toBe(400);
  });

  it('needs the required consents, and a number that already has an account is sent to sign in', async () => {
    const rec = await addRecord();
    const token = (await linksFor([rec.id]))[rec.roll] ?? '';
    const code = async () => {
      const s = await pub().post(`/invite/${token}/accept`).send({});
      return { challengeId: s.body.data.challengeId, code: phoneCodeFrom(ctx, rec.phone ?? '').code };
    };
    const noConsent = await pub()
      .post(`/invite/${token}/accept/confirm`)
      .send({ ...(await code()), ...claim({ consents: [] }) });
    expect(noConsent.status).toBe(400);
    // The link survives a failed confirmation.
    expect((await pub().get(`/invite/${token}`)).status).toBe(200);
    const c = ctx.services.cipher;
    await runInTenant(T._id, () =>
      UserModel.updateOne(
        { _id: student.id },
        { $set: { phoneEnc: c.encrypt(rec.phone ?? ''), phoneIndex: c.blindIndex(rec.phone ?? '') } },
      ),
    );
    const taken = await pub()
      .post(`/invite/${token}/accept/confirm`)
      .send({ ...(await code()), ...claim() });
    expect(taken.status).toBe(409);
    await runInTenant(T._id, () =>
      UserModel.updateOne({ _id: student.id }, { $unset: { phoneEnc: 1, phoneIndex: 1 } }),
    );
  });

  it('a minor who joins by link waits for a guardian', async () => {
    const rec = await addRecord();
    const token = (await linksFor([rec.id]))[rec.roll] ?? '';
    const s = await pub().post(`/invite/${token}/accept`).send({});
    const year = new Date().getUTCFullYear() - 15;
    const done = await pub()
      .post(`/invite/${token}/accept/confirm`)
      .send({
        challengeId: s.body.data.challengeId,
        code: phoneCodeFrom(ctx, rec.phone ?? '').code,
        ...claim({ birthMonth: `${year}-01` }),
      });
    expect(done.status).toBe(201);
    const me = await api(ctx, T.host, done.body.data.session.accessToken).get('/me');
    expect(me.body.data.guardianPending).toBe(true);
  });

  it('at most five codes a day for one record, however they are asked for', async () => {
    const rec = await addRecord();
    const token = (await linksFor([rec.id]))[rec.roll] ?? '';
    for (let i = 0; i < 5; i++)
      expect((await pub().post(`/invite/${token}/accept`).send({})).status).toBe(202);
    expect((await pub().post(`/invite/${token}/accept`).send({})).status).toBe(429);
  });
});

describe('invites by WhatsApp (B4)', () => {
  it('needs the college to confirm opt-in, then sends the invite template with the link', async () => {
    const rec = await addRecord({ name: 'Anil Varma', kind: 'alumni', gradYear: 2015 });
    const refused = await admin()
      .post('/admin/onboarding/invites')
      .send({ ids: [rec.id], channel: 'whatsapp' });
    expect(refused.status).toBe(400);
    const r = await admin()
      .post('/admin/onboarding/invites')
      .send({ ids: [rec.id], channel: 'whatsapp', attestOptIn: true });
    expect(r.body.data).toMatchObject({ created: 1, sent: 1, failed: 0 });
    expect(r.body.data.links).toEqual([]);
    const msg = ctx.whatsapp.outbox.lastTo(rec.phone ?? '');
    expect(msg?.template).toBe('cl_invite_alumni');
    expect(msg?.params[0]).toBe('Anil');
    expect(msg?.params[2]).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  });

  it('skips records without a number, and is unavailable while the college has WhatsApp off', async () => {
    const rec = await addRecord({ phone: null, email: 'nophone@onboard.example' });
    const r = await admin()
      .post('/admin/onboarding/invites')
      .send({ ids: [rec.id], channel: 'whatsapp', attestOptIn: true });
    expect(r.body.data).toMatchObject({ created: 0, skipped: 1 });
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'features.whatsapp': false } });
    invalidateTenant(T.slug);
    const off = await admin()
      .post('/admin/onboarding/invites')
      .send({ ids: [rec.id], channel: 'whatsapp', attestOptIn: true });
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'features.whatsapp': true } });
    invalidateTenant(T.slug);
    expect([off.status, off.body.error?.code]).toEqual([503, 'CHANNEL_UNAVAILABLE']);
  });
});

describe('class join codes (B4)', () => {
  async function newCode(body: Record<string, unknown>) {
    const r = await admin().post('/admin/join-codes').send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data as { id: string; code: string };
  }

  it('a roll number in the class gets a code to its own number and joins; others are refused', async () => {
    const jc = await newCode({ kind: 'student', branch: 'EEE', gradYear: 2029 });
    expect(jc.code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    const inClass = await addRecord({ branch: 'EEE', gradYear: 2029, name: 'Divya Sree' });
    const otherClass = await addRecord({ branch: 'CSE', gradYear: 2029 });
    const info = await pub().get(`/join/${jc.code.toLowerCase()}`);
    expect(info.body.data).toMatchObject({ kind: 'student', branch: 'EEE', gradYear: 2029 });
    expect((await pub().post(`/join/${jc.code}/start`).send({ rollNumber: otherClass.roll })).status).toBe(
      400,
    );
    expect((await pub().post(`/join/${jc.code}/start`).send({ rollNumber: '99XX9X9999' })).status).toBe(400);
    const s = await pub().post(`/join/${jc.code}/start`).send({ rollNumber: inClass.roll });
    expect(s.status).toBe(202);
    const done = await pub()
      .post(`/join/${jc.code}/confirm`)
      .send({
        challengeId: s.body.data.challengeId,
        code: phoneCodeFrom(ctx, inClass.phone ?? '').code,
        ...claim(),
      });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    const me = await api(ctx, T.host, done.body.data.session.accessToken).get('/me');
    expect(me.body.data).toMatchObject({ name: 'Divya Sree', verified: true });
    const list = await admin().get('/admin/join-codes');
    expect(list.body.data.find((c: { id: string }) => c.id === jc.id)).toMatchObject({
      uses: 1,
      active: true,
    });
    // A claimed record cannot join again.
    expect((await pub().post(`/join/${jc.code}/start`).send({ rollNumber: inClass.roll })).status).toBe(400);
  });

  it('an expired or stopped code does not work; the poster carries a QR code of the join link', async () => {
    const jc = await newCode({ kind: 'alumni', days: 3 });
    const poster = await admin().get(`/admin/join-codes/${jc.id}/poster`);
    expect(poster.body.data.qrSvg).toContain('<svg');
    expect(poster.body.data.url).toMatch(new RegExp(`/join/${jc.code}$`));
    const stop = await admin().post(`/admin/join-codes/${jc.id}/expire`);
    expect(stop.body.data.active).toBe(false);
    expect((await pub().get(`/join/${jc.code}`)).status).toBe(404);
    const old = await newCode({ kind: 'student' });
    await runInTenant(T._id, () =>
      JoinCodeModel.updateOne({ _id: old.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } }),
    );
    expect((await pub().get(`/join/${old.code}`)).status).toBe(404);
    expect((await pub().get('/join/BAD')).status).toBe(400);
  });
});
