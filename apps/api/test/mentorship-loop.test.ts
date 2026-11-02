import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { acceptedSession, makeMentor, sendRequest, shiftBooking } from './mentorship-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { clearTenantCache } from '../src/modules/tenants/tenant.cache.js';
import { MentorshipRequestModel } from '../src/modules/mentorship/request.model.js';
import { MentorReviewModel } from '../src/modules/mentorship/review.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { replyStats, resetMentorStatsCache, scoreMatch } from '../src/modules/mentorship/mentors.service.js';
import { REMATCH_JOB, REQUEST_NUDGE_JOB } from '../src/modules/mentorship/requests.service.js';

const ctx = testApp();
let T: TestTenant;
let admin: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const HOUR = 3600_000;

/** Back-dated requests answered after `replyHours` (raw driver: createdAt is immutable in Mongoose). */
async function history(mentor: TestUser, replyHours: number, n: number, status = 'accepted') {
  const others = await Promise.all(Array.from({ length: n }, () => makeUser(ctx, T, { roles: ['STUDENT'] })));
  await runInTenant(T._id, async () => {
    for (const o of others) {
      const createdAt = new Date(Date.now() - 20 * 24 * HOUR);
      await MentorshipRequestModel.collection.insertOne({
        tenantId: T._id,
        menteeId: new Types.ObjectId(o.id),
        mentorId: new Types.ObjectId(mentor.id),
        sessionType: 'quick_chat',
        message: 'Old request',
        status,
        createdAt,
        updatedAt: createdAt,
        respondedAt: status === 'expired' ? null : new Date(createdAt.getTime() + replyHours * HOUR),
        expiresAt: new Date(createdAt.getTime() + 7 * 24 * HOUR),
        version: 1,
      });
    }
  });
}

const notified = (userId: string, type: string) =>
  runInTenant(T._id, () => NotificationModel.countDocuments({ userId, type }));
const quick = (mentee: TestUser, mentor: TestUser) => sendRequest(ctx, T, mentee, mentor, 'quick_chat');

beforeAll(async () => {
  T = await makeTenant('loop');
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
});
beforeEach(() => resetMentorStatsCache());

describe('nudges and rematch (B5)', () => {
  it('schedules a nudge at 24 h and a rematch at 48 h, and a reply cancels both', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const r = await quick(s, m);
    const id = r.body.data.id as string;
    const jobs = ctx.queue.delayed.filter((j) => j.data.requestId === id);
    const due = (name: string) => (jobs.find((j) => j.name === name)?.dueAt ?? 0) - Date.now();
    expect(due(REQUEST_NUDGE_JOB)).toBeGreaterThan(23.9 * HOUR);
    expect(due(REQUEST_NUDGE_JOB)).toBeLessThanOrEqual(24 * HOUR);
    expect(due(REMATCH_JOB)).toBeGreaterThan(47.9 * HOUR);
    await as(m).post(`/mentorship/requests/${id}/respond`).send({ action: 'accept' });
    expect(ctx.queue.delayed.filter((j) => j.data.requestId === id)).toEqual([]);
  });

  it('the nudge reaches the mentor once, and a job carrying an old version does nothing', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const id = (await quick(s, m)).body.data.id as string;
    await ctx.queue.enqueue(REQUEST_NUDGE_JOB, { tenantId: String(T._id), requestId: id, version: 7 });
    await ctx.queue.drain();
    expect(await notified(m.id, 'request_nudge')).toBe(0);
    await ctx.queue.runDelayed({ name: REQUEST_NUDGE_JOB });
    expect(await notified(m.id, 'request_nudge')).toBe(1);
    await ctx.queue.enqueue(REQUEST_NUDGE_JOB, { tenantId: String(T._id), requestId: id, version: 0 });
    await ctx.queue.drain();
    expect(await notified(m.id, 'request_nudge')).toBe(1);
    // A withdrawn request is a new version: its jobs no-op even if they still ran.
    await as(s).post(`/mentorship/requests/${id}/withdraw`);
    await ctx.queue.enqueue(REMATCH_JOB, { tenantId: String(T._id), requestId: id, version: 0 });
    await ctx.queue.drain();
    expect(await notified(s.id, 'request_rematch')).toBe(0);
  });

  it('suggests mentors likely to reply: not the one waited on, not full, not slow', async () => {
    const waited = await makeMentor(ctx, T, { profile: { company: 'Waited Co (demo)' } });
    const fast = await makeMentor(ctx, T, { profile: { company: 'Fast Co (demo)' } });
    const slow = await makeMentor(ctx, T, { profile: { company: 'Slow Co (demo)' } });
    const full = await makeMentor(ctx, T, {
      settings: { weeklyCap: 1 },
      profile: { company: 'Full Co (demo)' },
    });
    await history(fast, 2, 3);
    await history(slow, 100, 3);
    const other = await makeUser(ctx, T, { roles: ['STUDENT'] });
    expect((await quick(other, full)).status).toBe(201);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const id = (await quick(s, waited)).body.data.id as string;

    // Too early: the mentor gets two days.
    expect((await as(s).get(`/mentorship/requests/${id}/alternatives`)).status).toBe(409);
    await ctx.queue.runDelayed({ name: REMATCH_JOB });
    expect(await notified(s.id, 'request_rematch')).toBe(1);
    expect((await as(s).get(`/mentorship/requests/${id}`)).body.data.rematchOffered).toBe(true);
    const alt = await as(s).get(`/mentorship/requests/${id}/alternatives`);
    expect(alt.status).toBe(200);
    const ids = alt.body.data.map((x: { mentor: { userId: string } }) => x.mentor.userId);
    expect(ids).toContain(fast.id);
    expect(ids).not.toContain(waited.id);
    expect(ids).not.toContain(slow.id);
    expect(ids).not.toContain(full.id);
    expect(ids.length).toBeLessThanOrEqual(3);
    const fastMatch = alt.body.data.find((x: { mentor: { userId: string } }) => x.mentor.userId === fast.id);
    expect(fastMatch.reasons).toContainEqual({ kind: 'fast_reply' });
    // Only the mentee sees them.
    expect((await as(waited).get(`/mentorship/requests/${id}/alternatives`)).status).toBe(404);
  });

  it('one tap moves the same message to another mentor, outside the weekly limit', async () => {
    const waited = await makeMentor(ctx, T);
    const next = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'limits.mentorshipRequestsPerWeek': 1 } });
    clearTenantCache();
    try {
      const first = await quick(s, waited);
      const id = first.body.data.id as string;
      expect(
        (await as(s).post(`/mentorship/requests/${id}/rematch`).send({ mentorId: next.id })).status,
      ).toBe(409);
      await runInTenant(T._id, () =>
        MentorshipRequestModel.collection.updateOne(
          { _id: new Types.ObjectId(id) },
          { $set: { createdAt: new Date(Date.now() - 49 * HOUR) } },
        ),
      );
      expect(
        (await as(s).post(`/mentorship/requests/${id}/rematch`).send({ mentorId: waited.id })).status,
      ).toBe(400);
      const moved = await as(s).post(`/mentorship/requests/${id}/rematch`).send({ mentorId: next.id });
      expect(moved.status, JSON.stringify(moved.body)).toBe(201);
      expect(moved.body.data).toMatchObject({ status: 'pending', message: first.body.data.message });
      expect(moved.body.data.mentor.userId).toBe(next.id);
      expect((await as(s).get(`/mentorship/requests/${id}`)).body.data.status).toBe('withdrawn');
      const doc = await runInTenant(T._id, () => MentorshipRequestModel.findById(moved.body.data.id).lean());
      expect(String(doc?.rematchOf)).toBe(id);
      // The weekly limit (1) was used by the first request, not by the rematch: a new one is refused.
      const other = await makeMentor(ctx, T);
      expect((await quick(s, other)).status).toBe(409);
    } finally {
      await TenantModel.updateOne({ _id: T._id }, { $unset: { 'limits.mentorshipRequestsPerWeek': 1 } });
      clearTenantCache();
    }
  });
});

describe('mentor stats (B5)', () => {
  it('reply time and band appear only from three requests', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await history(m, 6, 2);
    let card = (await as(s).get(`/mentors/${m.id}`)).body.data;
    expect(card.stats).toMatchObject({ medianReplyHours: null, replyBand: null, sessionsCompleted: 0 });
    expect(card.stats.nextFreeSlot).toMatch(/^\d{4}-/);
    resetMentorStatsCache();
    await history(m, 10, 1);
    card = (await as(s).get(`/mentors/${m.id}`)).body.data;
    expect(card.stats).toMatchObject({ medianReplyHours: 6, replyBand: 'high' });
  });

  it('expired requests lower the band', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const answered = { status: 'accepted', createdAt: at, respondedAt: new Date(at.getTime() + HOUR) };
    const expired = { status: 'expired', createdAt: at, respondedAt: null };
    expect(replyStats([answered, answered, answered, expired]).replyBand).toBe('medium');
    expect(replyStats([answered, expired, expired, expired]).replyBand).toBe('low');
    expect(replyStats([answered, expired]).replyBand).toBeNull();
  });

  it('scoring adds a bounded reply-speed boost and a load penalty, deterministically', () => {
    const mentee = { branch: null, goals: [], targetCompanies: [], skills: [], languages: [] };
    const p = { userId: 'x', name: 'X', avatarFileId: null, fields: {} } as never;
    expect(scoreMatch(mentee, p).score).toBe(0);
    const fast = scoreMatch(mentee, p, { medianReplyHours: 5, pending: 0, weeklyCap: 5 });
    expect(fast).toEqual({ score: 10, reasons: [{ kind: 'fast_reply' }] });
    expect(scoreMatch(mentee, p, { medianReplyHours: 40, pending: 0, weeklyCap: 5 }).score).toBe(5);
    expect(scoreMatch(mentee, p, { medianReplyHours: 200, pending: 0, weeklyCap: 5 }).score).toBe(0);
    const base = { branch: 'CSE', goals: [], targetCompanies: [], skills: [], languages: [] };
    const cse = { userId: 'y', name: 'Y', avatarFileId: null, fields: { branch: 'CSE' } } as never;
    expect(scoreMatch(base, cse, { medianReplyHours: null, pending: 5, weeklyCap: 5 }).score).toBe(10);
    expect(scoreMatch(base, cse, { medianReplyHours: null, pending: 9, weeklyCap: 5 }).score).toBe(5);
  });
});

describe('public reviews (B5)', () => {
  async function completed(m: TestUser, s: TestUser) {
    const acc = await acceptedSession(ctx, T, s, m);
    await shiftBooking(T, acc.bookingId as string, -2 * HOUR);
    await as(s).get('/bookings?when=past');
    return acc.bookingId as string;
  }

  it('needs feedback first, is one per session, plain text, and carries the private rating', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const b = await completed(m, s);
    const text = 'Clear, kind advice <b>on</b> system design. Worth it.';
    expect((await as(s).post(`/bookings/${b}/review`).send({ text })).status).toBe(409);
    await as(s)
      .post(`/bookings/${b}/feedback`)
      .send({ rating: 4, tags: ['kind'], comment: 'Private note' });
    expect((await as(m).post(`/bookings/${b}/review`).send({ text })).status).toBe(404);
    const r = await as(s).post(`/bookings/${b}/review`).send({ text });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({
      rating: 4,
      text: 'Clear, kind advice on system design. Worth it.',
      sessionType: 'video_1on1',
      author: 'Test',
    });
    expect((await as(s).post(`/bookings/${b}/review`).send({ text })).status).toBe(409);
    const list = await as(s).get(`/mentors/${m.id}/reviews`);
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('Private note');
    expect(
      (
        await as(s)
          .post(`/bookings/${b}/review`)
          .send({ text: 'x'.repeat(281) })
      ).status,
    ).toBe(400);
  });

  it('rating shows from three reviews; a removed review leaves the list and the average', async () => {
    const m = await makeMentor(ctx, T);
    const ids: string[] = [];
    for (const rating of [5, 4, 3]) {
      const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
      const b = await completed(m, s);
      await as(s).post(`/bookings/${b}/feedback`).send({ rating, tags: [] });
      ids.push(
        (
          await as(s)
            .post(`/bookings/${b}/review`)
            .send({ text: `A useful session, ${rating}.` })
        ).body.data.id,
      );
      if (rating === 4) {
        const card = (await as(admin).get(`/mentors/${m.id}`)).body.data;
        expect(card.stats).toMatchObject({ rating: null, reviewCount: 2, sessionsCompleted: 2 });
      }
    }
    expect((await as(admin).get(`/mentors/${m.id}`)).body.data.stats).toMatchObject({
      rating: 4,
      reviewCount: 3,
    });
    const removed = await as(admin)
      .post('/admin/moderation/actions')
      .send({ targetType: 'review', targetId: ids[0], action: 'remove', reason: 'inappropriate' });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect((await as(admin).get(`/mentors/${m.id}/reviews`)).body.data).toHaveLength(2);
    expect((await as(admin).get(`/mentors/${m.id}`)).body.data.stats).toMatchObject({
      rating: null,
      reviewCount: 2,
    });
    const doc = await runInTenant(T._id, () => MentorReviewModel.findById(ids[0]).lean());
    expect(doc?.removal?.reason).toBe('inappropriate');
  });

  it('any member can report a review', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const b = await completed(m, s);
    await as(s).post(`/bookings/${b}/feedback`).send({ rating: 2, tags: [] });
    const id = (await as(s).post(`/bookings/${b}/review`).send({ text: 'Not what I expected at all.' })).body
      .data.id;
    const r = await as(m).post('/reports').send({ targetType: 'review', targetId: id, reason: 'harassment' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});
