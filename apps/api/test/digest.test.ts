import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { invalidateTenant } from '../src/modules/tenants/tenant.cache.js';
import { MentorshipRequestModel } from '../src/modules/mentorship/request.model.js';
import { BookingModel } from '../src/modules/sessions/booking.model.js';
import {
  ChannelMessageModel,
  ChannelUsageModel,
} from '../src/modules/notifications/channels/channel.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { DIGEST_JOB, DigestService } from '../src/modules/notifications/digest.service.js';
import type { InlineJobQueue } from '../src/lib/jobs.js';

/** The weekly WhatsApp digest (prompt 1b, R8). */
const ctx = testApp();
const digest = () => (ctx.app.locals.services as { digest: DigestService }).digest;
let T: TestTenant;
let n = 0;
const phoneFor = () => `+9198${String(31_000_000 + ++n * 6113).padStart(8, '0')}`;

/** A member who turned the digest on (or not), with a verified number and maybe WhatsApp consent. */
async function member(opts: { digest?: boolean; whatsapp?: boolean; name?: string } = {}) {
  const u = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  const phone = phoneFor();
  const c = ctx.services.cipher;
  await runInTenant(T._id, () =>
    UserModel.updateOne(
      { _id: u.id },
      {
        $set: {
          name: opts.name ?? 'Kiran Rao (demo)',
          phoneEnc: c.encrypt(phone),
          phoneIndex: c.blindIndex(phone),
          phoneVerifiedAt: new Date(),
        },
      },
    ),
  );
  if (opts.whatsapp)
    await api(ctx, T.host, u.token)
      .post('/me/consents')
      .send({ purpose: 'whatsapp_updates', granted: true })
      .expect(200);
  if (opts.digest) {
    const prefs = (await api(ctx, T.host, u.token).get('/me/notification-preferences')).body.data;
    expect(prefs.weeklyDigest).toBe(false);
    await api(ctx, T.host, u.token)
      .put('/me/notification-preferences')
      .send({ ...prefs, weeklyDigest: true })
      .expect(200);
  }
  return { u, phone };
}
async function pendingRequests(mentor: TestUser, count: number) {
  await runInTenant(T._id, async () => {
    for (let i = 0; i < count; i++)
      await MentorshipRequestModel.create({
        menteeId: new Types.ObjectId(),
        mentorId: new Types.ObjectId(mentor.id),
        sessionType: 'quick_chat',
        message: 'Private request text that must never leave the app',
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      });
  });
}
async function sessionIn(u: TestUser, days: number) {
  const other = new Types.ObjectId();
  const start = new Date(Date.now() + days * 86_400_000);
  await runInTenant(T._id, () =>
    BookingModel.create({
      requestId: new Types.ObjectId(),
      mentorId: other,
      menteeId: new Types.ObjectId(u.id),
      participants: [other, new Types.ObjectId(u.id)],
      sessionType: 'quick_chat',
      start,
      end: new Date(start.getTime() + 30 * 60_000),
      holds: [`${String(other)}|${start.toISOString()}`],
      room: `room-${n}`,
    }),
  );
}
const waTo = (phone: string) => ctx.whatsapp.outbox.entries.filter((e) => e.to === phone);
const mailsTo = (email: string) => ctx.mailer.outbox.filter((m) => m.to === email);
const run = async () => {
  const r = await runInTenant(T._id, () => digest().run());
  await ctx.queue.drain();
  return r;
};

beforeAll(async () => {
  T = await makeTenant('digest');
});

describe('weekly digest (prompt 1b, R8)', () => {
  it('reaches a member who turned it on, on WhatsApp: first name and counts only, never in the in-app list', async () => {
    const { u, phone } = await member({ digest: true, whatsapp: true });
    await pendingRequests(u, 2);
    await sessionIn(u, 2);
    await run();
    const sent = waTo(phone);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ template: 'cl_weekly_digest', params: ['Kiran', '0', '2', '1'] });
    expect(sent[0]?.params.join(' ')).not.toContain('Private request');
    expect(
      await runInTenant(T._id, () =>
        NotificationModel.countDocuments({ userId: u.id, type: 'weekly_digest' }),
      ),
    ).toBe(0);
    const msg = await runInTenant(T._id, () => ChannelMessageModel.findOne({ userId: u.id }).lean());
    expect(msg).toMatchObject({ template: 'cl_weekly_digest', critical: false });
  });

  it('off by default, and never when the member has nothing new', async () => {
    const off = await member({ whatsapp: true });
    await pendingRequests(off.u, 1);
    const quiet = await member({ digest: true, whatsapp: true });
    const r = await run();
    expect(waTo(off.phone)).toHaveLength(0);
    expect(waTo(quiet.phone)).toHaveLength(0);
    expect(mailsTo(quiet.u.email)).toHaveLength(0);
    expect(r.skipped).toBeGreaterThan(0);
  });

  it('falls back to email when WhatsApp cannot carry it (not opted in, or the weekly cap)', async () => {
    const noWa = await member({ digest: true });
    await sessionIn(noWa.u, 1);
    const capped = await member({ digest: true, whatsapp: true });
    await pendingRequests(capped.u, 1);
    // The member's two non-critical WhatsApp messages this week are used up.
    await runInTenant(T._id, () =>
      ChannelMessageModel.insertMany(
        [1, 2].map((i) => ({
          userId: new Types.ObjectId(capped.u.id),
          channel: 'whatsapp',
          template: 'cl_request_accepted',
          category: 'requests',
          critical: false,
          providerMessageId: `cap-${i}-${capped.u.id}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        })),
      ),
    );
    await run();
    expect(waTo(noWa.phone)).toHaveLength(0);
    expect(mailsTo(noWa.u.email).map((m) => m.subject)).toEqual([
      expect.stringContaining('Your week, Kiran'),
    ]);
    expect(waTo(capped.phone)).toHaveLength(0);
    expect(mailsTo(capped.u.email)).toHaveLength(1);
  });

  it('counts against the college’s allowance, and falls back when it is used up', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const allowance = (
      await api(ctx, T.host, (await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true })).token).get(
        '/admin/channels/usage',
      )
    ).body.data.allowance;
    await runInTenant(T._id, () =>
      ChannelUsageModel.updateOne(
        { day, channel: 'whatsapp', category: 'reminders' },
        { $inc: { count: allowance } },
        { upsert: true },
      ),
    );
    const m = await member({ digest: true, whatsapp: true });
    await pendingRequests(m.u, 1);
    await run();
    expect(waTo(m.phone)).toHaveLength(0);
    expect(mailsTo(m.u.email)).toHaveLength(1);
    await runInTenant(T._id, () =>
      ChannelUsageModel.updateOne(
        { day, channel: 'whatsapp', category: 'reminders' },
        { $inc: { count: -allowance } },
      ),
    );
  });

  it('is a gated job: nothing while the college has WhatsApp off', async () => {
    const m = await member({ digest: true, whatsapp: true });
    await pendingRequests(m.u, 1);
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'features.whatsapp': false } });
    invalidateTenant(T.slug);
    try {
      await (ctx.queue as InlineJobQueue).enqueue(DIGEST_JOB, { tenantId: String(T._id) });
      await ctx.queue.drain();
      expect(waTo(m.phone)).toHaveLength(0);
      expect(mailsTo(m.u.email)).toHaveLength(0);
    } finally {
      await TenantModel.updateOne({ _id: T._id }, { $set: { 'features.whatsapp': true } });
      invalidateTenant(T.slug);
    }
    await (ctx.queue as InlineJobQueue).enqueue(DIGEST_JOB, { tenantId: String(T._id) });
    await ctx.queue.drain();
    expect(waTo(m.phone)).toHaveLength(1);
  });

  it('runs once a week per college, from Monday 09:00 IST', async () => {
    // Monday 2 November 2026: 08:00 IST is 02:30 UTC; 10:00 IST is 04:30 UTC.
    expect(DigestService.weekOf(new Date('2026-11-02T04:30:00Z'))).toBe('2026-11-02');
    expect(DigestService.weekOf(new Date('2026-11-08T17:00:00Z'))).toBe('2026-11-02'); // Sunday 22:30 IST
    expect(DigestService.weekOf(new Date('2026-11-08T19:00:00Z'))).toBe('2026-11-09'); // Monday 00:30 IST
    const ids: string[] = [];
    const jobs = {
      enqueue: async (_n: string, _d: unknown, o?: { jobId?: string }) => {
        ids.push(o?.jobId ?? '');
      },
    } as unknown as InlineJobQueue;
    expect(await DigestService.enqueueWeekly(jobs, new Date('2026-11-02T02:30:00Z'))).toBe(0);
    expect(await DigestService.enqueueWeekly(jobs, new Date('2026-11-02T04:30:00Z'))).toBeGreaterThan(0);
    await DigestService.enqueueWeekly(jobs, new Date('2026-11-05T10:00:00Z'));
    expect(ids.filter((i) => i === `digest-${String(T._id)}-20261102`)).toHaveLength(2); // same id: deduped
  });
});
