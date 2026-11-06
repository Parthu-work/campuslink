import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  DEFAULT_READINESS_WEIGHTS,
  READINESS_NUDGE_BATCH_MAX,
  type ReadinessBoardView,
  type ReadinessView,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { AcademicRecordModel } from '../src/modules/placements/placements.model.js';
import { ResumeModel } from '../src/modules/resumes/resume.model.js';
import { InterviewModel } from '../src/modules/interviews/interview.model.js';
import { BookingModel } from '../src/modules/sessions/booking.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { ProductEventModel } from '../src/modules/insights/insights.model.js';
import { ReadinessNudgeModel } from '../src/modules/readiness/readiness.model.js';
import type { ReadinessService } from '../src/modules/readiness/readiness.service.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { invalidateTenant } from '../src/modules/tenants/tenant.cache.js';

/**
 * Prompt 2, G5: the student's own score, the placement cell's board (suppressed counts, minors
 * never ranked), the "needs help" list, the nudge and its cool-off, weights, export and privacy.
 */

const ctx = testApp();
const services = ctx.services as unknown as { readiness: ReadinessService };
let T: TestTenant;
let tpo: TestUser, faculty: TestUser, alum: TestUser, ready: TestUser, low: TestUser, minor: TestUser;
let noRecord: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);
const DAY = 86_400_000;
let seq = 0;

async function student(
  name: string,
  branch: string,
  gradYear: number,
  record?: { cgpa: number; activeBacklogs?: number },
  opts: { minor?: boolean } = {},
) {
  const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
  const roll = `23RD1A${String(++seq).padStart(4, '0')}`;
  await inT(async () => {
    await WhitelistModel.create({
      rollNumber: roll,
      name,
      branch,
      gradYear,
      kind: 'student',
      source: 'import',
      status: 'claimed',
      claimedBy: u.id,
      claimedAt: new Date(),
    });
    await ProfileModel.updateOne(
      { userId: u.id },
      {
        $set: {
          name,
          branch,
          gradYear,
          ...(opts.minor ? { minorUntil: new Date(Date.now() + 300 * DAY) } : {}),
        },
      },
    );
    if (opts.minor)
      await UserModel.updateOne({ _id: u.id }, { $set: { adultOn: new Date(Date.now() + 300 * DAY) } });
    if (record)
      await AcademicRecordModel.create({
        rollNumber: roll,
        cgpa: record.cgpa,
        activeBacklogs: record.activeBacklogs ?? 0,
        historyBacklogs: 0,
        source: 'import',
        verifiedAt: new Date(),
      });
  });
  return u;
}

const ats = (score: number) => ({
  score,
  checks: [
    { id: 'name', ok: true, points: 6, earned: 6 },
    { id: 'contact', ok: false, points: 8, earned: 0 },
    { id: 'bullets', ok: false, points: 6, earned: 0 },
  ],
  keywords: null,
  gaps: [],
  pages: 1,
  version: 1,
  checkedAt: new Date().toISOString(),
});

async function openDrive(over: Record<string, unknown> = {}) {
  const c = await as(tpo)
    .post('/admin/placements/drives')
    .send({
      companyName: 'Readiness Labs (demo)',
      title: 'Graduate engineer',
      roles: [{ title: 'Engineer', ctcMinLpa: 5, ctcMaxLpa: 7, location: 'Hyderabad', type: 'full_time' }],
      mode: 'on_campus',
      venue: 'Seminar hall',
      driveDate: new Date(Date.now() + 10 * DAY).toISOString(),
      registrationCloseAt: new Date(Date.now() + 3 * DAY).toISOString(),
      eligibility: { branches: ['CSE'], gradYears: [2027], minCgpa: 6.5, maxActiveBacklogs: 0 },
      questions: [],
      rounds: [{ name: 'HR', kind: 'hr' }],
      resumeRequired: false,
      ...over,
    });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const o = await as(tpo).post(`/admin/placements/drives/${c.body.data.id}/status`).send({ status: 'open' });
  expect(o.status, JSON.stringify(o.body)).toBe(200);
  await ctx.queue.drain();
  return c.body.data.id as string;
}

let driveId = '';
beforeAll(async () => {
  T = await makeTenant('readytest');
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  ready = await student('Ready Student', 'CSE', 2027, { cgpa: 8.4 });
  low = await student('Low Student', 'CSE', 2027, { cgpa: 7 });
  minor = await student('Minor Student', 'CSE', 2027, { cgpa: 7 }, { minor: true });
  noRecord = await student('Unrecorded Student', 'CSE', 2027);
  for (let i = 0; i < 3; i++) await student(`Cse Student ${i}`, 'CSE', 2027, { cgpa: 6 });
  for (let i = 0; i < 2; i++) await student(`Ece Student ${i}`, 'ECE', 2027, { cgpa: 8 });
  await inT(async () => {
    for (const [u, score] of [
      [ready, 90],
      [low, 40],
    ] as const)
      await ResumeModel.create({
        userId: u.id,
        title: 'Core IT',
        content: { basics: {} },
        atsReport: ats(score),
      });
    for (const at of [1, 2, 3])
      await InterviewModel.create({
        userId: ready.id,
        track: 'hr',
        difficulty: 'easy',
        language: 'en',
        mode: 'text',
        status: 'completed',
        planned: 5,
        summary: {
          overall: '',
          strengths: [],
          improve: [],
          averages: { clarity: 5, structure: 5, correctness: null, communication: 5 },
          source: 'rules',
        },
        completedAt: new Date(Date.now() - at * DAY),
      });
    for (const at of [10, 20])
      await BookingModel.create({
        requestId: new Types.ObjectId(),
        mentorId: alum.id,
        menteeId: ready.id,
        participants: [alum.id, ready.id],
        sessionType: 'quick_chat',
        start: new Date(Date.now() - at * DAY - 3600_000),
        end: new Date(Date.now() - at * DAY),
        status: 'completed',
        holds: [`${ready.id}|done-${at}`],
        room: `room-${at}`,
        completedAt: new Date(Date.now() - at * DAY),
      });
  });
  // Product events are recorded only for members who allow aggregate analytics (B9).
  await as(low).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);
  driveId = await openDrive();
});

describe('the student’s own score', () => {
  it('is the sum of its components, counts practice (G4), and suggests next steps', async () => {
    const r = await as(low).get('/me/readiness');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = r.body.data as ReadinessView;
    expect(v.components.reduce((n, c) => n + c.points, 0)).toBe(v.score);
    // Practice (G4) is registered: no practice yet scores 0, with a next step.
    expect(v.components.find((c) => c.id === 'practice')).toMatchObject({
      status: 'scored',
      points: 0,
      facts: { sets: 0, accuracy: null },
      next: { id: 'do_practice' },
    });
    expect(v.renormalised).toBe(false);
    expect(v.components.find((c) => c.id === 'resume')).toMatchObject({
      status: 'scored',
      facts: { ats: 40 },
    });
    expect(v.next[0]).toMatchObject({ component: 'resume', id: 'fix_resume_issues', count: 2 });
    expect(v.next.some((a) => a.id === 'do_mock' && (a.gain ?? 0) > 0)).toBe(true);

    const best = (await as(ready).get('/me/readiness')).body.data as ReadinessView;
    expect(best.score).toBeGreaterThan(v.score);
    expect(best.components.find((c) => c.id === 'mentorship')).toMatchObject({ facts: { sessions: 2 } });
    expect(best.components.find((c) => c.id === 'interviews')).toMatchObject({
      facts: { mocks: 3, average: 5 },
    });
    // CGPA 8.4 meets the only drive cut-off this college set (6.5).
    expect(best.components.find((c) => c.id === 'eligibility')).toMatchObject({
      facts: { drives: 1, meets: 1 },
    });
  });

  it('only students have one; nobody reads another member’s score', async () => {
    expect((await as(alum).get('/me/readiness')).status).toBe(403);
    expect((await as(faculty).get('/me/readiness')).status).toBe(403);
    expect((await as(tpo).get('/me/readiness')).status).toBe(403);
    // There is no route to another member's score: the board is for the placement cell only.
    expect((await as(low).get('/admin/readiness')).status).toBe(403);
    expect((await as(low).get(`/readiness/${ready.id}`)).status).toBe(404);
  });
});

describe('the readiness board', () => {
  it('faculty and the TPO see it; only the TPO changes weights, nudges and exports', async () => {
    expect((await as(faculty).get('/admin/readiness')).status).toBe(200);
    expect((await as(alum).get('/admin/readiness')).status).toBe(403);
    expect(
      (
        await as(faculty)
          .post('/admin/readiness/nudge')
          .send({ userIds: [low.id] })
      ).status,
    ).toBe(403);
    expect((await as(faculty).get('/admin/readiness/export')).status).toBe(403);
    expect(
      (
        await as(faculty)
          .put('/admin/readiness/config')
          .send({ weights: DEFAULT_READINESS_WEIGHTS, threshold: 50, closingDays: 7 })
      ).status,
    ).toBe(403);
    expect((await as(faculty).get('/admin/readiness/config')).status).toBe(200);
  });

  it('shows the distribution by batch and branch with small counts hidden, never counting minors', async () => {
    const b = (await as(tpo).get('/admin/readiness')).body.data as ReadinessBoardView;
    const cse = b.groups.find((g) => g.branch === 'CSE' && g.gradYear === 2027);
    const ece = b.groups.find((g) => g.branch === 'ECE' && g.gradYear === 2027);
    // Ready, Low, Unrecorded and three more CSE students: six (the minor is not counted).
    expect(cse?.students).toBe(6);
    expect(typeof cse?.median).toBe('number');
    expect(cse?.bands.every((n) => n === 0 || n === '<5' || (typeof n === 'number' && n >= 5))).toBe(true);
    expect(ece).toMatchObject({ students: '<5', median: null });
    expect(b.students).toBe(8);
    expect(b.components.find((c) => c.id === 'practice')).toMatchObject({ status: 'scored' });
    // One branch only.
    const only = (await as(tpo).get('/admin/readiness?branch=ECE')).body.data as ReadinessBoardView;
    expect(only.groups.map((g) => g.branch)).toEqual(['ECE']);
  });

  it('lists students below the threshold whose next drive closes soon: never a minor or an ineligible student', async () => {
    const b = (await as(tpo).get('/admin/readiness')).body.data as ReadinessBoardView;
    const ids = b.needsHelp.map((r) => r.userId);
    expect(ids).toContain(low.id);
    expect(ids).not.toContain(minor.id);
    // No academic record: not eligible for a drive with a CGPA cut-off, so no drive closes for them.
    expect(ids).not.toContain(noRecord.id);
    // Above the threshold.
    expect(ids).not.toContain(ready.id);
    const row = b.needsHelp.find((r) => r.userId === low.id);
    expect(row).toMatchObject({
      name: 'Low Student',
      drive: { id: driveId },
      nudgeable: true,
      lastNudgedAt: null,
    });
    expect(row?.score).toBeLessThan(b.threshold);
  });
});

describe('nudges', () => {
  it('nudges listed students once in the cool-off, skips the rest, and records it', async () => {
    const stranger = new Types.ObjectId().toString();
    const r = await as(tpo)
      .post('/admin/readiness/nudge')
      .send({ userIds: [low.id, minor.id, ready.id, stranger] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toEqual({ sent: 1, coolingOff: 0, notListed: 3 });
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: low.id, type: 'readiness_nudge' })),
    ).toBe(1);
    const n = await inT(() => NotificationModel.findOne({ userId: low.id, type: 'readiness_nudge' }).lean());
    // First name, company, drive and time only: never the score.
    expect(Object.keys(n?.data ?? {}).sort()).toEqual(['company', 'driveId', 'name', 'start']);
    expect(n?.data).toMatchObject({ name: 'Low', company: 'Readiness Labs (demo)', driveId });
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: minor.id, type: 'readiness_nudge' })),
    ).toBe(0);
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'readiness_nudged', userId: low.id })),
    ).toBe(1);
    expect(await inT(() => AuditModel.countDocuments({ action: 'readiness.nudged', actorId: tpo.id }))).toBe(
      1,
    );

    // The nudge cap: a second nudge in the same week does not go out, from anyone.
    const again = await as(tpo)
      .post('/admin/readiness/nudge')
      .send({ userIds: [low.id] });
    expect(again.body.data).toEqual({ sent: 0, coolingOff: 1, notListed: 0 });
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: low.id, type: 'readiness_nudge' })),
    ).toBe(1);
    const b = (await as(tpo).get('/admin/readiness')).body.data as ReadinessBoardView;
    expect(b.needsHelp.find((x) => x.userId === low.id)).toMatchObject({ nudgeable: false });
    expect(b.needsHelp.find((x) => x.userId === low.id)?.lastNudgedAt).toBeTruthy();
  });

  it('two nudges at once still send one', async () => {
    const other = await student('Racing Student', 'CSE', 2027, { cgpa: 6.8 });
    const results = await Promise.all(
      [0, 1].map(() => inT(() => services.readiness.nudge({ userId: tpo.id } as never, [other.id], {}))),
    );
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(
      await inT(() => NotificationModel.countDocuments({ userId: other.id, type: 'readiness_nudge' })),
    ).toBe(1);
  });

  it('refuses a batch over the limit', async () => {
    const ids = Array.from({ length: READINESS_NUDGE_BATCH_MAX + 1 }, () => new Types.ObjectId().toString());
    expect((await as(tpo).post('/admin/readiness/nudge').send({ userIds: ids })).status).toBe(400);
  });
});

describe('weights', () => {
  it('the college sets them (audited); zero everywhere is refused; the score follows', async () => {
    const zero = Object.fromEntries(Object.keys(DEFAULT_READINESS_WEIGHTS).map((k) => [k, 0]));
    expect(
      (await as(tpo).put('/admin/readiness/config').send({ weights: zero, threshold: 50, closingDays: 7 }))
        .status,
    ).toBe(400);
    const resumeOnly = { ...zero, resume: 50 };
    const r = await as(tpo)
      .put('/admin/readiness/config')
      .send({ weights: resumeOnly, threshold: 60, closingDays: 5 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ threshold: 60, closingDays: 5, weights: resumeOnly });
    const v = (await as(low).get('/me/readiness')).body.data as ReadinessView;
    // Only the résumé counts: the score is its ATS score.
    expect(v.score).toBe(40);
    expect(v.renormalised).toBe(false);
    expect(v.components.filter((c) => c.status === 'off').length).toBe(5);
    expect(await inT(() => AuditModel.countDocuments({ action: 'readiness.config_changed' }))).toBe(1);
    await as(tpo)
      .put('/admin/readiness/config')
      .send({ weights: DEFAULT_READINESS_WEIGHTS, threshold: 50, closingDays: 7 });
  });
});

describe('export', () => {
  it('one row per student, minors never, audited', async () => {
    const r = await as(tpo).get('/admin/readiness/export?format=csv');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    const text = r.text;
    expect(text).toContain('Low Student');
    expect(text).toContain('resume points');
    expect(text).not.toContain('Minor Student');
    expect(
      await inT(() => AuditModel.countDocuments({ action: 'readiness.exported', actorId: tpo.id })),
    ).toBe(1);
    const x = await as(tpo).get('/admin/readiness/export?format=xlsx').buffer(true);
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
  });
});

describe('privacy and the feature switch', () => {
  it('exports and erases the nudges a member was sent', async () => {
    const out = await inT(() => services.readiness.exportFor(low.id));
    expect(out.nudges).toHaveLength(1);
    expect(out.nudges[0]?.driveId).toBe(driveId);
    await inT(() => services.readiness.eraseFor(low.id));
    expect(await inT(() => ReadinessNudgeModel.countDocuments({ userId: low.id }))).toBe(0);
  });

  it('is off with placements', async () => {
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'features.placements': false } });
    invalidateTenant(T.slug);
    const off = await as(low).get('/me/readiness');
    const board = await as(tpo).get('/admin/readiness');
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'features.placements': true } });
    invalidateTenant(T.slug);
    expect([off.status, off.body.error?.code]).toEqual([403, 'FEATURE_DISABLED']);
    expect(board.body.error?.code).toBe('FEATURE_DISABLED');
  });
});
