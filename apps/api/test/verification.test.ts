import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  api,
  codeFrom,
  jpegWithExif,
  makeTenant,
  makeUser,
  phoneCodeFrom,
  testApp,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { OtpChallengeModel } from '../src/modules/verification/verification.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { DisabledSmsProvider } from '../src/lib/sms.js';
import { DisabledWhatsAppProvider } from '../src/lib/whatsapp.js';

const ctx = testApp();
let T: TestTenant;
let admin: TestUser;
const cipher = () => ctx.services.cipher;

async function addRecord(
  roll: string,
  data: {
    name?: string;
    email?: string;
    phone?: string;
    kind?: 'student' | 'alumni';
    gradYear?: number;
  } = {},
) {
  return runInTenant(T._id, () =>
    WhitelistModel.create({
      rollNumber: roll,
      name: data.name ?? 'Listed Person',
      kind: data.kind ?? 'student',
      gradYear: data.gradYear ?? 2026,
      source: 'manual',
      emailEnc: data.email ? cipher().encrypt(data.email) : null,
      emailIndex: data.email ? cipher().blindIndex(data.email) : null,
      phoneEnc: data.phone ? cipher().encrypt(data.phone) : null,
      phoneIndex: data.phone ? cipher().blindIndex(data.phone) : null,
    }),
  );
}
const unverified = (roles: ('STUDENT' | 'ALUMNI')[] = ['STUDENT']) =>
  makeUser(ctx, T, { roles, verified: false });

beforeAll(async () => {
  T = await makeTenant('ver');
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
});

describe('roll number + emailed code', () => {
  it('sends a code to the email ON RECORD (not the claimant) and verifies on the right code', async () => {
    await addRecord('22VR1A0501', { email: 'onrecord@college.ac.in', gradYear: 2026 });
    const u = await unverified();
    const start = await api(ctx, T.host, u.token)
      .post('/verification/roll')
      .send({ rollNumber: '22vr1a0501' });
    expect(start.body.data).toMatchObject({ status: 'code_sent', destination: 'o••••••@college.ac.in' });
    const code = codeFrom(ctx, 'onrecord@college.ac.in');
    expect(code).toMatch(/^\d{6}$/);
    expect(ctx.mailer.lastTo(u.email)?.subject ?? '').not.toContain(code);
    const ok = await api(ctx, T.host, u.token)
      .post('/verification/roll/confirm')
      .send({ challengeId: start.body.data.challengeId, code });
    expect(ok.body.data).toEqual({ verified: true });
    const me = await api(ctx, T.host, u.token).get('/me');
    expect(me.body.data.verified).toBe(true);
    expect(me.body.data.permissions).toContain('mentorship:request');
    const profile = await api(ctx, T.host, u.token).get('/me/profile');
    expect(profile.body.data.profile.fields).toMatchObject({ gradYear: 2026 });
  });

  it('the same record cannot be claimed twice', async () => {
    const u = await unverified();
    const r = await api(ctx, T.host, u.token).post('/verification/roll').send({ rollNumber: '22VR1A0501' });
    expect(r.body.data.status).toBe('no_match');
  });

  it('limits wrong codes per challenge and codes per day; codes are single-use and stored hashed', async () => {
    await addRecord('22VR1A0502', { email: 'brute@college.ac.in' });
    const u = await unverified();
    const start = await api(ctx, T.host, u.token)
      .post('/verification/roll')
      .send({ rollNumber: '22VR1A0502' });
    const real = codeFrom(ctx, 'brute@college.ac.in');
    const stored = await runInTenant(T._id, () =>
      OtpChallengeModel.findById(start.body.data.challengeId).lean(),
    );
    expect(JSON.stringify(stored)).not.toContain(real);
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      expect(
        (
          await api(ctx, T.host, u.token)
            .post('/verification/roll/confirm')
            .send({ challengeId: start.body.data.challengeId, code: wrong })
        ).status,
      ).toBe(400);
    expect(
      (
        await api(ctx, T.host, u.token)
          .post('/verification/roll/confirm')
          .send({ challengeId: start.body.data.challengeId, code: real })
      ).status,
    ).toBe(429);
    for (let i = 0; i < 4; i++)
      await api(ctx, T.host, u.token).post('/verification/roll').send({ rollNumber: '22VR1A0502' });
    expect(
      (await api(ctx, T.host, u.token).post('/verification/roll').send({ rollNumber: '22VR1A0502' })).status,
    ).toBe(429);
  });

  it('expired codes fail; another user cannot use my challenge', async () => {
    await addRecord('22VR1A0503', { email: 'expiry@college.ac.in' });
    const u = await unverified();
    const other = await unverified();
    const start = await api(ctx, T.host, u.token)
      .post('/verification/roll')
      .send({ rollNumber: '22VR1A0503' });
    const code = codeFrom(ctx, 'expiry@college.ac.in');
    expect(
      (
        await api(ctx, T.host, other.token)
          .post('/verification/roll/confirm')
          .send({ challengeId: start.body.data.challengeId, code })
      ).status,
    ).toBe(400);
    await runInTenant(T._id, () =>
      OtpChallengeModel.updateOne(
        { _id: start.body.data.challengeId },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      ),
    );
    expect(
      (
        await api(ctx, T.host, u.token)
          .post('/verification/roll/confirm')
          .send({ challengeId: start.body.data.challengeId, code })
      ).status,
    ).toBe(400);
  });

  it('alumni must also give the matching graduation year', async () => {
    await addRecord('15VR1A0301', { email: 'alum@college.ac.in', kind: 'alumni', gradYear: 2019 });
    const u = await unverified(['ALUMNI']);
    expect(
      (
        await api(ctx, T.host, u.token)
          .post('/verification/roll')
          .send({ rollNumber: '15VR1A0301', gradYear: 2020 })
      ).body.data.status,
    ).toBe('no_match');
    expect(
      (
        await api(ctx, T.host, u.token)
          .post('/verification/roll')
          .send({ rollNumber: '15VR1A0301', gradYear: 2019 })
      ).body.data.status,
    ).toBe('code_sent');
  });

  it('auto-verifies when the record’s email is my confirmed account email', async () => {
    const u = await unverified();
    await addRecord('22VR1A0504', { email: u.email });
    const r = await api(ctx, T.host, u.token).post('/verification/roll').send({ rollNumber: '22VR1A0504' });
    expect(r.body.data.status).toBe('verified');
  });

  it('sends the code to the mobile on record (WhatsApp first), and claims with it', async () => {
    await addRecord('22VR1A0505', { phone: '+919848022338' });
    const u = await unverified();
    const s = await api(ctx, T.host, u.token).post('/verification/roll').send({ rollNumber: '22VR1A0505' });
    expect(s.body.data).toMatchObject({ status: 'code_sent', destination: '+91 ••••• ••338' });
    const sent = phoneCodeFrom(ctx, '+919848022338');
    expect(sent.channel).toBe('whatsapp');
    const c = await api(ctx, T.host, u.token)
      .post('/verification/roll/confirm')
      .send({ challengeId: s.body.data.challengeId, code: sent.code });
    expect(c.body.data).toEqual({ verified: true });
  });

  it('reports no contact when the record has only a phone and no phone channel is set up', async () => {
    const bare = testApp({ sms: new DisabledSmsProvider(), whatsapp: new DisabledWhatsAppProvider() });
    await addRecord('22VR1A0506', { phone: '+919848022339' });
    const u = await unverified();
    expect(
      (await api(bare, T.host, u.token).post('/verification/roll').send({ rollNumber: '22VR1A0506' })).body
        .data.status,
    ).toBe('no_contact');
  });

  it('the list decides student vs alumni', async () => {
    await addRecord('14VR1A0101', { email: 'alumcase@college.ac.in', kind: 'alumni', gradYear: 2018 });
    const u = await unverified(['STUDENT']);
    const s = await api(ctx, T.host, u.token)
      .post('/verification/roll')
      .send({ rollNumber: '14VR1A0101', gradYear: 2018 });
    await api(ctx, T.host, u.token)
      .post('/verification/roll/confirm')
      .send({ challengeId: s.body.data.challengeId, code: codeFrom(ctx, 'alumcase@college.ac.in') });
    expect((await api(ctx, T.host, u.token).get('/me')).body.data.roles).toEqual(['ALUMNI']);
  });
});

describe('verification on email confirmation', () => {
  it('signing up with an email that is on the list verifies automatically', async () => {
    await addRecord('22VR1A0601', { email: 'listed.signup@college.ac.in' });
    await api(ctx, T.host)
      .post('/auth/signup')
      .send({
        name: 'Listed Signup',
        email: 'listed.signup@college.ac.in',
        password: 'quiet-river-lantern-91',
        intent: 'STUDENT',
        birthMonth: '2000-01',
        consents: ['account'],
      });
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.mailer.lastTo('listed.signup@college.ac.in')!.text)![1];
    await api(ctx, T.host).post('/auth/verify-email').send({ token });
    const u = await runInTenant(T._id, () =>
      UserModel.findOne({ email: 'listed.signup@college.ac.in' }).lean(),
    );
    expect(u?.verified).toBe(true);
  });

  it('an admin invite verifies the invitee when they confirm that exact email', async () => {
    const inv = await api(ctx, T.host, admin.token)
      .post('/admin/invites')
      .send({ emails: ['invited@example.org', admin.email] });
    expect(inv.body.data).toEqual({ sent: 1, existing: 1 });
    expect(ctx.mailer.lastTo('invited@example.org')?.text).toContain('/sign-up?email=invited%40example.org');
    await api(ctx, T.host)
      .post('/auth/signup')
      .send({
        name: 'Invited Person',
        email: 'invited@example.org',
        password: 'quiet-river-lantern-91',
        intent: 'ALUMNI',
        birthMonth: '2000-01',
        consents: ['account'],
      });
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.mailer.lastTo('invited@example.org')!.text)![1];
    await api(ctx, T.host).post('/auth/verify-email').send({ token });
    const u = await runInTenant(T._id, () => UserModel.findOne({ email: 'invited@example.org' }).lean());
    expect(u?.verified).toBe(true);
    const audit = await runInTenant(T._id, () =>
      AuditModel.findOne({ action: 'verification.approved', targetId: String(u!._id) }).lean(),
    );
    expect(audit?.meta).toMatchObject({ method: 'admin_invite' });
  });
});

describe('college ID fallback and admin queue', () => {
  it('stores the ID photo without metadata, queues it, and the admin approves', async () => {
    const u = await unverified();
    const jpeg = await jpegWithExif();
    expect(jpeg.toString('latin1')).toContain('SECRET-EXIF-MARKER');
    const r = await api(ctx, T.host, u.token)
      .post('/verification/id-card')
      .field('rollNumber', '23VR1A0701')
      .field('note', 'Lateral entry')
      .attach('photo', jpeg, 'id.jpg');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(
      (
        await api(ctx, T.host, u.token)
          .post('/verification/id-card')
          .field('rollNumber', '23VR1A0701')
          .attach('photo', jpeg, 'id.jpg')
      ).status,
    ).toBe(409);
    expect((await api(ctx, T.host, u.token).get('/verification')).body.data.request.status).toBe('pending');

    const q = await api(ctx, T.host, admin.token).get('/admin/verification');
    const item = q.body.data.find((x: { user: { id: string } }) => x.user.id === u.id);
    expect(item).toMatchObject({ rollNumber: '23VR1A0701', note: 'Lateral entry', listMatch: null });
    const img = await api(ctx, T.host, admin.token).get(`/files/${item.fileId}`);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toBe('private, no-store');
    expect(img.headers['content-security-policy']).toContain('sandbox');
    expect(Buffer.from(img.body).toString('latin1')).not.toContain('SECRET-EXIF-MARKER');
    // another student cannot see someone else's ID card
    const nosy = await makeUser(ctx, T, { roles: ['STUDENT'] });
    expect((await api(ctx, T.host, nosy.token).get(`/files/${item.fileId}`)).status).toBe(404);

    expect(
      (
        await api(ctx, T.host, admin.token)
          .post(`/admin/verification/${item.id}/decision`)
          .send({ decision: 'reject' })
      ).status,
    ).toBe(400);
    const ok = await api(ctx, T.host, admin.token)
      .post(`/admin/verification/${item.id}/decision`)
      .send({ decision: 'approve' });
    expect(ok.body.data.status).toBe('approved');
    expect((await api(ctx, T.host, u.token).get('/me')).body.data.verified).toBe(true);
    expect(ctx.mailer.lastTo(u.email)?.subject).toBe('You’re verified');
    const rec = await runInTenant(T._id, () => WhitelistModel.findOne({ rollNumber: '23VR1A0701' }).lean());
    expect(rec).toMatchObject({ status: 'claimed', claimedBy: new Types.ObjectId(u.id) });
  });

  it('rejects non-images and polyglots disguised as images', async () => {
    const u = await unverified();
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(
      (
        await api(ctx, T.host, u.token)
          .post('/verification/id-card')
          .field('rollNumber', '23VR1A0702')
          .attach('photo', html, 'id.png')
      ).status,
    ).toBe(415);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect(
      (
        await api(ctx, T.host, u.token)
          .post('/verification/id-card')
          .field('rollNumber', '23VR1A0702')
          .attach('photo', svg, 'id.jpg')
      ).status,
    ).toBe(415);
  });

  it('revoking verification frees the record for a correct claim', async () => {
    const victim = await unverified();
    await addRecord('22VR1A0801', { email: victim.email });
    await api(ctx, T.host, victim.token).post('/verification/roll').send({ rollNumber: '22VR1A0801' });
    expect((await api(ctx, T.host, admin.token).post(`/admin/users/${victim.id}/unverify`)).status).toBe(204);
    expect((await api(ctx, T.host, victim.token).get('/me')).body.data.verified).toBe(false);
    expect(
      (await runInTenant(T._id, () => WhitelistModel.findOne({ rollNumber: '22VR1A0801' }).lean()))?.status,
    ).toBe('unclaimed');
    expect((await api(ctx, T.host, admin.token).post(`/admin/users/${admin.id}/unverify`)).status).toBe(403);
  });
});

describe('company email badge', () => {
  it('verified alumni prove a work email; free webmail is refused; students cannot', async () => {
    const alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    expect(
      (
        await api(ctx, T.host, alum.token)
          .post('/verification/company')
          .send({ email: 'me@gmail.com', company: 'Nimbus Labs' })
      ).status,
    ).toBe(400);
    const s = await api(ctx, T.host, alum.token)
      .post('/verification/company')
      .send({ email: 'me@nimbuslabs.example', company: 'Nimbus Labs' });
    expect(s.body.data.destination).toBe('m•••@nimbuslabs.example');
    const ok = await api(ctx, T.host, alum.token)
      .post('/verification/company/confirm')
      .send({ challengeId: s.body.data.challengeId, code: codeFrom(ctx, 'me@nimbuslabs.example') });
    expect(ok.body.data).toEqual({ company: 'Nimbus Labs', domain: 'nimbuslabs.example' });
    expect((await api(ctx, T.host, alum.token).get('/me/profile')).body.data.profile.companyVerified).toEqual(
      { company: 'Nimbus Labs', domain: 'nimbuslabs.example' },
    );
    const student = await makeUser(ctx, T, { roles: ['STUDENT'] });
    expect(
      (
        await api(ctx, T.host, student.token)
          .post('/verification/company')
          .send({ email: 'x@acme.example', company: 'Acme' })
      ).status,
    ).toBe(403);
  });
});
