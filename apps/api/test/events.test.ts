import { beforeAll, describe, expect, it } from 'vitest';
import { icsEscape } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { EventModel } from '../src/modules/events/event.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';

const ctx = testApp();
let T: TestTenant;
let staff: TestUser, alum: TestUser, s1: TestUser, s2: TestUser, s3: TestUser, mod: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const HOUR = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const base = (over: Record<string, unknown> = {}) => ({
  title: 'Demo alumni meetup, Hyderabad; evening',
  description: 'DEMO event used by the tests: meet alumni and talk about placements.',
  kind: 'meetup',
  mode: 'hybrid',
  startsAt: at(48),
  endsAt: at(50),
  location: 'Seminar Hall 2',
  onlineUrl: 'https://meet.example.org/demo-room',
  capacity: 2,
  ...over,
});
const notes = async (u: TestUser, type: string) =>
  (await as(u).get('/notifications')).body.data.filter((n: { type: string }) => n.type === type);

beforeAll(async () => {
  T = await makeTenant('eventtest');
  staff = await makeUser(ctx, T, { roles: ['FACULTY'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  s1 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  s2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  s3 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  mod = await makeUser(ctx, T, { roles: ['FACULTY'] });
});

describe('creating events', () => {
  it('staff create any kind; alumni host AMAs and office hours only; students cannot', async () => {
    expect((await as(s1).post('/events').send(base())).status).toBe(403);
    expect((await as(alum).post('/events').send(base())).status).toBe(403);
    const ama = await as(alum)
      .post('/events')
      .send(base({ kind: 'ama', mode: 'online', location: '', title: 'Demo AMA: backend careers' }));
    expect(ama.status).toBe(201);
    expect(ama.body.data).toMatchObject({
      kind: 'ama',
      isHost: true,
      hasQa: true,
      host: { userId: alum.id },
    });
    expect((await as(staff).post('/events').send(base())).status).toBe(201);
  });

  it('validates times, links and venues', async () => {
    expect(
      (
        await as(staff)
          .post('/events')
          .send(base({ endsAt: at(47) }))
      ).status,
    ).toBe(400);
    expect(
      (
        await as(staff)
          .post('/events')
          .send(base({ mode: 'online', onlineUrl: null }))
      ).status,
    ).toBe(400);
    expect(
      (
        await as(staff)
          .post('/events')
          .send(base({ mode: 'in_person', location: '' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await as(staff)
          .post('/events')
          .send(base({ onlineUrl: 'http://insecure.example' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await as(staff)
          .post('/events')
          .send(base({ startsAt: at(-5), endsAt: at(-4) }))
      ).status,
    ).toBe(400);
    expect(
      (
        await as(staff)
          .post('/events')
          .send({ ...base(), extra: 1 })
      ).status,
    ).toBe(400);
  });
});

describe('RSVP, waitlist and the online link', () => {
  let id: string;
  beforeAll(async () => {
    id = (
      await as(staff)
        .post('/events')
        .send(base({ title: 'Demo capacity event' }))
    ).body.data.id;
  });

  it('fills seats, then waitlists in order', async () => {
    expect((await as(s1).put(`/events/${id}/rsvp`).send({ going: true })).body.data).toMatchObject({
      myRsvp: 'going',
      going: 1,
    });
    // Repeating is harmless.
    expect((await as(s1).put(`/events/${id}/rsvp`).send({ going: true })).body.data.going).toBe(1);
    await as(s2).put(`/events/${id}/rsvp`).send({ going: true });
    const third = (await as(s3).put(`/events/${id}/rsvp`).send({ going: true })).body.data;
    expect(third).toMatchObject({ myRsvp: 'waitlist', myWaitlistPosition: 1, going: 2, waitlist: 1 });
  });

  it('hides the online link until shortly before the start (hosts always see it)', async () => {
    expect((await as(s1).get(`/events/${id}`)).body.data.onlineUrl).toBeNull();
    expect((await as(staff).get(`/events/${id}`)).body.data.onlineUrl).toBe(
      'https://meet.example.org/demo-room',
    );
    await runInTenant(T._id, () =>
      EventModel.updateOne({ _id: id }, { $set: { startsAt: new Date(Date.now() + 10 * 60_000) } }),
    );
    expect((await as(s1).get(`/events/${id}`)).body.data.onlineUrl).toBe(
      'https://meet.example.org/demo-room',
    );
    expect((await as(s3).get(`/events/${id}`)).body.data.onlineUrl).toBeNull(); // waitlisted
    await runInTenant(T._id, () =>
      EventModel.updateOne({ _id: id }, { $set: { startsAt: new Date(Date.now() + 48 * HOUR) } }),
    );
  });

  it('a cancellation moves the first person on the waitlist up and tells them', async () => {
    const left = (await as(s1).put(`/events/${id}/rsvp`).send({ going: false })).body.data;
    expect(left).toMatchObject({ myRsvp: null, going: 2, waitlist: 0 });
    expect((await as(s3).get(`/events/${id}`)).body.data.myRsvp).toBe('going');
    const [n] = await notes(s3, 'event_promoted');
    expect(n.data).toMatchObject({ eventId: id, event: 'Demo capacity event' });
  });

  it('concurrent RSVPs never exceed capacity', async () => {
    const e = (
      await as(staff)
        .post('/events')
        .send(base({ title: 'Demo race event', capacity: 1 }))
    ).body.data.id;
    const users = await Promise.all(
      Array.from({ length: 5 }, () => makeUser(ctx, T, { roles: ['STUDENT'] })),
    );
    await Promise.all(users.map((u) => as(u).put(`/events/${e}/rsvp`).send({ going: true })));
    const v = (await as(staff).get(`/events/${e}`)).body.data;
    expect(v).toMatchObject({ going: 1, waitlist: 4 });
    const list = (await as(staff).get(`/events/${e}/attendees`)).body.data;
    expect(list.filter((a: { status: string }) => a.status === 'going')).toHaveLength(1);
  });

  it('only hosts and staff see attendees; capacity can’t drop below the people going', async () => {
    expect((await as(s2).get(`/events/${id}/attendees`)).status).toBe(403);
    expect((await as(alum).get(`/events/${id}/attendees`)).status).toBe(403);
    expect(
      (
        await as(staff)
          .put(`/events/${id}`)
          .send({ ...base({ title: 'Demo capacity event' }), capacity: 1 })
      ).status,
    ).toBe(400);
  });
});

describe('reminders, changes and cancellation', () => {
  it('reminds people going; a change voids the old reminders', async () => {
    const id = (
      await as(staff)
        .post('/events')
        .send(base({ title: 'Demo reminder event', capacity: null }))
    ).body.data.id;
    await as(s1).put(`/events/${id}/rsvp`).send({ going: true });
    const upd = await as(staff)
      .put(`/events/${id}`)
      .send({
        ...base({ title: 'Demo reminder event (moved)', capacity: null }),
        startsAt: at(72),
        endsAt: at(74),
      });
    expect(upd.status).toBe(200);
    expect((await notes(s1, 'event_updated')).length).toBeGreaterThanOrEqual(1);
    await ctx.queue.runDelayed({ name: 'events.reminder' });
    const rem = (await notes(s1, 'event_reminder')).filter(
      (n: { data: { eventId: string } }) => n.data.eventId === id,
    );
    // Only the new version's two reminders ran (24 h and 1 h).
    expect(rem).toHaveLength(2);
    expect(rem[0].data.event).toBe('Demo reminder event (moved)');
  });

  it('cancelling tells people and closes RSVPs', async () => {
    const id = (
      await as(staff)
        .post('/events')
        .send(base({ title: 'Demo cancelled event' }))
    ).body.data.id;
    await as(s2).put(`/events/${id}/rsvp`).send({ going: true });
    expect((await as(s2).post(`/events/${id}/cancel`).send({})).status).toBe(403);
    expect((await as(staff).post(`/events/${id}/cancel`).send({})).body.data.status).toBe('cancelled');
    expect((await as(staff).post(`/events/${id}/cancel`).send({})).status).toBe(409);
    expect(
      (await notes(s2, 'event_cancelled')).some((n: { data: { eventId: string } }) => n.data.eventId === id),
    ).toBe(true);
    expect((await as(s3).put(`/events/${id}/rsvp`).send({ going: true })).status).toBe(409);
    expect((await as(s2).get('/events')).body.data.map((e: { id: string }) => e.id)).not.toContain(id);
    expect(
      await runInTenant(T._id, () => AuditModel.countDocuments({ action: 'event.cancelled', targetId: id })),
    ).toBe(1);
  });
});

describe('calendar export', () => {
  it('produces a valid, escaped .ics file', async () => {
    const id = (
      await as(staff)
        .post('/events')
        .send(base({ title: 'Demo, talk; with \\ symbols' }))
    ).body.data.id;
    const r = await as(s1).get(`/events/${id}/ics`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/calendar');
    expect(r.headers['content-disposition']).toContain('attachment');
    const text = r.text;
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('SUMMARY:Demo\\, talk\\; with \\\\ symbols');
    expect(text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    // The online link isn't leaked before it opens.
    expect(text).not.toContain('meet.example.org');
    for (const line of text.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(icsEscape('a\nb')).toBe('a\\nb');
  });
});

describe('audience', () => {
  it('students-only events are invisible to alumni', async () => {
    const id = (
      await as(staff)
        .post('/events')
        .send(base({ title: 'Demo students only', audience: 'students' }))
    ).body.data.id;
    expect((await as(alum).get(`/events/${id}`)).status).toBe(404);
    expect((await as(alum).put(`/events/${id}/rsvp`).send({ going: true })).status).toBe(404);
    expect((await as(alum).get('/events')).body.data.map((e: { id: string }) => e.id)).not.toContain(id);
    expect((await as(s1).get(`/events/${id}`)).status).toBe(200);
  });
});

describe('check-in and Q&A', () => {
  let ama: string;
  beforeAll(async () => {
    ama = (
      await as(alum)
        .post('/events')
        .send(
          base({
            kind: 'ama',
            mode: 'online',
            location: '',
            title: 'Demo AMA on internships',
            startsAt: at(0.5),
            endsAt: at(2),
          }),
        )
    ).body.data.id;
    await as(s1).put(`/events/${ama}/rsvp`).send({ going: true });
  });

  it('the host checks people in, which earns XP and impact once', async () => {
    expect(
      (await as(s2).post(`/events/${ama}/check-in`).send({ userId: s1.id, attended: true })).status,
    ).toBe(403);
    expect(
      (await as(alum).post(`/events/${ama}/check-in`).send({ userId: s2.id, attended: true })).status,
    ).toBe(404);
    expect(
      (await as(alum).post(`/events/${ama}/check-in`).send({ userId: s1.id, attended: true })).body.data,
    ).toEqual({ checkedIn: true });
    await as(alum).post(`/events/${ama}/check-in`).send({ userId: s1.id, attended: true });
    expect((await as(s1).get('/me/progress')).body.data.recent[0]).toMatchObject({
      kind: 'event_attended',
      points: 10,
    });
    expect((await as(alum).get('/me/progress')).body.data.impact).toBe(10);
    const list = (await as(alum).get(`/events/${ama}/attendees`)).body.data;
    expect(list[0]).toMatchObject({ person: { userId: s1.id }, checkedIn: true });
  });

  it('runs a live question queue with one vote each', async () => {
    const q = await as(s1)
      .post(`/events/${ama}/questions`)
      .send({ body: 'How did you find your <b>first</b> internship?' });
    expect(q.status).toBe(201);
    expect(q.body.data.body).not.toContain('<b>');
    const qid = q.body.data.id;
    expect((await as(s1).put(`/event-questions/${qid}/vote`).send({ on: true })).status).toBe(400);
    await as(s2).put(`/event-questions/${qid}/vote`).send({ on: true });
    await as(s2).put(`/event-questions/${qid}/vote`).send({ on: true });
    await as(s3).put(`/event-questions/${qid}/vote`).send({ on: true });
    const list = (await as(s2).get(`/events/${ama}/questions`)).body.data;
    expect(list[0]).toMatchObject({ votes: 2, votedByMe: true, status: 'open' });
    expect((await as(s2).patch(`/event-questions/${qid}`).send({ status: 'answered' })).status).toBe(403);
    await as(alum).patch(`/event-questions/${qid}`).send({ status: 'hidden' });
    expect((await as(s2).get(`/events/${ama}/questions`)).body.data).toEqual([]);
    expect((await as(alum).get(`/events/${ama}/questions`)).body.data[0].status).toBe('hidden');
    const meetup = (
      await as(staff)
        .post('/events')
        .send(base({ title: 'Demo no QA' }))
    ).body.data.id;
    expect((await as(s1).get(`/events/${meetup}/questions`)).status).toBe(404);
  });

  it('events can be reported and removed by moderators', async () => {
    expect(
      (await as(s1).post('/reports').send({ targetType: 'event', targetId: ama, reason: 'spam' })).status,
    ).toBe(201);
    expect(
      (await as(alum).post('/reports').send({ targetType: 'event', targetId: ama, reason: 'spam' })).status,
    ).toBe(404);
    const m = await as(mod)
      .post('/admin/moderation/actions')
      .send({ targetType: 'event', targetId: ama, action: 'remove', reason: 'spam' });
    expect(m.status).toBe(200);
    expect((await as(s1).get(`/events/${ama}`)).status).toBe(404);
    const [n] = await notes(alum, 'content_removed');
    expect(n.data).toMatchObject({ contentType: 'event', eventId: ama });
  });
});
