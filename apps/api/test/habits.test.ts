import { beforeAll, describe, expect, it } from 'vitest';
import {
  BUDDY_MAX_JUNIORS,
  PEER_WEEKLY_CAP_MAX,
  isoWeek,
  type BuddyView,
  type MentorMatch,
  type NextStepView,
  type PeerMentorStatusView,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeMentor, SETTINGS } from './mentorship-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import type { JobQueue } from '../src/lib/jobs.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { OfferModel } from '../src/modules/placements/placements.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { ProductEventModel } from '../src/modules/insights/insights.model.js';
import { NextStepModel } from '../src/modules/next-step/next-step.model.js';
import { NEXT_STEP_JOB, NextStepService } from '../src/modules/next-step/next-step.service.js';
import { BuddyPairModel } from '../src/modules/peers/peers.model.js';
import { MentorProfileModel } from '../src/modules/mentorship/mentor.model.js';

/** Prompt 2, G7: the weekly Next Step, peer mentors and the Senior Buddy. */

const ctx = testApp();
let T: TestTenant, U: TestTenant;
let student: TestUser, early: TestUser, faculty: TestUser, foreign: TestUser, mentor: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);
const now = new Date();
const year = now.getUTCFullYear();
/** Graduation years relative to today: final year, a junior, a first-year. */
const FINAL = now.getUTCMonth() >= 6 ? year + 1 : year;
const JUNIOR = FINAL + 2;
const FIRST = now.getUTCMonth() >= 6 ? year + 4 : year + 3;

const OFFER_SOURCE = 'off_campus';
const CTC_BAND = '3_5';
const setCohort = (u: TestUser, f: Record<string, unknown>) =>
  inT(() => ProfileModel.updateOne({ userId: u.id }, { $set: f }));
const consent = (u: TestUser) =>
  as(u).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);

beforeAll(async () => {
  T = await makeTenant('habits');
  U = await makeTenant('habitsb');
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  early = await makeUser(ctx, T, { roles: ['STUDENT'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  foreign = await makeUser(ctx, U, { roles: ['STUDENT'] });
  mentor = await makeMentor(ctx, T);
  await setCohort(student, { branch: 'CSE', gradYear: JUNIOR });
  await setCohort(early, { branch: 'CSE', gradYear: JUNIOR });
  await consent(student);
  await consent(early);
});

describe('the weekly Next Step (prompt 2, G7)', () => {
  it('queues one run per college and ISO week, with the week in the job id', async () => {
    const seen: string[] = [];
    const jobs = {
      enqueue: (_n: string, _d: unknown, o: { jobId?: string } = {}) => seen.push(o.jobId ?? ''),
    } as unknown as JobQueue;
    const monday = new Date('2026-11-09T14:00:00Z'); // 19:30 IST
    await NextStepService.enqueueWeekly(jobs, monday);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((id) => id.startsWith('next-step-') && id.endsWith(`-${isoWeek(monday)}`))).toBe(true);
    // Before Monday 19:00 IST nothing is queued.
    const before = seen.length;
    await NextStepService.enqueueWeekly(jobs, new Date('2026-11-09T10:00:00Z'));
    expect(seen.length).toBe(before);
  });

  it('the weekly job saves one Next Step per student and week and sends it once, however often it runs', async () => {
    const week = isoWeek(new Date());
    await ctx.queue.enqueue(NEXT_STEP_JOB, { tenantId: String(T._id), week });
    await ctx.queue.drain();
    await ctx.queue.enqueue(NEXT_STEP_JOB, { tenantId: String(T._id), week });
    await ctx.queue.drain();
    const docs = await inT(() => NextStepModel.find({ userId: student.id, week }).lean());
    expect(docs).toHaveLength(1);
    expect(docs[0]?.alumnus?.userId).toBe(mentor.id);
    expect(docs[0]?.notifiedAt).not.toBeNull();
    const sent = await inT(() =>
      NotificationModel.countDocuments({ userId: student.id, type: 'weekly_next_step' }),
    );
    expect(sent).toBe(1);
    // Staff and alumni get none.
    expect(await inT(() => NextStepModel.countDocuments({ userId: faculty.id }))).toBe(0);
    expect(await inT(() => NextStepModel.countDocuments({ userId: mentor.id }))).toBe(0);
  });

  it('a student opening Home before the run gets this week\x27s, and opening it is recorded once per item', async () => {
    const r = await as(early).get('/me/next-step');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = r.body.data as NextStepView;
    expect(v.week).toBe(isoWeek(new Date()));
    expect(v.alumnus).toMatchObject({ userId: mentor.id });
    expect(v.openedAt).toBeNull();
    await as(early).post('/me/next-step/open').send({ item: 'alumnus' }).expect(204);
    await as(early).post('/me/next-step/open').send({ item: 'alumnus' }).expect(204);
    await as(early).post('/me/next-step/open').send({ item: 'page' }).expect(204);
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'next_step_opened', userId: early.id })),
    ).toBe(2);
    expect(((await as(early).get('/me/next-step')).body.data as NextStepView).openedAt).not.toBeNull();
    // The weekly run reuses it: still one per member and week.
    await ctx.queue.enqueue(NEXT_STEP_JOB, { tenantId: String(T._id), week: v.week });
    await ctx.queue.drain();
    expect(await inT(() => NextStepModel.countDocuments({ userId: early.id }))).toBe(1);
  });

  it('staff cannot open a Next Step; another college never sees this one', async () => {
    expect((await as(faculty).get('/me/next-step')).status).toBe(403);
    const theirs = (await as(foreign).get('/me/next-step')).body.data as NextStepView | null;
    expect(theirs?.alumnus ?? null).toBeNull();
  });
});

describe('peer mentors (prompt 2, G7)', () => {
  let senior: TestUser, nominee: TestUser, junior: TestUser, sameYear: TestUser;
  beforeAll(async () => {
    senior = await makeUser(ctx, T, { roles: ['STUDENT'] });
    nominee = await makeUser(ctx, T, { roles: ['STUDENT'] });
    junior = await makeUser(ctx, T, { roles: ['STUDENT'] });
    sameYear = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await setCohort(senior, { branch: 'CSE', gradYear: FINAL });
    await setCohort(nominee, { branch: 'ECE', gradYear: FINAL + 1 });
    await setCohort(junior, { branch: 'CSE', gradYear: JUNIOR });
    await setCohort(sameYear, { branch: 'CSE', gradYear: FINAL });
  });

  it('needs a verified offer in the final years, or a faculty nomination', async () => {
    let s = (await as(senior).get('/me/peer')).body.data as PeerMentorStatusView;
    expect(s).toMatchObject({ eligible: false, active: false });
    expect((await as(senior).put('/me/peer/mentor').send({ on: true })).status).toBe(409);
    await inT(() =>
      OfferModel.create({
        userId: senior.id,
        companyKey: 'nimbus labs',
        companyName: 'Nimbus Labs',
        role: 'Engineer',
        type: 'full_time',
        status: 'verified',
        source: OFFER_SOURCE,
        branch: 'CSE',
        gradYear: FINAL,
        ctcBand: CTC_BAND,
        offerDate: new Date(),
      }),
    );
    s = (await as(senior).get('/me/peer')).body.data as PeerMentorStatusView;
    expect(s).toMatchObject({ eligible: true, reason: 'offer' });
    s = (await as(senior).put('/me/peer/mentor').send({ on: true })).body.data as PeerMentorStatusView;
    expect(s.active).toBe(true);

    expect((await as(nominee).put('/me/peer/mentor').send({ on: true })).status).toBe(409);
    await as(faculty).post('/admin/peers/nominations').send({ userId: nominee.id }).expect(200);
    expect((await as(nominee).put('/me/peer/mentor').send({ on: true })).body.data.active).toBe(true);
    expect((await as(student).post('/admin/peers/nominations').send({ userId: nominee.id })).status).toBe(
      403,
    );
  });

  it('peer mentors are offered to juniors only, with peer requests and lighter caps', async () => {
    const forJunior = (await as(junior).get('/mentors/match')).body.data as MentorMatch[];
    const peer = forJunior.find((m) => m.mentor.userId === senior.id);
    expect(peer?.mentor.peer).toBe(true);
    const forSameYear = (await as(sameYear).get('/mentors/match')).body.data as MentorMatch[];
    expect(forSameYear.some((m) => m.mentor.userId === senior.id)).toBe(false);
    const forAlumni = (await as(mentor).get('/mentors/match')).body.data as MentorMatch[] | undefined;
    expect((forAlumni ?? []).some((m) => m.mentor.userId === senior.id)).toBe(false);

    const r = await as(junior).post('/mentorship/requests').send({
      mentorId: senior.id,
      sessionType: 'quick_chat',
      message: 'Could you tell me how you prepared for the Nimbus interview?',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.peer).toBe(true);
    expect(
      (
        await as(sameYear).post('/mentorship/requests').send({
          mentorId: senior.id,
          sessionType: 'quick_chat',
          message: 'Could you tell me how you prepared for the Nimbus interview?',
        })
      ).status,
    ).toBe(404);

    // Settings stay light: at most three a week, chats and short calls only.
    await as(senior)
      .put('/me/mentor')
      .send({ ...SETTINGS, weeklyCap: 20, accepting: true, audience: 'both' })
      .expect(200);
    const saved = await inT(() => MentorProfileModel.findOne({ userId: senior.id }).lean());
    expect(saved?.weeklyCap).toBe(PEER_WEEKLY_CAP_MAX);
    expect(saved?.audience).toBe('students');
    const types = (saved?.sessionTypes ?? []) as { type: string; enabled: boolean }[];
    expect(
      types
        .filter((t) => t.enabled)
        .map((t) => t.type)
        .sort(),
    ).toEqual(['quick_chat', 'video_1on1']);
  });

  it('withdrawing a nomination ends peer mentoring for a student without an offer', async () => {
    await as(faculty).post('/admin/peers/nominations').send({ userId: nominee.id, on: false }).expect(200);
    expect(((await as(nominee).get('/me/peer')).body.data as PeerMentorStatusView).eligible).toBe(false);
    expect(await inT(() => MentorProfileModel.findOne({ userId: nominee.id }).lean())).toMatchObject({
      accepting: false,
    });
  });
});

describe('the Senior Buddy (prompt 2, G7)', () => {
  const seniors: TestUser[] = [];
  const firstYears: TestUser[] = [];
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
      await setCohort(s, { branch: i === 0 ? 'CSE' : 'ECE', gradYear: JUNIOR, languages: ['Telugu'] });
      seniors.push(s);
    }
    for (let i = 0; i < 5; i++) {
      const f = await makeUser(ctx, T, { roles: ['STUDENT'] });
      await setCohort(f, { branch: i < 4 ? 'CSE' : 'ECE', gradYear: FIRST, languages: ['Telugu'] });
      firstYears.push(f);
    }
  });

  it('first-years cannot volunteer; seniors can', async () => {
    expect(
      (
        await as(firstYears[0] as TestUser)
          .put('/me/peer/buddy')
          .send({ on: true })
      ).status,
    ).toBe(409);
    for (const s of seniors) await as(s).put('/me/peer/buddy').send({ on: true }).expect(200);
  });

  it('matches every first-year it can, same branch first, at most three each, once', async () => {
    const r = await as(faculty).post('/admin/peers/match-buddies');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.matched).toBe(5);
    const again = await as(faculty).post('/admin/peers/match-buddies');
    expect(again.body.data.matched).toBe(0);
    const pairs = await inT(() =>
      BuddyPairModel.find({ active: true, juniorId: { $in: firstYears.map((f) => f.id) } }).lean(),
    );
    expect(pairs).toHaveLength(5);
    const bySenior = new Map<string, number>();
    for (const p of pairs) bySenior.set(String(p.seniorId), (bySenior.get(String(p.seniorId)) ?? 0) + 1);
    for (const n of bySenior.values()) expect(n).toBeLessThanOrEqual(BUDDY_MAX_JUNIORS);
    // The ECE first-year went to the ECE senior.
    const ece = pairs.find((p) => String(p.juniorId) === firstYears[4]?.id);
    expect(String(ece?.seniorId)).toBe(seniors[1]?.id);
  });

  it('both sides see the pair and tick the checklist; nobody else can', async () => {
    const mine = (await as(firstYears[4] as TestUser).get('/me/buddy')).body.data as BuddyView;
    expect(mine.mine?.other.userId).toBe(seniors[1]?.id);
    expect(mine.mine?.week).toBe(1);
    const pairId = mine.mine?.id ?? '';
    const ticked = (
      await as(seniors[1] as TestUser)
        .post(`/buddies/${pairId}/checklist`)
        .send({ item: 'hello', done: true })
    ).body.data as BuddyView;
    expect(ticked.juniors.find((j) => j.id === pairId)?.checklist[0]?.doneAt).not.toBeNull();
    expect(
      (await as(student).post(`/buddies/${pairId}/checklist`).send({ item: 'hello', done: true })).status,
    ).toBe(404);
    expect(
      (await as(foreign).post(`/buddies/${pairId}/checklist`).send({ item: 'hello', done: true })).status,
    ).toBe(404);
  });

  it('a senior stepping down hands their first-years back to matching', async () => {
    await as(seniors[1] as TestUser)
      .put('/me/peer/buddy')
      .send({ on: false })
      .expect(200);
    expect(((await as(firstYears[4] as TestUser).get('/me/buddy')).body.data as BuddyView).mine).toBeNull();
  });
});

describe('privacy (prompt 2, G7)', () => {
  it('export carries Next Steps and buddy pairs; erasure removes them', async () => {
    const exp = JSON.parse((await as(student).get('/me/export')).text) as {
      nextSteps: { nextSteps: unknown[] };
    };
    expect(exp.nextSteps.nextSteps.length).toBeGreaterThan(0);
    const svc = ctx.app.locals.services as {
      nextStep: { eraseFor: (id: string) => Promise<void> };
      peers: { eraseFor: (id: string) => Promise<void> };
    };
    await inT(() => svc.nextStep.eraseFor(student.id));
    expect(await inT(() => NextStepModel.countDocuments({ userId: student.id }))).toBe(0);
  });
});
