import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import {
  ALL_DAY,
  REQUEST_TEXT,
  SETTINGS,
  acceptedSession,
  makeMentor,
  sendRequest,
  shiftBooking,
  slotsOf,
} from './mentorship-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { clearTenantCache } from '../src/modules/tenants/tenant.cache.js';
import { MentorshipRequestModel } from '../src/modules/mentorship/request.model.js';
import { BookingModel } from '../src/modules/sessions/booking.model.js';
import { computeSlots, holdsFor } from '../src/modules/mentorship/slots.js';
import { normaliseCompany, scoreMatch } from '../src/modules/mentorship/mentors.service.js';
import { EXPIRE_JOB } from '../src/modules/mentorship/requests.service.js';
import { COMPLETE_JOB, REMINDER_JOB } from '../src/modules/sessions/sessions.service.js';
import { zonedToUtc } from '../src/lib/timezone.js';

const ctx = testApp();
let T: TestTenant;
let mentor: TestUser, student: TestUser, tpo: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const notifications = async (u: TestUser) =>
  (await as(u).get('/notifications')).body.data as { type: string; data: Record<string, string> }[];

beforeAll(async () => {
  T = await makeTenant('mentora');
  mentor = await makeMentor(ctx, T);
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
});

describe('timezone and slot maths', () => {
  it('converts wall-clock times, and refuses times skipped by daylight saving', () => {
    expect(zonedToUtc('2026-10-19', 10 * 60, 'Asia/Kolkata')?.toISOString()).toBe('2026-10-19T04:30:00.000Z');
    expect(zonedToUtc('2026-03-08', 2 * 60 + 30, 'America/New_York')).toBeNull();
    expect(zonedToUtc('2026-03-08', 3 * 60, 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T07:00:00.000Z',
    );
  });

  it('builds slots in the mentor’s timezone across a DST jump', () => {
    const slots = computeSlots({
      rules: {
        timezone: 'America/New_York',
        weekly: [{ day: 0, windows: [{ start: '01:00', end: '04:00' }] }],
        exceptions: [],
        minNoticeHours: 0,
        horizonDays: 60,
        bufferMin: 0,
      },
      durationMin: 60,
      mentorId: 'm',
      menteeId: 'e',
      busy: new Set(),
      from: new Date('2026-03-08T00:00:00Z'),
      days: 1,
      now: new Date('2026-03-01T00:00:00Z'),
    });
    expect(slots).toEqual([
      '2026-03-08T06:00:00.000Z',
      '2026-03-08T06:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
    ]);
  });

  it('respects exceptions, notice, busy blocks of either person and the mentor buffer', () => {
    const rules = {
      timezone: 'Asia/Kolkata',
      weekly: [{ day: 1, windows: [{ start: '10:00', end: '12:00' }] }],
      exceptions: [{ date: '2026-10-26', windows: [] }],
      minNoticeHours: 0,
      horizonDays: 60,
      bufferMin: 30,
    };
    const base = {
      rules,
      durationMin: 30,
      mentorId: 'm',
      menteeId: 'e',
      from: new Date('2026-10-19T00:00:00Z'),
      days: 14,
      now: new Date('2026-10-18T00:00:00Z'),
    };
    const free = computeSlots({ ...base, busy: new Set() });
    // Monday 19th (10:00–12:00 IST) has four 30-minute starts; Monday 26th is an exception (off).
    expect(free.filter((s) => s.startsWith('2026-10-19'))).toHaveLength(4);
    expect(free.some((s) => s.startsWith('2026-10-26'))).toBe(false);
    // The mentee is busy 10:30–11:00 IST: slots touching that block disappear.
    const busy = new Set(
      holdsFor('x', 'e', new Date('2026-10-19T05:00:00Z'), new Date('2026-10-19T05:30:00Z'), 0).filter((h) =>
        h.startsWith('e|'),
      ),
    );
    const withBusy = computeSlots({ ...base, busy }).filter((s) => s.startsWith('2026-10-19'));
    expect(withBusy).toEqual([
      '2026-10-19T04:30:00.000Z',
      '2026-10-19T05:30:00.000Z',
      '2026-10-19T06:00:00.000Z',
    ]);
    // Mentor holds include the 30-minute buffer.
    expect(
      holdsFor('m', 'e', new Date('2026-10-19T04:30:00Z'), new Date('2026-10-19T05:00:00Z'), 30).filter((h) =>
        h.startsWith('m|'),
      ),
    ).toHaveLength(4);
  });
});

describe('mentor setup', () => {
  it('validates settings and availability strictly', async () => {
    const a = as(mentor);
    expect(
      (
        await a
          .put('/me/mentor')
          .send({ ...SETTINGS, sessionTypes: [{ type: 'quick_chat', enabled: true, durationMin: 30 }] })
      ).status,
    ).toBe(400);
    expect((await a.put('/me/mentor').send({ ...SETTINGS, extra: true })).status).toBe(400);
    const overlapping = {
      ...ALL_DAY,
      weekly: [
        {
          day: 1,
          windows: [
            { start: '09:00', end: '11:00' },
            { start: '10:00', end: '12:00' },
          ],
        },
      ],
    };
    expect((await a.put('/me/mentor/availability').send(overlapping)).status).toBe(400);
    expect(
      (await a.put('/me/mentor/availability').send({ ...ALL_DAY, timezone: 'Mars/Olympus' })).status,
    ).toBe(400);
    expect(
      (
        await a
          .put('/me/mentor/availability')
          .send({ ...ALL_DAY, weekly: [{ day: 1, windows: [{ start: '09:10', end: '10:00' }] }] })
      ).status,
    ).toBe(400);
    const me = await a.get('/me/mentor');
    expect(me.body.data).toMatchObject({ accepting: true, availability: { timezone: 'UTC' } });
  });

  it('students cannot become mentors', async () => {
    expect((await as(student).put('/me/mentor').send(SETTINGS)).status).toBe(403);
  });

  it('lists accepting mentors with only visible profile fields', async () => {
    const r = await as(student).get('/mentors');
    expect(r.status).toBe(200);
    const card = r.body.data.find((m: { userId: string }) => m.userId === mentor.id);
    expect(card).toMatchObject({ company: 'Nimbus Labs (demo)', open: true });
    expect(card.sessionTypes.map((t: { type: string }) => t.type)).toEqual([
      'quick_chat',
      'video_1on1',
      'mock_interview',
    ]);
    expect((await as(student).get('/mentors?q=nimbus')).body.data).toHaveLength(1);
    expect((await as(student).get('/mentors?q=nothing-like-this')).body.data).toHaveLength(0);
  });
});

describe('requests', () => {
  it('a quick chat request opens messaging only after acceptance', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const r = await sendRequest(ctx, T, s, m, 'quick_chat');
    expect(r.status).toBe(201);
    expect((await as(s).get('/conversations')).body.data).toHaveLength(0);
    expect((await notifications(m)).map((n) => n.type)).toContain('request_received');
    const inbox = await as(m).get('/mentorship/requests?box=received');
    expect(inbox.body.data[0]).toMatchObject({ goal: REQUEST_TEXT.goal, status: 'pending' });
    const acc = await as(m).post(`/mentorship/requests/${r.body.data.id}/respond`).send({ action: 'accept' });
    expect(acc.status).toBe(200);
    expect(acc.body.data.bookingId).toBeNull();
    const convs = (await as(s).get('/conversations')).body.data;
    expect(convs).toHaveLength(1);
    expect(convs[0].id).toBe(acc.body.data.conversationId);
    expect((await notifications(s)).map((n) => n.type)).toContain('request_accepted');
  });

  it('refuses self, unknown, paused, audience mismatch and wrong session types', async () => {
    const paused = await makeMentor(ctx, T, { settings: { accepting: false } });
    const studentsOnly = await makeMentor(ctx, T, { settings: { audience: 'students' } });
    const alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    expect((await sendRequest(ctx, T, mentor, mentor, 'quick_chat')).status).toBe(400);
    expect(
      (await sendRequest(ctx, T, student, { ...mentor, id: '0123456789abcdef01234567' }, 'quick_chat'))
        .status,
    ).toBe(404);
    expect((await sendRequest(ctx, T, student, paused, 'quick_chat')).status).toBe(409);
    expect((await sendRequest(ctx, T, alum, studentsOnly, 'quick_chat')).status).toBe(409);
    expect(
      (
        await sendRequest(
          ctx,
          T,
          student,
          mentor,
          'resume_review',
          new Date(Date.now() + 5 * 3600_000).toISOString(),
        )
      ).status,
    ).toBe(400);
    // Bookable types need a slot; quick chats must not carry one.
    expect((await sendRequest(ctx, T, student, mentor, 'video_1on1')).status).toBe(400);
    expect((await sendRequest(ctx, T, student, mentor, 'quick_chat', new Date().toISOString())).status).toBe(
      400,
    );
    // A time outside availability (or in the past) is refused.
    expect(
      (await sendRequest(ctx, T, student, mentor, 'video_1on1', '2020-01-01T10:00:00.000Z')).status,
    ).toBe(409);
  });

  it('allows one open request per mentor, three open requests, and the mentor’s weekly cap', async () => {
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const capped = await makeMentor(ctx, T, { settings: { weeklyCap: 1 } });
    expect((await sendRequest(ctx, T, s, capped, 'quick_chat')).status).toBe(201);
    expect((await sendRequest(ctx, T, s, capped, 'quick_chat')).status).toBe(409); // duplicate pending
    const other = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const full = await sendRequest(ctx, T, other, capped, 'quick_chat');
    expect(full.status).toBe(409);
    expect(full.body.error.message).toMatch(/full for this week/);
    const capCard = (await as(other).get(`/mentors/${capped.id}`)).body.data;
    expect(capCard.open).toBe(false);
    for (let i = 0; i < 2; i++)
      expect((await sendRequest(ctx, T, s, await makeMentor(ctx, T), 'quick_chat')).status).toBe(201);
    const fourth = await sendRequest(ctx, T, s, await makeMentor(ctx, T), 'quick_chat');
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.message).toMatch(/3 open requests/);
  });

  it('enforces the college’s weekly request limit', async () => {
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'limits.mentorshipRequestsPerWeek': 2 } });
    clearTenantCache();
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const r1 = await sendRequest(ctx, T, s, await makeMentor(ctx, T), 'quick_chat');
    await as(s).post(`/mentorship/requests/${r1.body.data.id}/withdraw`).send({});
    expect((await sendRequest(ctx, T, s, await makeMentor(ctx, T), 'quick_chat')).status).toBe(201);
    const r3 = await sendRequest(ctx, T, s, await makeMentor(ctx, T), 'quick_chat');
    expect(r3.status).toBe(409);
    expect(r3.body.error.message).toMatch(/allows 2 mentorship requests a week/);
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'limits.mentorshipRequestsPerWeek': 5 } });
    clearTenantCache();
  });

  it('declines with a kind template; only the addressed mentor can respond', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const r = await sendRequest(ctx, T, s, m, 'quick_chat');
    const id = r.body.data.id;
    expect((await as(s).post(`/mentorship/requests/${id}/respond`).send({ action: 'accept' })).status).toBe(
      403,
    );
    expect(
      (await as(mentor).post(`/mentorship/requests/${id}/respond`).send({ action: 'accept' })).status,
    ).toBe(404);
    expect((await as(mentor).get(`/mentorship/requests/${id}`)).status).toBe(404);
    const d = await as(m)
      .post(`/mentorship/requests/${id}/respond`)
      .send({ action: 'decline', template: 'fully_booked', note: 'Try again in December!' });
    expect(d.body.data).toMatchObject({ status: 'declined', declineTemplate: 'fully_booked' });
    expect((await as(m).post(`/mentorship/requests/${id}/respond`).send({ action: 'accept' })).status).toBe(
      409,
    );
    const sent = (await as(s).get('/mentorship/requests?box=sent')).body.data[0];
    expect(sent.declineNote).toBe('Try again in December!');
    expect((await as(s).get('/conversations')).body.data).toHaveLength(0);
  });

  it('expires unanswered requests and tells the mentee', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const r = await sendRequest(ctx, T, s, m, 'quick_chat');
    expect(
      ctx.queue.delayed.some((j) => j.name === EXPIRE_JOB && j.jobId === `reqexp-${r.body.data.id}`),
    ).toBe(true);
    await runInTenant(T._id, () =>
      MentorshipRequestModel.updateOne(
        { _id: r.body.data.id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      ),
    );
    await ctx.queue.runDelayed({ name: EXPIRE_JOB });
    expect((await as(s).get(`/mentorship/requests/${r.body.data.id}`)).body.data.status).toBe('expired');
    expect((await notifications(s)).map((n) => n.type)).toContain('request_expired');
  });

  it('replays an Idempotency-Key and refuses it for a different body', async () => {
    const sameRequest = ['retry', 'safe', '0001'].join('-');
    const badFormat = 'has spaces!';
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const body = { mentorId: m.id, sessionType: 'quick_chat', ...REQUEST_TEXT };
    const first = await as(s).post('/mentorship/requests').set('Idempotency-Key', sameRequest).send(body);
    const again = await as(s).post('/mentorship/requests').set('Idempotency-Key', sameRequest).send(body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.data.id).toBe(first.body.data.id);
    const changed = await as(s)
      .post('/mentorship/requests')
      .set('Idempotency-Key', sameRequest)
      .send({ ...body, goal: 'Something else entirely' });
    expect(changed.status).toBe(422);
    expect(
      (await as(s).post('/mentorship/requests').set('Idempotency-Key', badFormat).send(body)).status,
    ).toBe(400);
    // Another member may reuse the same key string: keys are per user.
    const s2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
    expect(
      (await as(s2).post('/mentorship/requests').set('Idempotency-Key', sameRequest).send(body)).status,
    ).toBe(201);
  });

  it('requires a bot-protection token when bot protection is on', async () => {
    const guarded = testApp({ bot: { enabled: true, verify: async (t) => t === 'human-ok' } });
    const t2 = await makeTenant('mentorbot');
    const m = await makeMentor(guarded, t2);
    const s = await makeUser(guarded, t2, { roles: ['STUDENT'] });
    const body = { mentorId: m.id, sessionType: 'quick_chat', ...REQUEST_TEXT };
    const blocked = await api(guarded, t2.host, s.token).post('/mentorship/requests').send(body);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('BOT_CHECK_FAILED');
    expect(
      (
        await api(guarded, t2.host, s.token)
          .post('/mentorship/requests')
          .set('X-Bot-Token', 'human-ok')
          .send(body)
      ).status,
    ).toBe(201);
  });
});

describe('bookings', () => {
  it('books the requested slot and removes it from both calendars', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const slots = await slotsOf(ctx, T, s, m.id);
    const acc = await acceptedSession(ctx, T, s, m);
    expect(acc.bookingId).toBeTruthy();
    expect(acc.slotStart).toBe(slots[0]);
    expect(await slotsOf(ctx, T, s, m.id)).not.toContain(slots[0]);
    const b = (await as(s).get(`/bookings/${acc.bookingId}`)).body.data;
    expect(b).toMatchObject({
      status: 'scheduled',
      role: 'mentee',
      sessionType: 'video_1on1',
      conversationId: acc.conversationId,
    });
    expect((await as(m).get('/bookings')).body.data.map((x: { id: string }) => x.id)).toContain(
      acc.bookingId,
    );
    // Reminders (24 h may be in the past for a near slot) and completion are scheduled.
    expect(ctx.queue.delayed.some((j) => j.name === COMPLETE_JOB && j.data.bookingId === acc.bookingId)).toBe(
      true,
    );
  });

  it('cannot double-book: concurrent accepts of the same slot, and a mentee booked elsewhere', async () => {
    const m = await makeMentor(ctx, T);
    const [s1, s2] = [
      await makeUser(ctx, T, { roles: ['STUDENT'] }),
      await makeUser(ctx, T, { roles: ['STUDENT'] }),
    ];
    const slot = (await slotsOf(ctx, T, s1, m.id))[2] as string;
    const r1 = await sendRequest(ctx, T, s1, m, 'video_1on1', slot);
    const r2 = await sendRequest(ctx, T, s2, m, 'video_1on1', slot);
    const results = await Promise.all(
      [r1, r2].map((r) =>
        as(m).post(`/mentorship/requests/${r.body.data.id}/respond`).send({ action: 'accept' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser?.body.error.message).toMatch(/no longer free/);
    // The losing request is pending again, so the mentor can accept it at another time.
    const pending = (await as(m).get('/mentorship/requests?box=received&status=pending')).body.data;
    expect(pending).toHaveLength(1);
    // The winning mentee cannot be booked by another mentor at the same time.
    const m2 = await makeMentor(ctx, T);
    const winner = results[0]?.status === 200 ? s1 : s2;
    expect(await slotsOf(ctx, T, winner, m2.id)).not.toContain(slot);
  });

  it('reschedules (at most twice, new room), notifying the other person', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const acc = await acceptedSession(ctx, T, s, m);
    const roomBefore = await runInTenant(T._id, () =>
      BookingModel.findById(acc.bookingId).select('room').lean(),
    );
    const free = await slotsOf(ctx, T, s, m.id);
    const r1 = await as(s).post(`/bookings/${acc.bookingId}/reschedule`).send({ slotStart: free[3] });
    expect(r1.status).toBe(200);
    expect(r1.body.data).toMatchObject({ start: free[3], rescheduleCount: 1 });
    const roomAfter = await runInTenant(T._id, () =>
      BookingModel.findById(acc.bookingId).select('room').lean(),
    );
    expect(roomAfter?.room).not.toBe(roomBefore?.room);
    expect((await notifications(m)).map((n) => n.type)).toContain('booking_rescheduled');
    expect(
      (await as(m).post(`/bookings/${acc.bookingId}/reschedule`).send({ slotStart: free[5] })).status,
    ).toBe(200);
    const third = await as(s).post(`/bookings/${acc.bookingId}/reschedule`).send({ slotStart: free[7] });
    expect(third.status).toBe(409);
    expect(
      (await as(student).post(`/bookings/${acc.bookingId}/reschedule`).send({ slotStart: free[7] })).status,
    ).toBe(404);
  });

  it('cancels upcoming sessions (late flag) and frees the slot', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const acc = await acceptedSession(ctx, T, s, m);
    const c = await as(m).post(`/bookings/${acc.bookingId}/cancel`).send({ reason: 'Clash with work' });
    expect(c.body.data).toMatchObject({ status: 'cancelled', cancelledBy: 'mentor', lateCancel: true });
    expect(await slotsOf(ctx, T, s, m.id)).toContain(acc.slotStart);
    expect((await notifications(s)).map((n) => n.type)).toContain('booking_cancelled');
    expect((await as(s).post(`/bookings/${acc.bookingId}/cancel`).send({})).status).toBe(409);
  });

  it('hands out the video link only to participants and only around the session', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const acc = await acceptedSession(ctx, T, s, m);
    const early = await as(s).post(`/bookings/${acc.bookingId}/join`).send({});
    expect(early.status).toBe(409);
    await shiftBooking(T, acc.bookingId as string, 5 * 60_000);
    const join = await as(s).post(`/bookings/${acc.bookingId}/join`).send({});
    expect(join.status).toBe(200);
    expect(join.body.data.provider).toBe('jitsi');
    expect(join.body.data.url).toMatch(/^https:\/\/meet\.jit\.si\/mentor-[a-z2-7]{32}#/);
    expect((await as(m).post(`/bookings/${acc.bookingId}/join`).send({})).body.data.url.split('#')[0]).toBe(
      join.body.data.url.split('#')[0],
    );
    expect((await as(student).post(`/bookings/${acc.bookingId}/join`).send({})).status).toBe(404);
    await shiftBooking(T, acc.bookingId as string, -2 * 3600_000);
    expect((await as(s).post(`/bookings/${acc.bookingId}/join`).send({})).status).toBe(409);
  });

  it('exports a calendar file without the video link', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const acc = await acceptedSession(ctx, T, s, m);
    const ics = await as(s).get(`/bookings/${acc.bookingId}/ics`);
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.text).toMatch(/BEGIN:VEVENT[\s\S]*DTSTART:\d{8}T\d{6}Z/);
    expect(ics.text).not.toMatch(/mentor-[a-z2-7]{32}/);
    expect((await as(mentor).get(`/bookings/${acc.bookingId}/ics`)).status).toBe(404);
  });

  it('completes, records a no-show once, and takes mentee feedback privately', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const a1 = await acceptedSession(ctx, T, s, m, 'video_1on1', 0);
    const a2 = await acceptedSession(ctx, T, s, m, 'mock_interview', 4);
    await shiftBooking(T, a1.bookingId as string, -2 * 3600_000);
    await shiftBooking(T, a2.bookingId as string, -3 * 3600_000, 45);
    const past = (await as(s).get('/bookings?when=past')).body.data;
    expect(past.map((b: { status: string }) => b.status)).toEqual(['completed', 'completed']);
    // No-show on a2 by the mentee (the mentor did not come).
    const ns = await as(s).post(`/bookings/${a2.bookingId}/no-show`).send({});
    expect(ns.body.data).toMatchObject({ status: 'no_show', noShowBy: 'mentor' });
    expect((await as(m).post(`/bookings/${a2.bookingId}/no-show`).send({})).status).toBe(409);
    expect(
      (await as(s).post(`/bookings/${a2.bookingId}/feedback`).send({ rating: 1, tags: [] })).status,
    ).toBe(409);
    // Feedback on a1: mentee only, once.
    const fb = { rating: 5, tags: ['clear_advice', 'actionable'], comment: 'Super useful mock round' };
    expect((await as(m).post(`/bookings/${a1.bookingId}/feedback`).send(fb)).status).toBe(404);
    expect(
      (
        await as(s)
          .post(`/bookings/${a1.bookingId}/feedback`)
          .send({ ...fb, rating: 6 })
      ).status,
    ).toBe(400);
    expect((await as(s).post(`/bookings/${a1.bookingId}/feedback`).send(fb)).status).toBe(201);
    expect((await as(s).post(`/bookings/${a1.bookingId}/feedback`).send(fb)).status).toBe(409);
    expect((await as(m).get('/me/mentor/feedback')).body.data[0]).toMatchObject({
      rating: 5,
      comment: fb.comment,
    });
    expect((await as(mentor).get('/me/mentor/feedback')).body.data).toEqual([]);
    expect(
      (await as(tpo).get('/admin/mentorship/feedback')).body.data.some(
        (f: { comment: string }) => f.comment === fb.comment,
      ),
    ).toBe(true);
    expect((await as(s).get('/admin/mentorship/feedback')).status).toBe(403);
    expect((await notifications(m)).map((n) => n.type)).toContain('feedback_received');
    const impact = (await as(m).get('/me/mentor/impact')).body.data;
    expect(impact).toMatchObject({
      helpedThisMonth: 1,
      sessionsThisMonth: 1,
      averageRating: 5,
      ratingsCount: 1,
    });
  });

  it('sends reminders and completion prompts from delayed jobs, skipping stale versions', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const acc = await acceptedSession(ctx, T, s, m, 'video_1on1', 6);
    const free = await slotsOf(ctx, T, s, m.id);
    await as(s).post(`/bookings/${acc.bookingId}/reschedule`).send({ slotStart: free[10] });
    const mine = ctx.queue.delayed.filter((j) => j.data.bookingId === acc.bookingId);
    expect(mine.every((j) => j.data.version === 1)).toBe(true); // version-0 jobs were cancelled
    await ctx.queue.runDelayed({ name: REMINDER_JOB });
    expect((await notifications(s)).filter((n) => n.type === 'booking_reminder').length).toBeGreaterThan(0);
    expect((await notifications(m)).filter((n) => n.type === 'booking_reminder').length).toBeGreaterThan(0);
    await ctx.queue.runDelayed({ name: COMPLETE_JOB });
    expect((await as(s).get(`/bookings/${acc.bookingId}`)).body.data.status).toBe('completed');
    expect((await notifications(s)).map((n) => n.type)).toContain('session_completed');
  });
});

describe('Alumni Match', () => {
  it('scores branch, target company, goals, skills and languages, with reasons', () => {
    expect(normaliseCompany('Nimbus Labs (demo) Pvt. Ltd.')).toBe('nimbus labs');
    const r = scoreMatch(
      {
        branch: 'CSE',
        goals: ['backend'],
        targetCompanies: ['nimbus labs'],
        skills: ['Java'],
        languages: ['Telugu'],
      },
      {
        userId: 'x',
        name: 'X',
        roles: ['ALUMNI'],
        verified: true,
        avatarFileId: null,
        companyVerified: null,
        fields: {
          branch: 'CSE',
          company: 'Nimbus Labs (demo)',
          topics: ['Backend'],
          skills: ['Java'],
          languages: ['Telugu'],
        },
      },
    );
    expect(r.score).toBe(20 + 30 + 10 + 5 + 5);
    expect(r.reasons.map((x) => x.kind)).toEqual(['branch', 'company', 'goals', 'skills', 'languages']);
  });

  it('ranks mentors for the mentee and never uses fields hidden from them', async () => {
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const target = await makeMentor(ctx, T, {
      profile: { company: 'Kestrel Analytics (demo)', topics: ['Data'] },
    });
    const hidden = await makeMentor(ctx, T, {
      profile: { company: 'Kestrel Analytics (demo)', visibility: { company: 'only_me' } },
    });
    await as(s)
      .put('/me/match-preferences')
      .send({ goals: ['Data'], targetCompanies: ['Kestrel Analytics'] });
    const r = await as(s).get('/mentors/match');
    expect(r.status).toBe(200);
    const top = r.body.data[0];
    expect(top.mentor.userId).toBe(target.id);
    expect(top.reasons.map((x: { kind: string }) => x.kind)).toEqual(
      expect.arrayContaining(['company', 'goals', 'available']),
    );
    const h = r.body.data.find((x: { mentor: { userId: string } }) => x.mentor.userId === hidden.id);
    expect(h.reasons.some((x: { kind: string }) => x.kind === 'company')).toBe(false);
    expect(h.mentor.company).toBe('');
    // Match inputs are private to the mentee.
    expect((await as(s).get('/me/match-preferences')).body.data.targetCompanies).toEqual([
      'Kestrel Analytics',
    ]);
  });
});
