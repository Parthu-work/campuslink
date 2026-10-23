import { beforeAll, describe, expect, it } from 'vitest';
import type { AdminOverviewView } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeSubject } from './study-fixtures.js';

const ctx = testApp();
let T: TestTenant, U: TestTenant;
let admin: TestUser, faculty: TestUser, tpo: TestUser, student: TestUser, otherAdmin: TestUser;
const as = (u: TestUser, t = T) => api(ctx, t.host, u.token);

beforeAll(async () => {
  T = await makeTenant('overview');
  U = await makeTenant('overview2');
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  otherAdmin = await makeUser(ctx, U, { roles: ['COLLEGE_ADMIN'], mfa: true });
  // A contributor upload waiting for review in the faculty member's subject.
  const subject = (await makeSubject(ctx, T, faculty, { code: 'OVR1' })).id;
  const alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  expect(
    (await as(admin).put(`/study/subjects/${subject}/contributors`).send({ userId: alum.id, grant: true }))
      .status,
  ).toBe(200);
  const up = await as(alum)
    .post('/study/materials')
    .field('subjectId', subject)
    .field('rights', 'true')
    .attach('file', Buffer.from('# Demo notes\n\nA DFA reads one symbol at a time (demo).\n'), 'notes.md');
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  await ctx.queue.drain();
});

describe('Admin › Overview', () => {
  it('a college admin sees every queue, with member counts suppressed', async () => {
    const r = await as(admin).get('/admin/overview');
    expect(r.status).toBe(200);
    const v = r.body.data as AdminOverviewView;
    expect(v.members).toEqual({ active: 5, unverified: 0, suspended: 0 });
    expect(v.activity).not.toBeNull();
    expect(v.verification).toEqual({ pending: 0 });
    expect(v.moderation).toEqual({ reports: 0, pendingQuestions: 0, appeals: 0, heldItems: 0 });
    expect(v.roadmapReviews).toEqual({ pending: 0 });
    expect(v.materialReviews).toEqual({ pending: 1 });
    expect(v.imports).toEqual({ running: 0, failedThisWeek: 0 });
    expect(v.ai).toMatchObject({ status: { answers: false }, budgetPercent: null });
  });

  it('staff see only what they may act on; students are refused', async () => {
    const f = (await as(faculty).get('/admin/overview')).body.data as AdminOverviewView;
    expect(f).toMatchObject({
      members: null,
      activity: null,
      verification: null,
      imports: null,
      ai: null,
      moderation: { reports: 0 },
      roadmapReviews: { pending: 0 },
      materialReviews: { pending: 1 },
    });
    const t = (await as(tpo).get('/admin/overview')).body.data as AdminOverviewView;
    // Placement officers see college-wide activity (analytics:tenant), and no uploads of others' subjects.
    expect(t.activity).not.toBeNull();
    expect(t.materialReviews).toEqual({ pending: 0 });
    expect((await as(student).get('/admin/overview')).status).toBe(403);
  });

  it('counts never cross colleges', async () => {
    const v = (await as(otherAdmin, U).get('/admin/overview')).body.data as AdminOverviewView;
    expect(v.materialReviews).toEqual({ pending: 0 });
    expect(v.members).toEqual({ active: '<5', unverified: 0, suspended: 0 });
  });
});
