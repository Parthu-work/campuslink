import { createHmac } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeMentor } from './mentorship-fixtures.js';
import { loadEnv } from '../src/config/env.js';
import { runInTenant } from '../src/lib/context.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { invalidateTenant } from '../src/modules/tenants/tenant.cache.js';
import {
  ChannelMessageModel,
  ChannelUsageModel,
} from '../src/modules/notifications/channels/channel.model.js';
import { MentorshipRequestModel } from '../src/modules/mentorship/request.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import type { ChannelService } from '../src/modules/notifications/channels/channel.service.js';
import type { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { CloudWhatsAppProvider } from '../src/lib/whatsapp.js';
import { Msg91SmsProvider } from '../src/lib/sms.js';
import type { SafeResponse } from '../src/lib/safe-fetch.js';

const APP_SECRET = 'test-whatsapp-app-secret';
const VERIFY = 'test-verify-token-0123456789';
const env = loadEnv({
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://*.localhost:5173',
  HIBP_ENABLED: 'false',
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: VERIFY,
  WHATSAPP_ACTION_SECRET: 'a'.repeat(40),
});
const ctx = testApp({ env });
const services = ctx.app.locals.services as { channels: ChannelService; notifications: NotificationsService };
let T: TestTenant, U: TestTenant;
let student: TestUser, mentor: TestUser;
let n = 0;
const phoneFor = () => `+9196${String(52_000_000 + ++n * 7331).padStart(8, '0')}`;
const phones = new Map<string, string>();

/** Gives a member a verified number and (optionally) WhatsApp consent. */
async function reachable(t: TestTenant, u: TestUser, consent = true) {
  const phone = phoneFor();
  phones.set(u.id, phone);
  const c = ctx.services.cipher;
  await runInTenant(t._id, () =>
    UserModel.updateOne(
      { _id: u.id },
      { $set: { phoneEnc: c.encrypt(phone), phoneIndex: c.blindIndex(phone), phoneVerifiedAt: new Date() } },
    ),
  );
  if (consent)
    await api(ctx, t.host, u.token)
      .post('/me/consents')
      .send({ purpose: 'whatsapp_updates', granted: true })
      .expect(200);
  return phone;
}
const outboxTo = (phone: string) => ctx.whatsapp.outbox.entries.filter((e) => e.to === phone);
const sign = (body: string) => `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
function webhook(host: string, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return request(ctx.app)
    .post('/api/v1/webhooks/whatsapp')
    .set('Host', host)
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', signature ?? sign(body))
    .send(body);
}
const tap = (id: string, from: string, payload: string) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            messages: [
              { id, from: from.replace('+', ''), type: 'button', button: { payload, text: 'Accept' } },
            ],
          },
        },
      ],
    },
  ],
});
async function notify(
  t: TestTenant,
  userId: string,
  type: Parameters<NotificationsService['notify']>[1],
  data: Record<string, string>,
) {
  await runInTenant(t._id, () => services.notifications.notify(userId, type, data));
  await ctx.queue.drain();
}
async function setFeature(t: TestTenant, on: boolean) {
  await TenantModel.updateOne({ _id: t._id }, { $set: { 'features.whatsapp': on } });
  invalidateTenant(t.slug);
}

beforeAll(async () => {
  T = await makeTenant('watest');
  U = await makeTenant('watest2');
  await makeTenant('admin', 'platform');
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  mentor = await makeMentor(ctx, T);
  await reachable(T, mentor);
});

describe('WhatsApp notifications (B3)', () => {
  it('a request reaches the mentor on WhatsApp with Accept and Decline, and a tap accepts it', async () => {
    const r = await api(ctx, T.host, student.token).post('/mentorship/requests').send({
      mentorId: mentor.id,
      sessionType: 'quick_chat',
      message: 'Goal: crack backend interviews\nWhat I need: one mock round',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await ctx.queue.drain();
    const phone = phones.get(mentor.id) ?? '';
    const sent = outboxTo(phone).at(-1);
    expect(sent).toMatchObject({ template: 'cl_request_received', lang: 'en' });
    // Names and session types only; the request text never leaves the app.
    expect(sent?.params.join(' ')).not.toContain('backend interviews');
    const buttons = sent?.params.filter((p) => p.startsWith('button:')).map((p) => p.slice(7)) ?? [];
    expect(buttons).toHaveLength(2);
    const msg = await runInTenant(T._id, () => ChannelMessageModel.findOne({ userId: mentor.id }).lean());
    expect(msg).toMatchObject({ template: 'cl_request_received', status: 'sent', critical: false });

    const tapped = await webhook('admin.localhost', tap('wamid.tap1', phone, buttons[0] ?? ''));
    expect(tapped.body.data).toMatchObject({ actions: 1 });
    const req = await runInTenant(T._id, () => MentorshipRequestModel.findById(r.body.data.id).lean());
    expect(req?.status).toBe('accepted');
    // The same delivery again is ignored.
    expect(
      (await webhook('admin.localhost', tap('wamid.tap1', phone, buttons[0] ?? ''))).body.data.actions,
    ).toBe(0);
  });

  it('refuses a bad signature, a tampered, expired, misdirected or cross-college token', async () => {
    const payload = tap('wamid.bad1', '+919999999999', 'x');
    expect((await webhook('admin.localhost', payload, 'sha256=00')).status).toBe(401);
    expect((await webhook('admin.localhost', payload, 'nope')).status).toBe(401);

    const second = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const r = await api(ctx, T.host, second.token).post('/mentorship/requests').send({
      mentorId: mentor.id,
      sessionType: 'quick_chat',
      message: 'Goal: system design practice\nWhat I need: one round',
    });
    const id = r.body.data.id as string;
    const phone = phones.get(mentor.id) ?? '';
    const good = await services.channels.signAction(String(T._id), mentor.id, 'request_accept', id);
    const tampered = `${good.slice(0, -4)}AAAA`;
    expect((await webhook('admin.localhost', tap('wamid.t1', phone, tampered))).body.data.actions).toBe(0);
    const key = new TextEncoder().encode('a'.repeat(40));
    const expired = await new SignJWT({ t: String(T._id), a: 'request_accept', r: id })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(mentor.id)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 10_000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect((await webhook('admin.localhost', tap('wamid.t2', phone, expired))).body.data.actions).toBe(0);
    // From a different number than the one the button went to.
    expect((await webhook('admin.localhost', tap('wamid.t3', '+919888888888', good))).body.data.actions).toBe(
      0,
    );
    // A token naming another college finds no such member there.
    const cross = await services.channels.signAction(String(U._id), mentor.id, 'request_accept', id);
    expect((await webhook('admin.localhost', tap('wamid.t4', phone, cross))).body.data.actions).toBe(0);
    const still = await runInTenant(T._id, () => MentorshipRequestModel.findById(id).lean());
    expect(still?.status).toBe('pending');
    // The real one works.
    expect((await webhook('admin.localhost', tap('wamid.t5', phone, good))).body.data.actions).toBe(1);
  });

  it('records delivery statuses by the provider message id', async () => {
    const msg = await runInTenant(T._id, () => ChannelMessageModel.findOne({ userId: mentor.id }).lean());
    const id = msg?.providerMessageId ?? '';
    const status = (s: string, mid: string) => ({
      entry: [
        { changes: [{ value: { statuses: [{ id, status: s, recipient_id: '91', timestamp: '1' }] } }] },
      ],
      mid,
    });
    expect((await webhook('admin.localhost', status('delivered', 'a'))).body.data.statuses).toBe(1);
    expect((await webhook('admin.localhost', status('delivered', 'b'))).body.data.statuses).toBe(0);
    expect((await webhook('admin.localhost', status('read', 'c'))).body.data.statuses).toBe(1);
    const after = await runInTenant(T._id, () => ChannelMessageModel.findById(msg?._id).lean());
    expect(after?.status).toBe('read');
  });

  it('answers free text once a day with a fixed reply, and stores nothing', async () => {
    const from = '+919777777777';
    const text = (id: string) => ({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id, from: '919777777777', type: 'text', text: { body: 'hello, my roll is 21X' } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect((await webhook('admin.localhost', text('wamid.x1'))).body.data.replies).toBe(1);
    expect((await webhook('admin.localhost', text('wamid.x2'))).body.data.replies).toBe(0);
    expect(outboxTo(from)).toHaveLength(1);
    expect(outboxTo(from)[0]?.template).toBe('text');
    expect(JSON.stringify(await runInTenant(T._id, () => ChannelMessageModel.find().lean()))).not.toContain(
      'my roll',
    );
  });

  it('the verification handshake echoes the challenge only for the right token', async () => {
    const ok = await request(ctx.app)
      .get(`/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`)
      .set('Host', 'admin.localhost');
    expect([ok.status, ok.text]).toEqual([200, '12345']);
    const bad = await request(ctx.app)
      .get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')
      .set('Host', 'admin.localhost');
    expect(bad.status).toBe(403);
  });

  it('a member without WhatsApp consent never gets WhatsApp', async () => {
    const m = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    const phone = await reachable(T, m, false);
    await notify(T, m.id, 'request_accepted', { name: 'Demo', sessionType: 'quick_chat' });
    expect(outboxTo(phone)).toHaveLength(0);
    expect(await runInTenant(T._id, () => NotificationModel.countDocuments({ userId: m.id }))).toBe(1);
  });

  it('caps non-critical messages at 2 a week per member and falls back; reminders still go', async () => {
    const m = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const phone = await reachable(T, m);
    const before = ctx.mailer.outbox.length;
    for (let i = 0; i < 3; i++)
      await notify(T, m.id, 'request_accepted', { name: `Mentor ${i}`, sessionType: 'quick_chat' });
    expect(outboxTo(phone)).toHaveLength(2);
    // The third went by email instead (the default for requests, plus the fallback).
    expect(ctx.mailer.outbox.length).toBeGreaterThan(before);
    await notify(T, m.id, 'booking_reminder', {
      name: 'Mentor',
      sessionType: 'video_1on1',
      start: new Date(Date.now() + 3600_000).toISOString(),
      bookingId: '0123456789abcdef01234567',
    });
    expect(outboxTo(phone).at(-1)?.template).toBe('cl_session_reminder');
  });

  it('waits for quiet hours like push', async () => {
    const m = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const phone = await reachable(T, m);
    const now = new Date();
    const hh = (h: number) => String((now.getUTCHours() + h + 24) % 24).padStart(2, '0');
    await api(ctx, T.host, m.token)
      .put('/me/notification-preferences')
      .send({
        channels: (await api(ctx, T.host, m.token).get('/me/notification-preferences')).body.data.channels,
        quietHours: { enabled: true, start: `${hh(-1)}:00`, end: `${hh(2)}:00`, timezone: 'UTC' },
      })
      .expect(200);
    await notify(T, m.id, 'request_accepted', { name: 'Later', sessionType: 'quick_chat' });
    expect(outboxTo(phone)).toHaveLength(0);
    await ctx.queue.runDelayed();
    expect(outboxTo(phone)).toHaveLength(1);
  });

  it('stops when the college switches WhatsApp off, and alerts admins near the allowance', async () => {
    const m = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const phone = await reachable(T, m);
    await setFeature(T, false);
    await notify(T, m.id, 'request_accepted', { name: 'Off', sessionType: 'quick_chat' });
    expect(outboxTo(phone)).toHaveLength(0);
    await setFeature(T, true);

    const admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
    // Pretend the month is nearly used.
    const day = new Date().toISOString().slice(0, 10);
    await runInTenant(T._id, () =>
      ChannelUsageModel.updateOne(
        { day, channel: 'whatsapp', category: 'requests' },
        { $inc: { count: 1600 } },
        { upsert: true },
      ),
    );
    await notify(T, m.id, 'request_accepted', { name: 'Near', sessionType: 'quick_chat' });
    expect(
      await runInTenant(T._id, () =>
        NotificationModel.countDocuments({ userId: admin.id, type: 'channel_budget_warning' }),
      ),
    ).toBe(1);
    const usage = (await api(ctx, T.host, admin.token).get('/admin/channels/usage')).body.data;
    expect(usage.sent).toBeGreaterThan(1600);
    expect((await api(ctx, T.host, student.token).get('/admin/channels/usage')).status).toBe(403);
    await runInTenant(T._id, () =>
      ChannelUsageModel.updateOne(
        { day, channel: 'whatsapp', category: 'requests' },
        { $inc: { count: 500 } },
      ),
    );
    const capped = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const cappedPhone = await reachable(T, capped);
    await notify(T, capped.id, 'request_accepted', { name: 'Over', sessionType: 'quick_chat' });
    expect(outboxTo(cappedPhone)).toHaveLength(0);
    expect(
      await runInTenant(T._id, () =>
        NotificationModel.countDocuments({ userId: admin.id, type: 'channel_budget_reached' }),
      ),
    ).toBe(1);
  });

  it('meters phone codes', async () => {
    const before = await runInTenant(T._id, () =>
      ChannelUsageModel.findOne({ category: 'authentication', channel: 'whatsapp' }).lean(),
    );
    await api(ctx, T.host)
      .post('/auth/phone/start')
      .send({ phone: phoneFor(), purpose: 'signup' })
      .expect(202);
    const after = await runInTenant(T._id, () =>
      ChannelUsageModel.findOne({ category: 'authentication', channel: 'whatsapp' }).lean(),
    );
    expect((after?.count ?? 0) - (before?.count ?? 0)).toBe(1);
  });
});

describe('provider adapters', () => {
  const capture = () => {
    const calls: {
      url: string;
      init: { headers?: Record<string, string>; body?: unknown; allowHosts?: readonly string[] };
    }[] = [];
    const reply = (body: unknown, status = 200): SafeResponse => ({
      status,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(body)),
      finalUrl: '',
    });
    return { calls, reply };
  };

  it('WhatsApp Cloud API: template with quick replies, authentication code with copy button', async () => {
    const { calls, reply } = capture();
    const fake = (async (url: string, init: never) => {
      calls.push({ url, init });
      return reply({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] });
    }) as never;
    const wa = new CloudWhatsAppProvider(
      { token: 'tok', phoneNumberId: '1234567', graphVersion: 'v99.0', authTemplate: 'auth_code' },
      fake,
    );
    expect(
      await wa.sendTemplate(
        '+919848022338',
        'cl_request_received',
        'te',
        ['Asha', 'quick chat'],
        [{ payload: 'P1' }],
      ),
    ).toEqual({ messageId: 'wamid.ABC' });
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v99.0/1234567/messages');
    expect(calls[0]?.init.allowHosts).toEqual(['graph.facebook.com']);
    expect(calls[0]?.init.headers?.authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919848022338',
      type: 'template',
      template: {
        name: 'cl_request_received',
        language: { code: 'te' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Asha' },
              { type: 'text', text: 'quick chat' },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: 'P1' }],
          },
        ],
      },
    });
    await wa.sendAuthCode('+919848022338', '123456', 'en');
    expect(JSON.parse(String(calls[1]?.init.body)).template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
    ]);
    const failing = new CloudWhatsAppProvider(
      { token: 't', phoneNumberId: '1', graphVersion: 'v1.0', authTemplate: 'a' },
      (async () => reply({ error: { code: 131026 } }, 400)) as never,
    );
    await expect(failing.sendText('+919848022338', 'x')).rejects.toThrow(/131026/);
  });

  it('MSG91: flow template with variables and the auth key header', async () => {
    const { calls, reply } = capture();
    const sms = new Msg91SmsProvider(
      { authKey: 'key', senderId: 'CMPLNK', dltEntityId: '1101234567890123456' },
      (async (url: string, init: never) => {
        calls.push({ url, init });
        return reply({ type: 'success', message: 'req-1' });
      }) as never,
    );
    expect(await sms.sendTemplate('+919848022338', 'tmpl-otp', ['654321'])).toEqual({ messageId: 'req-1' });
    expect(calls[0]?.url).toBe('https://control.msg91.com/api/v5/flow');
    expect(calls[0]?.init.headers?.authkey).toBe('key');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      template_id: 'tmpl-otp',
      short_url: '0',
      recipients: [{ mobiles: '919848022338', var1: '654321' }],
    });
  });

  it('production needs every Cloud API and MSG91 setting', () => {
    expect(() => loadEnv({ NODE_ENV: 'test', WHATSAPP_PROVIDER: 'cloud' })).toThrow(/WHATSAPP_TOKEN/);
    expect(() => loadEnv({ NODE_ENV: 'test', SMS_PROVIDER: 'msg91' })).toThrow(/SMS_API_KEY/);
  });
});
