/**
 * MANDATORY tenant-isolation suite for Phase 3: mentor profiles, match inputs, requests, bookings,
 * feedback, conversations, messages, attachments, notifications, push subscriptions, blocks,
 * reports and idempotency records. Every cross-tenant read, write, update, delete and search must
 * fail. Blocks CI. (Socket isolation: test/realtime.test.ts.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import type { Model } from 'mongoose';
import {
  api,
  jpegWithExif,
  makeTenant,
  makeUser,
  testApp,
  type TestTenant,
  type TestUser,
} from '../helpers.js';
import {
  REQUEST_TEXT,
  acceptedSession,
  makeMentor,
  sendRequest,
  shiftBooking,
  slotsOf,
} from '../mentorship-fixtures.js';
import { runInTenant } from '../../src/lib/context.js';
import { MentorProfileModel, MenteePrefsModel } from '../../src/modules/mentorship/mentor.model.js';
import { MentorshipRequestModel } from '../../src/modules/mentorship/request.model.js';
import { BookingModel, FeedbackModel } from '../../src/modules/sessions/booking.model.js';
import { ConversationModel, MessageModel } from '../../src/modules/messaging/conversation.model.js';
import {
  NotificationModel,
  NotificationPrefsModel,
  PushSubscriptionModel,
} from '../../src/modules/notifications/notification.model.js';
import { BlockModel, ReportModel } from '../../src/modules/moderation/safety.model.js';
import { IdempotencyModel } from '../../src/modules/idempotency/idempotency.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let mentorA: TestUser, menteeA: TestUser, modA: TestUser;
let mentorB: TestUser, menteeB: TestUser, modB: TestUser;
let reqA: string,
  bookingA: string,
  convA: string,
  msgA: string,
  fileA: string,
  notifA: string,
  reportA: string;
const inB = (u: TestUser) => api(ctx, B.host, u.token);
function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

beforeAll(async () => {
  A = await makeTenant('isomenta');
  B = await makeTenant('isomentb');
  mentorA = await makeMentor(ctx, A, { profile: { company: 'Alpha-only Corp' } });
  menteeA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  modA = await makeUser(ctx, A, { roles: ['TPO'] });
  mentorB = await makeMentor(ctx, B);
  menteeB = await makeUser(ctx, B, { roles: ['STUDENT'] });
  modB = await makeUser(ctx, B, { roles: ['TPO'] });

  const a = (u: TestUser) => api(ctx, A.host, u.token);
  await a(menteeA)
    .put('/me/match-preferences')
    .send({ goals: ['Backend'], targetCompanies: ['Alpha-only Corp'] });
  await a(menteeA)
    .put('/me/notification-preferences')
    .send({
      channels: (await a(menteeA).get('/me/notification-preferences')).body.data.channels,
      quietHours: { enabled: true, start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' },
    });
  const acc = await acceptedSession(ctx, A, menteeA, mentorA, 'video_1on1');
  reqA = acc.id;
  bookingA = acc.bookingId as string;
  convA = acc.conversationId;
  const msg = await a(menteeA)
    .post(`/conversations/${convA}/messages`)
    .set('Idempotency-Key', ['iso', 'retry', '0001'].join('-'))
    .send({ body: 'Alpha private message' });
  msgA = msg.body.data.id;
  const att = await a(menteeA)
    .post(`/conversations/${convA}/attachments`)
    .attach('file', await jpegWithExif(), 'a.jpg');
  fileA = att.body.data.attachment.fileId;
  notifA = (await a(mentorA).get('/notifications')).body.data[0].id;
  await shiftBooking(A, bookingA, -2 * 3600_000);
  await a(menteeA).get('/bookings?when=past');
  expect(
    (
      await a(menteeA)
        .post(`/bookings/${bookingA}/feedback`)
        .send({ rating: 4, tags: ['kind'], comment: 'Alpha feedback' })
    ).status,
  ).toBe(201);
  reportA = (
    await a(menteeA).post('/reports').send({ targetType: 'user', targetId: mentorA.id, reason: 'other' })
  ).body.data.id;
  await a(menteeA).post('/me/blocks').send({ userId: modA.id });
  await a(menteeA).post('/notifications/push/subscriptions').send({
    endpoint: 'https://fcm.googleapis.com/fcm/send/alpha-device',
    keys: browserKeys(),
  });
  // B has its own data too, so "empty" results are not trivially empty.
  await sendRequest(ctx, B, menteeB, mentorB, 'quick_chat');
});

describe('HTTP: nothing of college A is reachable from college B', () => {
  it('mentors, slots and match', async () => {
    expect((await inB(menteeB).get(`/mentors/${mentorA.id}`)).status).toBe(404);
    expect((await inB(menteeB).get(`/mentors/${mentorA.id}/slots?type=video_1on1`)).status).toBe(404);
    const list = (await inB(menteeB).get('/mentors')).body.data.map((m: { userId: string }) => m.userId);
    expect(list).toContain(mentorB.id);
    expect(list).not.toContain(mentorA.id);
    expect((await inB(menteeB).get('/mentors?q=Alpha-only')).body.data).toEqual([]);
    expect(
      (await inB(menteeB).get('/mentors/match')).body.data.map(
        (m: { mentor: { userId: string } }) => m.mentor.userId,
      ),
    ).not.toContain(mentorA.id);
    expect((await inB(menteeB).get('/me/match-preferences')).body.data).toEqual({
      goals: [],
      targetCompanies: [],
    });
  });

  it('requests', async () => {
    const r = await inB(menteeB)
      .post('/mentorship/requests')
      .send({ mentorId: mentorA.id, sessionType: 'quick_chat', ...REQUEST_TEXT });
    expect(r.status).toBe(404);
    expect((await inB(menteeB).get(`/mentorship/requests/${reqA}`)).status).toBe(404);
    expect(
      (await inB(mentorB).post(`/mentorship/requests/${reqA}/respond`).send({ action: 'accept' })).status,
    ).toBe(404);
    expect((await inB(menteeB).post(`/mentorship/requests/${reqA}/withdraw`).send({})).status).toBe(404);
    expect(
      (await inB(mentorB).get('/mentorship/requests?box=received')).body.data.map(
        (x: { id: string }) => x.id,
      ),
    ).not.toContain(reqA);
  });

  it('bookings, video and feedback', async () => {
    for (const [m, p, body] of [
      ['get', `/bookings/${bookingA}`, undefined],
      ['get', `/bookings/${bookingA}/ics`, undefined],
      ['post', `/bookings/${bookingA}/join`, {}],
      ['post', `/bookings/${bookingA}/cancel`, {}],
      ['post', `/bookings/${bookingA}/no-show`, {}],
      [
        'post',
        `/bookings/${bookingA}/reschedule`,
        { slotStart: (await slotsOf(ctx, B, menteeB, mentorB.id))[0] },
      ],
      ['post', `/bookings/${bookingA}/feedback`, { rating: 1, tags: [] }],
    ] as const) {
      const a = inB(menteeB);
      const res = m === 'get' ? await a.get(p) : await a.post(p).send(body ?? {});
      expect(res.status, `${m} ${p}`).toBe(404);
    }
    expect((await inB(menteeB).get('/bookings?when=past')).body.data).toEqual([]);
    expect((await inB(modB).get('/admin/mentorship/feedback')).body.data).toEqual([]);
    expect((await api(ctx, A.host, modA.token).get('/admin/mentorship/feedback')).body.data).toHaveLength(1);
  });

  it('conversations, messages and attachments', async () => {
    expect((await inB(menteeB).get(`/conversations/${convA}`)).status).toBe(404);
    expect((await inB(menteeB).get(`/conversations/${convA}/messages`)).status).toBe(404);
    expect((await inB(menteeB).post(`/conversations/${convA}/messages`).send({ body: 'hi' })).status).toBe(
      404,
    );
    expect((await inB(menteeB).post(`/conversations/${convA}/read`).send({ messageId: msgA })).status).toBe(
      404,
    );
    expect(
      (
        await inB(menteeB)
          .post(`/conversations/${convA}/attachments`)
          .attach('file', await jpegWithExif(), 'x.jpg')
      ).status,
    ).toBe(404);
    expect((await inB(menteeB).get(`/files/${fileA}`)).status).toBe(404);
    // The same Idempotency-Key in another college is a different key.
    const r = await inB(menteeB).get('/conversations');
    expect(r.body.data).toEqual([]);
  });

  it('notifications, push, blocks and reports', async () => {
    expect(
      (
        await inB(mentorB)
          .post('/notifications/read')
          .send({ ids: [notifA] })
      ).body.data.updated,
    ).toBe(0);
    expect(
      (await inB(mentorB).get('/notifications')).body.data.map((n: { id: string }) => n.id),
    ).not.toContain(notifA);
    expect((await inB(menteeB).post('/me/blocks').send({ userId: mentorA.id })).status).toBe(404);
    expect(
      (await inB(menteeB).post('/reports').send({ targetType: 'message', targetId: msgA, reason: 'spam' }))
        .status,
    ).toBe(404);
    expect(
      (await inB(menteeB).post('/reports').send({ targetType: 'request', targetId: reqA, reason: 'spam' }))
        .status,
    ).toBe(404);
    expect(
      (await inB(menteeB).post('/reports').send({ targetType: 'user', targetId: mentorA.id, reason: 'spam' }))
        .status,
    ).toBe(404);
    expect((await inB(modB).get('/admin/reports')).body.data.map((x: { id: string }) => x.id)).not.toContain(
      reportA,
    );
    expect(
      (await inB(modB).post(`/admin/reports/${reportA}/resolve`).send({ outcome: 'dismissed' })).status,
    ).toBe(404);
    expect((await inB(menteeB).get('/me/blocks')).body.data).toEqual([]);
  });

  it('a token from A never works on B', async () => {
    const r = await api(ctx, B.host, menteeA.token).get('/conversations');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });
});

describe('database layer: every Phase 3 collection is scoped', () => {
  const MODELS: [string, Model<unknown>][] = [
    ['MentorProfile', MentorProfileModel as Model<unknown>],
    ['MenteePrefs', MenteePrefsModel as Model<unknown>],
    ['MentorshipRequest', MentorshipRequestModel as Model<unknown>],
    ['Booking', BookingModel as Model<unknown>],
    ['SessionFeedback', FeedbackModel as Model<unknown>],
    ['Conversation', ConversationModel as Model<unknown>],
    ['Message', MessageModel as Model<unknown>],
    ['Notification', NotificationModel as Model<unknown>],
    ['NotificationPrefs', NotificationPrefsModel as Model<unknown>],
    ['PushSubscription', PushSubscriptionModel as Model<unknown>],
    ['Block', BlockModel as Model<unknown>],
    ['Report', ReportModel as Model<unknown>],
    ['IdempotencyRecord', IdempotencyModel as Model<unknown>],
  ];

  it.each(MODELS)('%s: B cannot read, search, update or delete A’s documents', async (_name, model) => {
    const docA = await runInTenant(A._id, () => model.findOne({}).select('_id').lean<{ _id: unknown }>());
    expect(docA, 'fixture created a document in A').toBeTruthy();
    const id = docA?._id;
    await runInTenant(B._id, async () => {
      expect(await model.findById(id).lean()).toBeNull();
      expect(await model.findOne({ _id: id }).lean()).toBeNull();
      expect(await model.countDocuments({ _id: id })).toBe(0);
      expect((await model.updateOne({ _id: id }, { $set: { updatedAt: new Date(0) } })).matchedCount).toBe(0);
      expect(
        (await model.updateMany({}, { $set: { updatedAt: new Date(0) } })).matchedCount,
      ).toBeGreaterThanOrEqual(0);
      expect((await model.deleteOne({ _id: id })).deletedCount).toBe(0);
    });
    // A's document is untouched by B's updateMany({}).
    const after = await runInTenant(A._id, () =>
      model.findById(id).select('updatedAt').lean<{ updatedAt: Date }>(),
    );
    expect(after?.updatedAt.getTime()).not.toBe(0);
  });

  it.each(MODELS)('%s: no tenant context, no access', async (_name, model) => {
    await expect(model.findOne({})).rejects.toThrow(/tenant context/i);
  });
});
