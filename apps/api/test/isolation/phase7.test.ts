/**
 * MANDATORY tenant-isolation suite for Phase 7: points ledger, badges, opt-ins, rewards,
 * redemptions, events, RSVPs, event questions and votes, and analytics. Every cross-tenant read,
 * write, update, delete and search must fail. Blocks CI.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Model } from 'mongoose';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import type { GamificationService } from '../../src/modules/gamification/gamification.service.js';
import {
  GamificationPrefsModel,
  RedemptionModel,
  RewardModel,
  UserBadgeModel,
  XpEventModel,
} from '../../src/modules/gamification/gamification.model.js';
import {
  EventModel,
  EventQuestionModel,
  EventQuestionVoteModel,
  EventRsvpModel,
} from '../../src/modules/events/event.model.js';

const ctx = testApp();
const gamification = (ctx.app.locals.services as { gamification: GamificationService }).gamification;
let A: TestTenant, B: TestTenant;
let adminA: TestUser, staffA: TestUser, s1A: TestUser, s2A: TestUser, alumA: TestUser;
let adminB: TestUser, staffB: TestUser, sB: TestUser, alumB: TestUser;
let rewardA: string, redemptionA: string, eventA: string, questionA: string, xpA: string;
const a = (u: TestUser) => api(ctx, A.host, u.token);
const inB = (u: TestUser) => api(ctx, B.host, u.token);
const HOUR = 3_600_000;

beforeAll(async () => {
  A = await makeTenant('isogamea');
  B = await makeTenant('isogameb');
  [adminA, staffA, s1A, s2A, alumA] = [
    await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true }),
    await makeUser(ctx, A, { roles: ['FACULTY'] }),
    await makeUser(ctx, A, { roles: ['STUDENT'] }),
    await makeUser(ctx, A, { roles: ['STUDENT'] }),
    await makeUser(ctx, A, { roles: ['ALUMNI'] }),
  ];
  [adminB, staffB, sB, alumB] = [
    await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true }),
    await makeUser(ctx, B, { roles: ['FACULTY'] }),
    await makeUser(ctx, B, { roles: ['STUDENT'] }),
    await makeUser(ctx, B, { roles: ['ALUMNI'] }),
  ];
  await runInTenant(A._id, async () => {
    for (let i = 0; i < 3; i++)
      await gamification.award(s1A.id, 'event_attended', `iso-${i}`, { from: alumA.id });
    await gamification.award(alumA.id, 'session_mentored', 'iso-s', { from: s1A.id });
    await gamification.award(s1A.id, 'roadmap_step', 'iso-step');
  });
  await a(s1A).put('/me/progress/settings').send({ showOnLeaderboard: true, showOnWall: false });
  await a(alumA).put('/me/progress/settings').send({ showOnLeaderboard: false, showOnWall: true });
  rewardA = (
    await a(adminA)
      .post('/admin/rewards')
      .send({ title: 'Alpha Zyxquark mug', kind: 'goodies', track: 'xp', cost: 10, stock: 5 })
  ).body.data.id;
  redemptionA = (await a(s1A).post('/rewards/redeem').send({ rewardId: rewardA })).body.data.id;
  xpA = (await a(adminA).get(`/admin/users/${s1A.id}/xp`)).body.data.find(
    (e: { kind: string }) => e.kind === 'event_attended',
  ).id;
  const start = new Date(Date.now() + 0.5 * HOUR).toISOString();
  const end = new Date(Date.now() + 2 * HOUR).toISOString();
  eventA = (
    await a(staffA).post('/events').send({
      title: 'Alpha Zyxquark talk',
      description: 'Alpha-only event used by the isolation tests.',
      kind: 'talk',
      mode: 'online',
      startsAt: start,
      endsAt: end,
      onlineUrl: 'https://meet.example.org/alpha-secret-room',
    })
  ).body.data.id;
  await a(s1A).put(`/events/${eventA}/rsvp`).send({ going: true });
  questionA = (
    await a(s1A).post(`/events/${eventA}/questions`).send({ body: 'Alpha-only question about Zyxquark?' })
  ).body.data.id;
  await a(s2A).put(`/event-questions/${questionA}/vote`).send({ on: true });
  // B has its own data so empty results are meaningful.
  await inB(adminB)
    .post('/admin/rewards')
    .send({ title: 'Beta mug', kind: 'goodies', track: 'xp', cost: 10 });
});

describe('HTTP: nothing of college A is reachable from college B', () => {
  it('progress, leaderboards, wall and ledger', async () => {
    expect((await inB(sB).get('/me/progress')).body.data).toMatchObject({ xp: 0, impact: 0, badges: [] });
    expect((await inB(sB).get('/leaderboard')).body.data).toEqual([]);
    expect((await inB(sB).get('/wall-of-mentors')).body.data).toEqual({
      mentorOfTheMonth: null,
      mentors: [],
    });
    expect((await inB(adminB).get(`/admin/users/${s1A.id}/xp`)).body.data).toEqual([]);
    expect(
      (await inB(adminB).post(`/admin/xp/${xpA}/revoke`).send({ reason: 'Cross-college attempt' })).status,
    ).toBe(404);
    expect((await a(s1A).get('/me/progress')).body.data.xp).toBe(40);
  });

  it('rewards and redemptions', async () => {
    const list = JSON.stringify((await inB(sB).get('/rewards')).body.data);
    expect(list).not.toContain(rewardA);
    expect(list).not.toContain('Alpha');
    expect((await inB(sB).post('/rewards/redeem').send({ rewardId: rewardA })).status).toBe(404);
    expect((await inB(adminB).patch(`/admin/rewards/${rewardA}`).send({ active: false })).status).toBe(404);
    expect(
      (await inB(adminB).post(`/admin/redemptions/${redemptionA}/decide`).send({ decision: 'fulfil' }))
        .status,
    ).toBe(404);
    expect((await inB(sB).post(`/me/redemptions/${redemptionA}/cancel`).send({})).status).toBe(404);
    expect(JSON.stringify((await inB(adminB).get('/admin/redemptions')).body.data)).not.toContain(
      redemptionA,
    );
    expect((await a(s1A).get('/me/redemptions')).body.data[0]).toMatchObject({
      id: redemptionA,
      status: 'pending',
    });
  });

  it('events, RSVPs, check-in, calendar and Q&A', async () => {
    for (const p of [`/events/${eventA}`, `/events/${eventA}/ics`, `/events/${eventA}/questions`])
      expect((await inB(sB).get(p)).status, p).toBe(404);
    expect((await inB(staffB).get(`/events/${eventA}/attendees`)).status).toBe(404);
    expect((await inB(sB).put(`/events/${eventA}/rsvp`).send({ going: true })).status).toBe(404);
    expect((await inB(staffB).post(`/events/${eventA}/cancel`).send({})).status).toBe(404);
    expect(
      (await inB(staffB).post(`/events/${eventA}/check-in`).send({ userId: s1A.id, attended: true })).status,
    ).toBe(404);
    expect(
      (await inB(sB).post(`/events/${eventA}/questions`).send({ body: 'Beta question here?' })).status,
    ).toBe(404);
    expect((await inB(sB).put(`/event-questions/${questionA}/vote`).send({ on: true })).status).toBe(404);
    expect((await inB(staffB).patch(`/event-questions/${questionA}`).send({ status: 'hidden' })).status).toBe(
      404,
    );
    const listing = JSON.stringify((await inB(sB).get('/events')).body.data);
    expect(listing).not.toContain(eventA);
    expect(listing).not.toContain('alpha-secret-room');
    expect((await inB(sB).get('/search?q=Zyxquark')).body.data.events).toEqual([]);
    for (const targetType of ['event', 'event_question'])
      expect(
        (
          await inB(alumB)
            .post('/reports')
            .send({ targetType, targetId: targetType === 'event' ? eventA : questionA, reason: 'spam' })
        ).status,
      ).toBe(404);
    expect((await a(s1A).get(`/events/${eventA}`)).body.data).toMatchObject({ myRsvp: 'going', going: 1 });
    expect((await a(s1A).get(`/events/${eventA}/questions`)).body.data[0]).toMatchObject({ votes: 1 });
  });

  it('analytics only count the college’s own members', async () => {
    const v = (await inB(adminB).get('/admin/analytics')).body.data;
    expect(v.members).toMatchObject({ students: '<5', alumni: '<5' });
    const csv = (await inB(adminB).get('/admin/analytics/export?report=summary')).text;
    expect(csv).not.toContain('Alpha');
    expect(v.events).toEqual({ held: 0, rsvps: 0, attended: 0 });
  });

  it('a token from A never works on B', async () => {
    const r = await api(ctx, B.host, s1A.token).get('/me/progress');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });
});

describe('database layer: every Phase 7 collection is scoped', () => {
  const MODELS: [string, Model<unknown>][] = [
    ['XpEvent', XpEventModel as Model<unknown>],
    ['UserBadge', UserBadgeModel as Model<unknown>],
    ['GamificationPrefs', GamificationPrefsModel as Model<unknown>],
    ['Reward', RewardModel as Model<unknown>],
    ['Redemption', RedemptionModel as Model<unknown>],
    ['Event', EventModel as Model<unknown>],
    ['EventRsvp', EventRsvpModel as Model<unknown>],
    ['EventQuestion', EventQuestionModel as Model<unknown>],
    ['EventQuestionVote', EventQuestionVoteModel as Model<unknown>],
  ];

  it.each(MODELS)('%s: B cannot read, search, update or delete A’s documents', async (_name, model) => {
    const docA = await runInTenant(A._id, () => model.findOne({}).select('_id').lean<{ _id: unknown }>());
    expect(docA, 'fixture created a document in A').toBeTruthy();
    const id = docA?._id;
    await runInTenant(B._id, async () => {
      expect(await model.findById(id).lean()).toBeNull();
      expect(await model.countDocuments({ _id: id })).toBe(0);
      expect((await model.updateOne({ _id: id }, { $set: { updatedAt: new Date(0) } })).matchedCount).toBe(0);
      await model.updateMany({}, { $set: { updatedAt: new Date(0) } });
      expect((await model.deleteOne({ _id: id })).deletedCount).toBe(0);
    });
    const after = await runInTenant(A._id, () =>
      model.findById(id).select('updatedAt').lean<{ updatedAt: Date }>(),
    );
    expect(after?.updatedAt.getTime()).not.toBe(0);
  });

  it.each(MODELS)('%s: no tenant context, no access', async (_name, model) => {
    await expect(model.findOne({})).rejects.toThrow(/tenant context/i);
  });
});
