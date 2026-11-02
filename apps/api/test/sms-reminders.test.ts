import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { loadEnv } from '../src/config/env.js';
import { runInTenant } from '../src/lib/context.js';
import { metrics } from '../src/lib/metrics.js';
import { ConsoleWhatsAppProvider } from '../src/lib/whatsapp.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import {
  ChannelMessageModel,
  ChannelUsageModel,
} from '../src/modules/notifications/channels/channel.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import type { NotificationsService } from '../src/modules/notifications/notifications.service.js';

/** SMS for critical reminders (prompt 1b, R4). */
class FlakyWhatsApp extends ConsoleWhatsAppProvider {
  fail = false;
  override async sendTemplate(...a: Parameters<ConsoleWhatsAppProvider['sendTemplate']>) {
    if (this.fail) throw new Error('provider down');
    return super.sendTemplate(...a);
  }
}

const base = {
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://*.localhost:5173',
  HIBP_ENABLED: 'false',
};
const IDS = { session_reminder: '1107000000000000001', drive_reminder: '1107000000000000002' };
const HI_SESSION = '1107000000000000003';
const whatsapp = new FlakyWhatsApp();
const ctx = testApp({
  env: loadEnv({
    ...base,
    SMS_DLT_TEMPLATE_IDS: `session_reminder=${IDS.session_reminder},drive_reminder=${IDS.drive_reminder},session_reminder_hi=${HI_SESSION}`,
  }),
  whatsapp,
});
/** The same deployment before the owner registered the reminder templates. */
const unregistered = testApp({ env: loadEnv(base) });
const notifications = (c: typeof ctx) =>
  (c.app.locals.services as { notifications: NotificationsService }).notifications;

let T: TestTenant;
let n = 0;
const phoneFor = () => `+9197${String(41_000_000 + ++n * 7919).padStart(8, '0')}`;

/** A member with a verified number (and, optionally, WhatsApp consent and a language). */
async function member(opts: { phone?: boolean; whatsapp?: boolean; locale?: string; name?: string } = {}) {
  const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
  const phone = phoneFor();
  const c = ctx.services.cipher;
  await runInTenant(T._id, () =>
    UserModel.updateOne(
      { _id: u.id },
      {
        $set: {
          name: opts.name ?? 'Asha Reddy (demo)',
          locale: opts.locale ?? 'en',
          ...(opts.phone === false
            ? {}
            : { phoneEnc: c.encrypt(phone), phoneIndex: c.blindIndex(phone), phoneVerifiedAt: new Date() }),
        },
      },
    ),
  );
  if (opts.whatsapp)
    await api(ctx, T.host, u.token)
      .post('/me/consents')
      .send({ purpose: 'whatsapp_updates', granted: true })
      .expect(200);
  return { u, phone };
}
const smsTo = (c: typeof ctx, phone: string) => c.sms.outbox.entries.filter((e) => e.to === phone);
const waTo = (phone: string) => whatsapp.outbox.entries.filter((e) => e.to === phone);
const start = () => new Date(Date.now() + 3600_000).toISOString();
const session = (when = '1h') => ({
  name: 'Ravi (demo)',
  sessionType: 'quick_chat',
  start: start(),
  bookingId: '64b000000000000000000001',
  when,
});
const drive = () => ({ company: 'Demo Corp', driveId: '64b000000000000000000002', start: start() });

async function notify(
  u: TestUser,
  type: 'booking_reminder' | 'drive_reminder' | 'request_accepted',
  data: Record<string, string>,
  c = ctx,
) {
  await runInTenant(T._id, () => notifications(c).notify(u.id, type, data));
  await c.queue.drain();
}

beforeAll(async () => {
  T = await makeTenant('smsrem');
});

describe('SMS reminders: when they go', () => {
  it('a session about to start reaches a member without WhatsApp by SMS: first name, time and link only', async () => {
    const before = metrics.smsReminders.get({ template: 'session_reminder', outcome: 'sent' });
    const { u, phone } = await member();
    await notify(u, 'booking_reminder', session());
    const sms = smsTo(ctx, phone);
    expect(sms).toHaveLength(1);
    expect(sms[0]?.template).toBe(IDS.session_reminder);
    const [first, time, link] = sms[0]?.params ?? [];
    expect(first).toBe('Asha');
    expect(time).toMatch(/\d/);
    expect(link).toMatch(/^https?:\/\/smsrem\./);
    // Never the other person's name or anything else from the notification.
    expect(sms[0]?.params.join(' ')).not.toContain('Ravi');
    const msg = await runInTenant(T._id, () =>
      ChannelMessageModel.findOne({ userId: u.id, channel: 'sms' }).lean(),
    );
    expect(msg).toMatchObject({ template: 'session_reminder', critical: true, category: 'reminders' });
    expect(metrics.smsReminders.get({ template: 'session_reminder', outcome: 'sent' })).toBe(before + 1);
  });

  it('a drive about to close goes by SMS too', async () => {
    const { u, phone } = await member();
    await notify(u, 'drive_reminder', drive());
    expect(smsTo(ctx, phone).map((e) => e.template)).toEqual([IDS.drive_reminder]);
  });

  it('never for anything else: the day-before session reminder or a non-critical type', async () => {
    const { u, phone } = await member();
    await notify(u, 'booking_reminder', session('24h'));
    await notify(u, 'request_accepted', { name: 'Ravi (demo)', sessionType: 'quick_chat' });
    expect(smsTo(ctx, phone)).toHaveLength(0);
  });

  it('not when WhatsApp delivered it', async () => {
    const { u, phone } = await member({ whatsapp: true });
    await notify(u, 'booking_reminder', session());
    expect(waTo(phone)).toHaveLength(1);
    expect(smsTo(ctx, phone)).toHaveLength(0);
  });

  it('when the WhatsApp send failed', async () => {
    const { u, phone } = await member({ whatsapp: true });
    whatsapp.fail = true;
    try {
      await notify(u, 'drive_reminder', drive());
    } finally {
      whatsapp.fail = false;
    }
    expect(waTo(phone)).toHaveLength(0);
    expect(smsTo(ctx, phone)).toHaveLength(1);
  });

  it('not without a verified number', async () => {
    const { u, phone } = await member({ phone: false });
    await notify(u, 'booking_reminder', session());
    expect(smsTo(ctx, phone)).toHaveLength(0);
  });

  it('not when the member turned SMS reminders off (on by default)', async () => {
    const { u, phone } = await member();
    const prefs = await api(ctx, T.host, u.token).get('/me/notification-preferences');
    expect(prefs.body.data.smsReminders).toBe(true);
    const off = await api(ctx, T.host, u.token)
      .put('/me/notification-preferences')
      .send({ ...prefs.body.data, smsReminders: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.data.smsReminders).toBe(false);
    await notify(u, 'booking_reminder', session());
    await notify(u, 'drive_reminder', drive());
    expect(smsTo(ctx, phone)).toHaveLength(0);
  });

  it('not before the template is registered on DLT', async () => {
    const { u, phone } = await member();
    await notify(u, 'booking_reminder', session(), unregistered);
    expect(smsTo(unregistered, phone)).toHaveLength(0);
  });

  it('in the member’s language once that template is registered, else in English', async () => {
    const hi = await member({ locale: 'hi' });
    await notify(hi.u, 'booking_reminder', session());
    expect(smsTo(ctx, hi.phone).map((e) => e.template)).toEqual([HI_SESSION]);
    const te = await member({ locale: 'te' });
    await notify(te.u, 'booking_reminder', session());
    expect(smsTo(ctx, te.phone).map((e) => e.template)).toEqual([IDS.session_reminder]);
  });

  it('waits for quiet hours to end (drive reminders), like the other channels', async () => {
    const { u, phone } = await member();
    const now = new Date();
    const hhmm = (d: Date) => d.toISOString().slice(11, 16);
    await api(ctx, T.host, u.token)
      .put('/me/notification-preferences')
      .send({
        ...(await api(ctx, T.host, u.token).get('/me/notification-preferences')).body.data,
        quietHours: {
          enabled: true,
          start: hhmm(new Date(now.getTime() - 3600_000)),
          end: hhmm(new Date(now.getTime() + 3600_000)),
          timezone: 'UTC',
        },
      })
      .expect(200);
    await notify(u, 'drive_reminder', drive());
    expect(smsTo(ctx, phone)).toHaveLength(0);
    await ctx.queue.runDelayed();
    expect(smsTo(ctx, phone)).toHaveLength(1);
  });
});

describe('SMS reminders: metering', () => {
  it('count against the college’s allowance, alert admins, and stop at it', async () => {
    const admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
    const day = new Date().toISOString().slice(0, 10);
    const usage = () => api(ctx, T.host, admin.token).get('/admin/channels/usage');
    const before = (await usage()).body.data;
    const { u, phone } = await member();
    await notify(u, 'booking_reminder', session());
    expect((await usage()).body.data.sent).toBe(before.sent + 1);
    // Codes by SMS are metered on their own and do not use up the allowance.
    await runInTenant(T._id, () =>
      ChannelUsageModel.updateOne(
        { day, channel: 'sms', category: 'authentication' },
        { $inc: { count: 5000 } },
        { upsert: true },
      ),
    );
    expect((await usage()).body.data.sent).toBe(before.sent + 1);
    // Fill the month to the allowance with reminders.
    await runInTenant(T._id, () =>
      ChannelUsageModel.updateOne(
        { day, channel: 'sms', category: 'placements' },
        { $inc: { count: before.allowance } },
        { upsert: true },
      ),
    );
    const capped = await member();
    await notify(capped.u, 'drive_reminder', drive());
    expect(smsTo(ctx, capped.phone)).toHaveLength(0);
    expect(smsTo(ctx, phone)).toHaveLength(1);
    expect(
      await runInTenant(T._id, () =>
        NotificationModel.countDocuments({ userId: admin.id, type: 'channel_budget_reached' }),
      ),
    ).toBe(1);
    expect(metrics.smsReminders.get({ template: 'drive_reminder', outcome: 'capped' })).toBeGreaterThan(0);
  });
});
