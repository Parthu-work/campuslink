import { beforeAll, describe, expect, it } from 'vitest';
import { ctcBand, type AdminOverviewView } from '@campuslink/shared';
import { runInTenant } from '../src/lib/context.js';
import { OfferModel } from '../src/modules/placements/placements.model.js';
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
    // Prompt 3, U9: each queue says when its oldest item arrived (none waiting: null).
    expect(v.verification).toEqual({ pending: 0, since: null });
    expect(v.moderation).toEqual({ reports: 0, pendingQuestions: 0, appeals: 0, heldItems: 0, since: null });
    expect(v.roadmapReviews).toEqual({ pending: 0, since: null });
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

  it('Today (prompt 3, U9): the drive closing first, the next drive, and the oldest offer waiting', async () => {
    const DAY = 86_400_000;
    const drive = async (title: string, closesInHours: number, heldInDays: number) => {
      const c = await as(tpo)
        .post('/admin/placements/drives')
        .send({
          companyName: `Overview Corp ${title} (demo)`,
          title,
          roles: [{ title: 'Analyst', ctcMinLpa: 5, ctcMaxLpa: 6, location: 'Hyderabad', type: 'full_time' }],
          mode: 'virtual',
          venue: '',
          driveDate: new Date(Date.now() + heldInDays * DAY).toISOString(),
          registrationCloseAt: new Date(Date.now() + closesInHours * 3_600_000).toISOString(),
          eligibility: { branches: [], gradYears: [] },
          questions: [],
          rounds: [{ name: 'Interview', kind: 'technical' }],
          resumeRequired: false,
        });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      expect(
        (await as(tpo).post(`/admin/placements/drives/${c.body.data.id}/status`).send({ status: 'open' }))
          .status,
      ).toBe(200);
      return c.body.data.id as string;
    };
    const later = await drive('Later drive', 30, 2);
    const first = await drive('First drive', 6, 4);
    await drive('Next week drive', 24 * 6, 8);
    const reportedAt = new Date(Date.now() - 2 * DAY);
    await runInTenant(T._id, () =>
      OfferModel.create({
        userId: student.id,
        companyKey: 'overview offer co',
        companyName: 'Overview Offer Co (demo)',
        role: 'Analyst',
        ctcLpa: 6,
        ctcBand: ctcBand(6),
        offerDate: reportedAt,
        type: 'full_time',
        source: 'off_campus',
        status: 'reported',
        createdAt: reportedAt,
      }),
    );
    const t = (await as(tpo).get('/admin/overview')).body.data as AdminOverviewView;
    expect(t.placements?.closingSoon).toBe(2);
    expect(t.placements?.soonest).toMatchObject({
      id: first,
      title: 'First drive',
      company: 'Overview Corp First drive (demo)',
    });
    // The next drive to be held is the one in two days, whichever closes first.
    expect(t.placements?.next).toMatchObject({ id: later, title: 'Later drive' });
    expect(t.offers).toMatchObject({ pending: 1 });
    expect(Date.parse(t.offers?.since ?? '')).toBeLessThanOrEqual(Date.now() - DAY);
    // Another college sees none of it.
    const u = (await as(otherAdmin, U).get('/admin/overview')).body.data as AdminOverviewView;
    expect(JSON.stringify(u)).not.toContain('Overview Corp');
  });

  it('counts never cross colleges', async () => {
    const v = (await as(otherAdmin, U).get('/admin/overview')).body.data as AdminOverviewView;
    expect(v.materialReviews).toEqual({ pending: 0 });
    expect(v.members).toEqual({ active: '<5', unverified: 0, suspended: 0 });
  });
});
