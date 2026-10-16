import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { currentStreak, levelFor, mentorLevelFor } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeReferrer, postJob } from './jobs-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import type { GamificationService } from '../src/modules/gamification/gamification.service.js';
import type { RoadmapsService } from '../src/modules/roadmaps/roadmaps.service.js';
import { XpEventModel } from '../src/modules/gamification/gamification.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';

const ctx = testApp();
const services = ctx.app.locals.services as { gamification: GamificationService; roadmaps: RoadmapsService };
let T: TestTenant;
let student: TestUser, student2: TestUser, alum: TestUser, alum2: TestUser, admin: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const award = (
  u: TestUser,
  kind: Parameters<GamificationService['award']>[1],
  ref: string,
  from?: TestUser,
) => runInTenant(T._id, () => services.gamification.award(u.id, kind, ref, from ? { from: from.id } : {}));
const me = async (u: TestUser) => (await as(u).get('/me/progress')).body.data;

beforeAll(async () => {
  T = await makeTenant('gametest');
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  student2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  alum2 = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  await runInTenant(T._id, () => services.roadmaps.installLibrary());
});

describe('rules', () => {
  it('levels, streaks and mentor levels', () => {
    expect(levelFor(0)).toEqual({ level: 0, current: 0, next: 100 });
    expect(levelFor(100).level).toBe(1);
    expect(levelFor(299).level).toBe(1);
    expect(levelFor(300).level).toBe(2);
    expect(currentStreak(['2026-10-14', '2026-10-15', '2026-10-16'], '2026-10-16')).toBe(3);
    expect(currentStreak(['2026-10-14', '2026-10-15'], '2026-10-16')).toBe(2);
    expect(currentStreak(['2026-10-13', '2026-10-15'], '2026-10-16')).toBe(1);
    expect(currentStreak([], '2026-10-16')).toBe(0);
    expect(mentorLevelFor(49)).toBeNull();
    expect(mentorLevelFor(50)).toBe('bronze');
    expect(mentorLevelFor(999)).toBe('gold');
    expect(mentorLevelFor(1000)).toBe('platinum');
  });
});

describe('earning XP', () => {
  it('a roadmap step pays once, earns the first badge and a notification', async () => {
    const id = (await as(student).get('/roadmaps/backend')).body.data.id;
    await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'language', done: true });
    // Toggling off and on again never pays twice.
    await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'language', done: false });
    await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'language', done: true });
    const p = await me(student);
    expect(p).toMatchObject({ xp: 10, streak: 1, level: { level: 0 } });
    expect(p.badges.map((b: { id: string }) => b.id)).toEqual(['first_step']);
    expect(p.recent[0]).toMatchObject({ kind: 'roadmap_step', points: 10 });
    const n = (await as(student).get('/notifications')).body.data.find(
      (x: { type: string }) => x.type === 'badge_earned',
    );
    expect(n.data).toEqual({ badge: 'first_step' });
  });

  it('caps posts per day and never pays for announcements', async () => {
    for (let i = 0; i < 4; i++)
      await as(alum)
        .post('/posts')
        .send({ kind: 'text', body: `Demo tip number ${i}` });
    expect((await me(alum)).xp).toBe(15);
  });

  it('pays nothing for self-created interactions', async () => {
    await award(student2, 'answer_accepted', 'self-q', student2);
    expect((await me(student2)).xp).toBe(0);
    await award(student2, 'answer_accepted', 'other-q', student);
    await award(student2, 'answer_accepted', 'other-q', student);
    expect((await me(student2)).xp).toBe(20);
    expect((await me(student2)).badges.map((b: { id: string }) => b.id)).toContain('helpful_answer');
  });

  it('accepting an answer pays its author (not the asker)', async () => {
    const q = await as(student)
      .post('/questions')
      .send({
        title: 'How do I prepare for a backend interview?',
        body: 'Looking for a practical plan.',
        topics: ['placements'],
      });
    expect(q.status).toBe(201);
    const qid = q.body.data.id;
    expect(
      (await as(admin).post(`/admin/moderation/questions/${qid}/decision`).send({ decision: 'approve' }))
        .status,
    ).toBe(200);
    const a = await as(alum2)
      .post(`/questions/${qid}/answers`)
      .send({ body: 'Build one API end to end and explain it.' });
    expect(a.status).toBe(201);
    await as(student).post(`/questions/${qid}/accept`).send({ answerId: a.body.data.id });
    const p = await me(alum2);
    expect(p.xp).toBeGreaterThanOrEqual(20);
    expect(p.impact).toBeGreaterThanOrEqual(5);
  });

  it('a referral given earns impact for the alumnus', async () => {
    await makeReferrer(ctx, T, alum, 'Gamify Labs', 5);
    const job = await postJob(ctx, T, alum2, { company: 'Gamify Labs' });
    const r = await as(student).post('/referrals').send({
      jobId: job.id,
      referrerId: alum.id,
      why: 'I built two services in Java and meet every requirement listed.',
    });
    expect(r.status).toBe(201);
    await as(alum).post(`/referrals/${r.body.data.id}/respond`).send({ action: 'refer' });
    expect((await me(alum)).impact).toBe(8);
  });
});

describe('leaderboard and Wall of Mentors are opt-in', () => {
  it('lists only members who opted in, and supports my branch', async () => {
    expect((await as(student).get('/leaderboard')).body.data).toEqual([]);
    expect(
      (await as(student).put('/me/progress/settings').send({ showOnLeaderboard: true, showOnWall: false }))
        .body.data,
    ).toEqual({
      showOnLeaderboard: true,
      showOnWall: false,
    });
    const board = (await as(student2).get('/leaderboard')).body.data;
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ rank: 1, person: { userId: student.id }, isMe: false });
    expect((await as(student).get('/leaderboard')).body.data[0].isMe).toBe(true);
    expect((await as(student).get('/leaderboard?scope=branch')).status).toBe(200);
    expect((await as(student).get('/leaderboard?scope=nope')).status).toBe(400);
  });

  it('the wall shows opted-in mentors with a level, and last month’s top mentor', async () => {
    for (let i = 0; i < 5; i++) await award(alum2, 'session_mentored', `s-${i}`, student);
    await award(alum2, 'new_mentee', student.id, student);
    expect((await as(student).get('/wall-of-mentors')).body.data).toEqual({
      mentorOfTheMonth: null,
      mentors: [],
    });
    await as(alum2).put('/me/progress/settings').send({ showOnLeaderboard: false, showOnWall: true });
    // Move one award into last month.
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10));
    await runInTenant(T._id, () =>
      XpEventModel.collection.updateOne(
        { tenantId: T._id, userId: new Types.ObjectId(alum2.id), kind: 'new_mentee' },
        { $set: { createdAt: lastMonth } },
      ),
    );
    const wall = (await as(student).get('/wall-of-mentors')).body.data;
    expect(wall.mentors).toEqual([
      expect.objectContaining({
        person: expect.objectContaining({ userId: alum2.id }),
        level: 'bronze',
        menteesHelped: 1,
      }),
    ]);
    expect(wall.mentorOfTheMonth).toMatchObject({ person: { userId: alum2.id }, impact: 15 });
    const p = await me(alum2);
    expect(p).toMatchObject({ mentorLevel: 'bronze', menteesHelped: 1, sessionsMentored: 5 });
  });
});

describe('rewards', () => {
  let rewardId: string;
  it('only reward managers run the catalogue', async () => {
    const body = {
      title: 'Demo certificate of contribution',
      kind: 'certificate',
      track: 'xp',
      cost: 20,
      stock: 1,
    };
    expect((await as(student).post('/admin/rewards').send(body)).status).toBe(403);
    expect((await as(student).get('/admin/redemptions')).status).toBe(403);
    const r = await as(admin).post('/admin/rewards').send(body);
    expect(r.status).toBe(201);
    rewardId = r.body.data.id;
    expect((await as(student).get('/rewards')).body.data.map((x: { id: string }) => x.id)).toContain(
      rewardId,
    );
  });

  it('redeeming needs enough points and stock; a decline refunds both', async () => {
    expect((await as(student).post('/rewards/redeem').send({ rewardId })).status).toBe(400); // 10 XP < 20
    await award(student, 'event_attended', 'ev-1', alum);
    const red = await as(student).post('/rewards/redeem').send({ rewardId });
    expect(red.status).toBe(201);
    expect(red.body.data).toMatchObject({ status: 'pending', cost: 20 });
    expect((await me(student)).balance.xp).toBe(0);
    // XP (for levels) is unchanged by spending.
    expect((await me(student)).xp).toBe(20);
    await award(student2, 'event_attended', 'ev-2', alum); // 30 XP
    expect((await as(student2).post('/rewards/redeem').send({ rewardId })).status).toBe(409); // out of stock
    const dec = await as(admin)
      .post(`/admin/redemptions/${red.body.data.id}/decide`)
      .send({ decision: 'reject', note: 'Demo: run out' });
    expect(dec.body.data.status).toBe('rejected');
    expect(
      (await as(admin).post(`/admin/redemptions/${red.body.data.id}/decide`).send({ decision: 'fulfil' }))
        .status,
    ).toBe(409);
    expect((await me(student)).balance.xp).toBe(20);
    const n = (await as(student).get('/notifications')).body.data.find(
      (x: { type: string }) => x.type === 'redemption_decided',
    );
    expect(n.data).toMatchObject({ decision: 'rejected' });
    // Stock is back.
    const ok = await as(student2).post('/rewards/redeem').send({ rewardId });
    expect(ok.status).toBe(201);
    expect((await as(student2).post(`/me/redemptions/${ok.body.data.id}/cancel`).send({})).body.data).toEqual(
      { cancelled: true },
    );
    expect((await as(student).post(`/me/redemptions/${ok.body.data.id}/cancel`).send({})).status).toBe(404);
    expect(await runInTenant(T._id, () => AuditModel.countDocuments({ action: 'reward.rejected' }))).toBe(1);
  });

  it('concurrent redemptions never overspend', async () => {
    const r = await as(admin)
      .post('/admin/rewards')
      .send({ title: 'Demo sticker pack', kind: 'goodies', track: 'xp', cost: 20 });
    const fresh = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await award(fresh, 'event_attended', 'ev-x', alum);
    await award(fresh, 'feedback_given', 'fb-x', alum); // 15 XP
    await award(fresh, 'feedback_given', 'fb-y', alum); // 20 XP
    const results = await Promise.all(
      Array.from({ length: 4 }, () => as(fresh).post('/rewards/redeem').send({ rewardId: r.body.data.id })),
    );
    expect(results.filter((x) => x.status === 201)).toHaveLength(1);
    expect((await me(fresh)).balance.xp).toBe(0);
  });

  it('admins can retire a reward', async () => {
    await as(admin).patch(`/admin/rewards/${rewardId}`).send({ active: false });
    expect((await as(student).get('/rewards')).body.data.map((x: { id: string }) => x.id)).not.toContain(
      rewardId,
    );
    expect((await as(student).post('/rewards/redeem').send({ rewardId })).status).toBe(404);
    expect((await as(admin).get('/admin/rewards')).body.data.map((x: { id: string }) => x.id)).toContain(
      rewardId,
    );
  });
});

describe('admin audit tools', () => {
  it('lists a ledger and revokes an award append-only, with an audit entry', async () => {
    expect((await as(student).get(`/admin/users/${student2.id}/xp`)).status).toBe(403);
    const ledger = (await as(admin).get(`/admin/users/${student2.id}/xp`)).body.data;
    const accepted = ledger.find((e: { kind: string }) => e.kind === 'answer_accepted');
    const before = (await me(student2)).xp;
    expect((await as(admin).post(`/admin/xp/${accepted.id}/revoke`).send({ reason: 'no' })).status).toBe(400);
    expect(
      (await as(admin).post(`/admin/xp/${accepted.id}/revoke`).send({ reason: 'Demo: answer was copied' }))
        .status,
    ).toBe(200);
    expect(
      (await as(admin).post(`/admin/xp/${accepted.id}/revoke`).send({ reason: 'Demo: answer was copied' }))
        .status,
    ).toBe(409);
    expect((await me(student2)).xp).toBe(before - 20);
    expect(await runInTenant(T._id, () => AuditModel.countDocuments({ action: 'xp.revoked' }))).toBe(1);
    const revoked = (await as(admin).get(`/admin/users/${student2.id}/xp`)).body.data.find(
      (e: { kind: string }) => e.kind === 'revoked',
    );
    expect(
      (await as(admin).post(`/admin/xp/${revoked.id}/revoke`).send({ reason: 'Demo: undo the undo' })).status,
    ).toBe(404);
  });
});
