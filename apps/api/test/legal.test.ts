import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { PRIVACY_NOTICE_VERSION } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { consentService } from '../src/modules/consent/consent.service.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';

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
