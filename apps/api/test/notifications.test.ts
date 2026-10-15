import { createECDH, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { DEFAULT_CHANNELS } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { acceptedSession, makeMentor, sendRequest } from './mentorship-fixtures.js';
import { WebPushSender } from '../src/modules/notifications/push.js';
import { quietDelayMs } from '../src/modules/notifications/notifications.service.js';
import { renderNotification } from '../src/modules/notifications/templates.js';
import { runInTenant } from '../src/lib/context.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { PushSubscriptionModel } from '../src/modules/notifications/notification.model.js';
import type { safeFetch } from '../src/lib/safe-fetch.js';

const pushCalls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
let pushStatus = 201;
const fakeFetch = (async (
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown; allowHosts?: readonly string[] } = {},
) => {
  pushCalls.push({ url, headers: opts.headers ?? {}, body: opts.body });
  return { status: pushStatus, contentType: '', body: Buffer.alloc(0), finalUrl: url };
}) as unknown as typeof safeFetch;
const vapid = webpush.generateVAPIDKeys();
const ctx = testApp({
  push: new WebPushSender({ ...vapid, subject: 'mailto:test@campuslink.localhost' }, fakeFetch),
});
let T: TestTenant;
let mentee: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);

function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

beforeAll(async () => {
  T = await makeTenant('notifya');
  await makeMentor(ctx, T);
  mentee = await makeUser(ctx, T, { roles: ['STUDENT'] });
});

describe('preferences and quiet hours', () => {
  it('defaults to sensible channels and validates updates', async () => {
    const p = await as(mentee).get('/me/notification-preferences');
    expect(p.body.data.channels).toEqual(DEFAULT_CHANNELS);
    expect((await as(mentee).put('/me/notification-preferences').send({ channels: {} })).status).toBe(400);
  });

  it('computes the wait until quiet hours end, including overnight ranges', () => {
    const q = { enabled: true, start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' };
    expect(quietDelayMs(q, new Date('2026-10-15T17:30:00Z'))).toBe(8 * 3600_000); // 23:00 IST
    expect(quietDelayMs(q, new Date('2026-10-15T00:30:00Z'))).toBe(60 * 60_000); // 06:00 IST
    expect(quietDelayMs(q, new Date('2026-10-15T06:30:00Z'))).toBe(0); // 12:00 IST
    expect(quietDelayMs({ ...q, enabled: false }, new Date('2026-10-15T17:30:00Z'))).toBe(0);
  });

  it('holds email and push during quiet hours (in-app stays immediate)', async () => {
    const m = await makeMentor(ctx, T);
    const allDay = { enabled: true, start: '00:00', end: '23:59', timezone: 'UTC' };
    const prefs = (await as(m).get('/me/notification-preferences')).body.data;
    expect(
      (
        await as(m)
          .put('/me/notification-preferences')
          .send({ ...prefs, quietHours: allDay })
      ).status,
    ).toBe(200);
    const before = ctx.mailer.outbox.length;
    await sendRequest(ctx, T, mentee, m, 'quick_chat');
    await ctx.queue.drain();
    expect(ctx.mailer.outbox.length).toBe(before);
    expect((await as(m).get('/notifications/unread-count')).body.data.count).toBe(1);
    const held = ctx.queue.delayed.filter(
      (j) => j.name === 'notifications.deliver' && j.data.userId === m.id,
    );
    expect(held).toHaveLength(1);
    await ctx.queue.runDelayed({ name: 'notifications.deliver' });
    expect(ctx.mailer.lastTo(m.email)?.subject).toMatch(/^New mentorship request · /);
  });
});

describe('in-app and email', () => {
  it('stores, counts and marks notifications read', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await sendRequest(ctx, T, s, m, 'quick_chat');
    const list = (await as(m).get('/notifications')).body.data;
    expect(list[0]).toMatchObject({
      type: 'request_received',
      readAt: null,
      data: { sessionType: 'quick_chat' },
    });
    expect(
      (
        await as(m)
          .post('/notifications/read')
          .send({ ids: [list[0].id] })
      ).body.data.updated,
    ).toBe(1);
    expect((await as(m).get('/notifications/unread-count')).body.data.count).toBe(0);
    expect((await as(m).post('/notifications/read').send({ all: true })).status).toBe(200);
    // Someone else's notification ids are simply not theirs to mark.
    expect(
      (
        await as(s)
          .post('/notifications/read')
          .send({ ids: [list[0].id] })
      ).body.data.updated,
    ).toBe(0);
  });

  it('emails in the member’s language with a link to their college, never with request text', async () => {
    const m = await makeMentor(ctx, T);
    await runInTenant(T._id, () => UserModel.updateOne({ _id: m.id }, { $set: { locale: 'te' } }));
    await sendRequest(
      ctx,
      T,
      mentee,
      m,
      'video_1on1',
      (await as(mentee).get(`/mentors/${m.id}/slots?type=video_1on1`)).body.data.slots[0],
    );
    await ctx.queue.drain();
    const mail = ctx.mailer.lastTo(m.email);
    expect(mail?.subject).toMatch(/^కొత్త మెంటర్‌షిప్ అభ్యర్థన/);
    expect(mail?.text).toContain('1:1 వీడియో కాల్');
    expect(mail?.text).toContain(`http://${T.slug}.localhost:5173/mentorship?box=received`);
    expect(mail?.text).not.toContain('Crack backend interviews');
    expect(
      renderNotification(
        'booking_reminder',
        { name: 'Rahul', sessionType: 'mock_interview', start: '2026-10-20T04:30:00Z' },
        'en',
        'Asia/Kolkata',
      ).body,
    ).toBe('Your mock interview with Rahul starts 20 Oct 2026, 10:00 am.');
  });

  it('emails about new messages only when opted in, at most once per half hour per conversation', async () => {
    const m = await makeMentor(ctx, T);
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const { conversationId } = await acceptedSession(ctx, T, s, m, 'quick_chat');
    const prefs = (await as(m).get('/me/notification-preferences')).body.data;
    const countMails = () =>
      ctx.mailer.outbox.filter((x) => x.to === m.email && /New message/.test(x.subject)).length;
    await as(s).post(`/conversations/${conversationId}/messages`).send({ body: 'one' });
    await ctx.queue.drain();
    expect(countMails()).toBe(0); // messages email is off by default
    await as(m)
      .put('/me/notification-preferences')
      .send({
        ...prefs,
        channels: { ...prefs.channels, messages: { inApp: true, email: true, push: false } },
      });
    await as(s).post(`/conversations/${conversationId}/messages`).send({ body: 'two' });
    await as(s).post(`/conversations/${conversationId}/messages`).send({ body: 'three' });
    await ctx.queue.drain();
    expect(countMails()).toBe(1);
    expect(
      ctx.mailer.outbox
        .filter((x) => x.to === m.email)
        .map((x) => x.text)
        .join('\n'),
    ).not.toMatch(/\btwo\b|\bthree\b/);
  });
});

describe('web push', () => {
  it('only accepts subscriptions on known push services', async () => {
    expect((await as(mentee).get('/notifications/push/config')).body.data).toEqual({
      enabled: true,
      publicKey: vapid.publicKey,
    });
    const bad = await as(mentee)
      .post('/notifications/push/subscriptions')
      .send({ endpoint: 'https://169.254.169.254/latest', keys: browserKeys() });
    expect(bad.status).toBe(400);
    const sneaky = await as(mentee)
      .post('/notifications/push/subscriptions')
      .send({ endpoint: 'https://fcm.googleapis.com.evil.example/x', keys: browserKeys() });
    expect(sneaky.status).toBe(400);
  });

  it('delivers encrypted pushes through the safe fetcher and drops gone subscriptions', async () => {
    const m = await makeMentor(ctx, T);
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString('hex')}`;
    expect(
      (await as(m).post('/notifications/push/subscriptions').send({ endpoint, keys: browserKeys() })).status,
    ).toBe(201);
    const stored = await runInTenant(T._id, () => PushSubscriptionModel.findOne({ userId: m.id }).lean());
    expect(JSON.stringify(stored)).not.toContain('fcm.googleapis.com');
    pushCalls.length = 0;
    await sendRequest(ctx, T, mentee, m, 'quick_chat');
    await ctx.queue.drain();
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0]?.url).toBe(endpoint);
    expect(pushCalls[0]?.headers.Authorization ?? pushCalls[0]?.headers.authorization).toMatch(/^vapid t=/);
    expect(pushCalls[0]?.headers['Content-Encoding']).toBe('aes128gcm');
    expect(Buffer.isBuffer(pushCalls[0]?.body)).toBe(true);
    expect(String(pushCalls[0]?.body)).not.toContain('mentorship');
    pushStatus = 410;
    const s2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await sendRequest(ctx, T, s2, m, 'quick_chat');
    await ctx.queue.drain();
    pushStatus = 201;
    expect(await runInTenant(T._id, () => PushSubscriptionModel.countDocuments({ userId: m.id }))).toBe(0);
  });

  it('never posts to a host outside the push allowlist, even if one were stored', async () => {
    pushCalls.length = 0;
    const sender = new WebPushSender({ ...vapid, subject: 'mailto:test@campuslink.localhost' }, fakeFetch);
    expect(await sender.send({ endpoint: 'https://127.0.0.1/push', keys: browserKeys() }, '{}')).toBe('gone');
    expect(pushCalls).toHaveLength(0);
    const off = new WebPushSender(null, fakeFetch);
    expect(off.enabled).toBe(false);
    expect(await off.send({ endpoint: 'https://fcm.googleapis.com/x', keys: browserKeys() }, '{}')).toBe(
      'failed',
    );
  });
});
