import { beforeAll, describe, expect, it } from 'vitest';
import { academicYear, suppress } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { csvCell, toCsv } from '../src/modules/analytics/analytics.service.js';

const ctx = testApp();
let T: TestTenant;
let tpo: TestUser, faculty: TestUser, student: TestUser, alum: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);

beforeAll(async () => {
  T = await makeTenant('analyticstest');
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  const students = await Promise.all(
    Array.from({ length: 6 }, () => makeUser(ctx, T, { roles: ['STUDENT'] })),
  );
  student = students[0] as TestUser;
  await runInTenant(T._id, () =>
    ProfileModel.updateMany(
      { userId: { $in: [...students.map((s) => s.id), alum.id] } },
      { $set: { branch: 'CSE', gradYear: 2027 } },
    ),
  );
  // Two ECE students: a small group.
  for (let i = 0; i < 2; i++) {
    const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await runInTenant(T._id, () =>
      ProfileModel.updateOne({ userId: u.id }, { $set: { branch: 'ECE', gradYear: 2026 } }),
    );
  }
  for (let i = 0; i < 3; i++)
    await as(alum)
      .post('/posts')
      .send({ kind: 'text', body: `Demo analytics post ${i}` });
});

describe('helpers', () => {
  it('suppresses small counts, labels the academic year and makes CSV safe', () => {
    expect([suppress(0), suppress(1), suppress(4), suppress(5)]).toEqual([0, '<5', '<5', 5]);
    expect(academicYear(new Date('2026-10-16T00:00:00Z'))).toBe('2026-27');
    expect(academicYear(new Date('2027-03-01T00:00:00Z'))).toBe('2026-27');
    expect(academicYear(new Date('2027-06-01T00:00:00Z'))).toBe('2027-28');
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell(null)).toBe('""');
    expect(toCsv([['a', 'b,c']])).toBe('"a","b,c"\r\n');
  });
});

describe('dashboard', () => {
  it('is for staff only; TPOs get the college view, faculty the cohort view', async () => {
    expect((await as(student).get('/admin/analytics')).status).toBe(403);
    expect((await as(alum).get('/admin/analytics')).status).toBe(403);
    const college = (await as(tpo).get('/admin/analytics')).body.data;
    expect(college.scope).toBe('college');
    expect(college.members).toMatchObject({ students: 8, alumni: '<5' });
    expect(college.active.last30).toBeGreaterThanOrEqual(5);
    expect(college.sessions.completed).toHaveLength(6);
    const cohort = (await as(faculty).get('/admin/analytics')).body.data;
    expect(cohort.scope).toBe('cohort');
    expect(cohort.active).toEqual({ last7: 0, last30: 0 });
    expect(cohort.sessions.averageRating).toBeNull();
  });

  it('suppresses small groups in the branch and batch table', async () => {
    const rows = (await as(tpo).get('/admin/analytics')).body.data.engagement;
    const cse = rows.find((r: { branch: string }) => r.branch === 'CSE');
    const ece = rows.find((r: { branch: string }) => r.branch === 'ECE');
    expect(cse).toMatchObject({ gradYear: 2027, members: 7, posts: '<5', roadmapSteps: 0 });
    expect(ece).toMatchObject({ gradYear: 2026, members: '<5' });
    // No member-level data anywhere in the response.
    const body = JSON.stringify((await as(tpo).get('/admin/analytics')).body.data);
    expect(body).not.toContain(student.id);
    expect(body).not.toContain('@');
  });

  it('filters by branch and batch, and validates the query', async () => {
    const v = (await as(tpo).get('/admin/analytics?branch=CSE&gradYear=2027')).body.data;
    expect(v.members.students).toBe(6);
    expect(v.members.alumni).toBe('<5');
    expect(v.engagement).toHaveLength(1);
    expect((await as(tpo).get('/admin/analytics?months=99')).status).toBe(400);
    expect((await as(tpo).get('/admin/analytics?branch=XYZ')).status).toBe(400);
  });
});

describe('exports', () => {
  it('exports CSV for report exporters only, and audits it', async () => {
    expect((await as(faculty).get('/admin/analytics/export?report=summary')).status).toBe(403);
    const r = await as(tpo).get('/admin/analytics/export?report=engagement');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toMatch(
      /attachment; filename="engagement-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(r.text).toContain('"Branch","Batch","Members"');
    expect(r.text).toContain('Counts under 5 are shown as <5');
    for (const report of ['summary', 'mentorship', 'referrals', 'events'])
      expect((await as(tpo).get(`/admin/analytics/export?report=${report}`)).status).toBe(200);
    expect((await as(tpo).get('/admin/analytics/export?report=everything')).status).toBe(400);
    expect(await runInTenant(T._id, () => AuditModel.countDocuments({ action: 'report.exported' }))).toBe(5);
  });
});
