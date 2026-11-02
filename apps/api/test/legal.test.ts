import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { PRIVACY_NOTICE_VERSION } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { consentService } from '../src/modules/consent/consent.service.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { ConsentModel } from '../src/modules/consent/consent.model.js';
import { LEGAL_TEMPLATES } from '../src/modules/tenants/legal-templates.js';
import { LEGAL_TRANSLATIONS } from '../src/modules/tenants/legal-translations.js';

/** Legal pages and re-consent (build B14). */
const ctx = testApp();
let A: TestTenant, B: TestTenant;
let student: TestUser, admin: TestUser, faculty: TestUser, adminB: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const details = {
  legalName: 'Demo Educational Society (DEMO)',
  address: 'Demo address, Plot 1, Demo Nagar, Hyderabad 500001',
  grievanceOfficer: {
    name: 'Demo Officer',
    designation: 'Grievance officer (demo)',
    email: 'grievance@legal.example',
    phone: '+91 40 0000 0000',
  },
};
const signedUp = (u: TestUser) =>
  runInTenant(u.tenant._id, () => consentService.recordMany(new Types.ObjectId(u.id), ['account'], 'signup'));

beforeAll(async () => {
  A = await makeTenant('legal');
  B = await makeTenant('legalb');
  student = await makeUser(ctx, A, { roles: ['STUDENT'] });
  admin = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  faculty = await makeUser(ctx, A, { roles: ['FACULTY'] });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  await signedUp(student);
});

describe('legal pages', () => {
  it('are public, carry the college, and say when its details are missing', async () => {
    const r = await api(ctx, A.host).get('/legal/privacy');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ doc: 'privacy', version: PRIVACY_NOTICE_VERSION, complete: false });
    expect(r.body.data.body).toContain('LEGAL College of Engineering');
    expect(r.body.data.body).toContain('has not named its grievance officer');
    expect(r.body.data.body).not.toMatch(/\{\{\w+\}\}/);
    expect((await api(ctx, A.host).get('/legal/terms')).body.data.doc).toBe('terms');
    expect((await api(ctx, A.host).get('/legal/cookies')).status).toBe(400);
  });

  it('only the college’s admins publish its details', async () => {
    expect((await as(faculty).put('/admin/legal').send(details)).status).toBe(403);
    expect((await as(student).get('/admin/legal')).status).toBe(403);
    expect(
      (
        await as(admin)
          .put('/admin/legal')
          .send({ ...details, grievanceOfficer: { name: 'X' } })
      ).status,
    ).toBe(400);
  });
});

describe('publishing asks members to accept again', () => {
  it('before: a member who signed up has accepted the current notice', async () => {
    const me = await as(student).get('/me');
    expect(me.body.data.notice).toEqual({ version: PRIVACY_NOTICE_VERSION, accepted: true });
  });

  it('publishing fills the pages, bumps the version and is audited', async () => {
    const r = await as(admin).put('/admin/legal').send(details);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ legalName: details.legalName, version: 1 });
    const doc = await api(ctx, A.host).get('/legal/privacy');
    expect(doc.body.data).toMatchObject({ complete: true, version: `${PRIVACY_NOTICE_VERSION}+c1` });
    expect(doc.body.data.body).toContain(details.legalName);
    expect(doc.body.data.body).toContain('grievance@legal.example');
    expect(doc.body.data.grievanceOfficer).toMatchObject({ name: 'Demo Officer' });
    expect(
      await runInTenant(A._id, () => AuditModel.countDocuments({ action: 'tenant.legal_published' })),
    ).toBe(1);
  });

  it('after: the member must accept the new version, and only that version', async () => {
    const me = await as(student).get('/me');
    expect(me.body.data.notice).toEqual({ version: `${PRIVACY_NOTICE_VERSION}+c1`, accepted: false });
    expect((await as(student).post('/me/notice').send({ version: PRIVACY_NOTICE_VERSION })).status).toBe(409);
    const ok = await as(student)
      .post('/me/notice')
      .send({ version: `${PRIVACY_NOTICE_VERSION}+c1` });
    expect(ok.status).toBe(200);
    expect((await as(student).get('/me')).body.data.notice.accepted).toBe(true);
    expect(
      await runInTenant(A._id, () =>
        AuditModel.countDocuments({ action: 'consent.notice_accepted', actorId: student.id }),
      ),
    ).toBe(1);
  });

  it('a change in Settings is not an acceptance, and does not undo one (prompt 1b, R1)', async () => {
    // The student accepted +c1 above. Settings changes, including re-granting the required account
    // consent, must not send them back through the gate.
    for (const [purpose, granted] of [
      ['analytics_aggregate', false],
      ['analytics_aggregate', true],
      ['account', true],
    ] as const) {
      const r = await as(student).post('/me/consents').send({ purpose, granted });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    expect((await as(student).get('/me')).body.data.notice).toEqual({
      version: `${PRIVACY_NOTICE_VERSION}+c1`,
      accepted: true,
    });
    // The log records the notice in force at the change: the college's, not the platform's base.
    const last = await runInTenant(A._id, () =>
      ConsentModel.findOne({ userId: new Types.ObjectId(student.id), source: 'settings' })
        .sort({ _id: -1 })
        .lean(),
    );
    expect(last?.noticeVersion).toBe(`${PRIVACY_NOTICE_VERSION}+c1`);

    // A member who has not accepted +c1 is still asked after re-granting account in Settings.
    const late = await makeUser(ctx, A, { roles: ['STUDENT'] });
    await runInTenant(A._id, () =>
      ConsentModel.create({
        userId: new Types.ObjectId(late.id),
        purpose: 'account',
        version: 1,
        noticeVersion: PRIVACY_NOTICE_VERSION,
        granted: true,
        source: 'signup',
      }),
    );
    expect((await as(late).get('/me')).body.data.notice.accepted).toBe(false);
    expect((await as(late).post('/me/consents').send({ purpose: 'account', granted: true })).status).toBe(
      200,
    );
    expect((await as(late).get('/me')).body.data.notice).toEqual({
      version: `${PRIVACY_NOTICE_VERSION}+c1`,
      accepted: false,
    });
  });

  it('a member who signs up after publishing has accepted it already', async () => {
    const fresh = await makeUser(ctx, A, { roles: ['ALUMNI'] });
    await signedUp(fresh);
    expect((await as(fresh).get('/me')).body.data.notice).toEqual({
      version: `${PRIVACY_NOTICE_VERSION}+c1`,
      accepted: true,
    });
  });

  it('another college keeps its own pages and versions', async () => {
    const doc = await api(ctx, B.host).get('/legal/privacy');
    expect(doc.body.data.body).not.toContain(details.legalName);
    expect(doc.body.data.version).toBe(PRIVACY_NOTICE_VERSION);
    expect((await as(adminB).get('/admin/legal')).body.data).toMatchObject({ legalName: null, version: 0 });
  });
});

describe('translated legal texts (prompt 1b, R13)', () => {
  /**
   * Every published legal text, pinned to the notice version: changing any of them (or publishing a
   * translation) without bumping PRIVACY_NOTICE_VERSION fails here, so members always accept again.
   * After a bump, record the new fingerprint printed by the failure.
   */
  const FINGERPRINTS: Record<string, string> = { '2026-11-draft': '463347eef478c34e' };
  const fingerprint = () => {
    const published = Object.fromEntries(
      Object.entries(LEGAL_TRANSLATIONS)
        .filter(([, t]) => t.reviewed)
        .map(([l, t]) => [l, t.docs]),
    );
    return createHash('sha256')
      .update(JSON.stringify({ en: LEGAL_TEMPLATES, ...published }))
      .digest('hex')
      .slice(0, 16);
  };

  it('a change to any published text bumps the notice version', () => {
    expect(fingerprint(), `record it under ${PRIVACY_NOTICE_VERSION}`).toBe(
      FINGERPRINTS[PRIVACY_NOTICE_VERSION],
    );
  });

  it('each translation has the English placeholders and sections, and nothing else', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    const sections = (s: string) => s.split('\n').filter((l) => l.startsWith('## ')).length;
    for (const [lang, tr] of Object.entries(LEGAL_TRANSLATIONS))
      for (const doc of ['privacy', 'terms'] as const) {
        expect(placeholders(tr.docs[doc].body), `${lang} ${doc}`).toEqual(
          placeholders(LEGAL_TEMPLATES[doc].body),
        );
        expect(sections(tr.docs[doc].body), `${lang} ${doc}`).toBe(sections(LEGAL_TEMPLATES[doc].body));
      }
  });

  it('an unreviewed translation is not served: English, said to be English', async () => {
    for (const lang of ['te', 'hi']) {
      const r = await api(ctx, A.host).get(`/legal/privacy?lang=${lang}`);
      expect(r.body.data).toMatchObject({ language: 'en', translated: false });
      expect(r.body.data.body).toContain('Who is responsible');
    }
    expect((await api(ctx, A.host).get('/legal/privacy?lang=fr')).status).toBe(400);
  });

  it('once reviewed, members read their language, the English stays the reference, and the gate works', async () => {
    const te = LEGAL_TRANSLATIONS.te;
    te.reviewed = { by: 'test reviewer', on: '2026-11-02' };
    try {
      const r = await api(ctx, A.host).get('/legal/privacy?lang=te');
      expect(r.body.data).toMatchObject({ language: 'te', translated: true, title: 'గోప్యతా విధానం' });
      expect(r.body.data.body).toContain(details.legalName);
      expect(r.body.data.body).toContain('ఇమెయిల్: grievance@legal.example');
      expect(r.body.data.body).not.toMatch(/\{\{\w+\}\}/);
      // The same notice version in every language: accepting it in Telugu is accepting the notice.
      const en = (await api(ctx, A.host).get('/legal/privacy')).body.data;
      expect(r.body.data.version).toBe(en.version);
      const member = await makeUser(ctx, A, { roles: ['STUDENT'] });
      await signedUp(member);
      await runInTenant(A._id, () =>
        ConsentModel.create({
          userId: new Types.ObjectId(member.id),
          purpose: 'privacy_notice',
          version: 1,
          noticeVersion: 'older',
          granted: true,
          source: 'notice',
        }),
      );
      expect((await as(member).get('/me')).body.data.notice.accepted).toBe(false);
      expect((await as(member).post('/me/notice').send({ version: r.body.data.version })).status).toBe(200);
      expect((await as(member).get('/me')).body.data.notice.accepted).toBe(true);
      // Publishing it without a version bump is caught.
      expect(fingerprint()).not.toBe(FINGERPRINTS[PRIVACY_NOTICE_VERSION]);
    } finally {
      te.reviewed = null;
    }
  });
});
