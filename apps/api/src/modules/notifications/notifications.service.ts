import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  CATEGORY_OF,
  DEFAULT_CHANNELS,
  DEFAULT_TIMEZONE,
  type Locale,
  type NotificationPrefs,
  type NotificationType,
  type NotificationView,
  type notificationsQuery,
  type pushSubscriptionBody,
} from '@campuslink/shared';
import {
  NotificationModel,
  NotificationPrefsModel,
  PushSubscriptionModel,
  type NotificationDoc,
} from './notification.model.js';
import { pathFor, renderNotification } from './templates.js';
import type { PushSender } from './push.js';
import { UserModel } from '../auth/user.model.js';
import { findTenantById, type TenantRecord } from '../tenants/tenant.cache.js';
import { requireTenantId } from '../../lib/context.js';
import { renderEmail, type MailProvider } from '../../lib/mailer.js';
import type { FieldCipher } from '../../lib/crypto.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { Logger } from '../../lib/logger.js';
import type { RealtimeGateway } from '../../http/realtime.js';
import { zonedParts } from '../../lib/timezone.js';
import type { AuthState } from '../../types.js';
import { APP_NAME } from '@campuslink/shared';

export const DELIVER_JOB = 'notifications.deliver';
const RETENTION_MS = 90 * 24 * 3600_000;
/** Time-critical types ignore quiet hours (the member chose the session time). */
const IGNORES_QUIET_HOURS: readonly NotificationType[] = ['booking_reminder'];

export interface NotificationsDeps {
  mailer: MailProvider;
  logger: Logger;
  cipher: FieldCipher;
  push: PushSender;
  realtime: RealtimeGateway;
  jobs: JobQueue;
  tenantUrl: (tenant: TenantRecord, path: string) => string;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Milliseconds until quiet hours end, or 0 when not in quiet hours. */
export function quietDelayMs(q: NotificationPrefs['quietHours'], now = new Date()): number {
  if (!q.enabled || q.start === q.end) return 0;
  const m = zonedParts(now, q.timezone).minutes;
  const start = toMin(q.start);
  const end = toMin(q.end);
  let wait = 0;
  if (start < end) wait = m >= start && m < end ? end - m : 0;
  else if (m >= start) wait = 1440 - m + end;
  else if (m < end) wait = end - m;
  return wait * 60_000;
}

const view = (n: NotificationDoc): NotificationView => ({
  id: String(n._id),
  type: n.type as NotificationType,
  data: Object.fromEntries(n.data instanceof Map ? n.data : Object.entries(n.data ?? {})) as Record<
    string,
    string
  >,
  readAt: n.readAt ? n.readAt.toISOString() : null,
  createdAt: n.createdAt.toISOString(),
});

export class NotificationsService {
  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const [notifications, preferences] = await Promise.all([
      NotificationModel.find({ userId }).select('type data readAt createdAt').limit(5000).lean(),
      NotificationPrefsModel.findOne({ userId }).lean(),
    ]);
    return { notifications, preferences };
  }

  async eraseFor(userId: string) {
    const u = new Types.ObjectId(userId);
    await Promise.all([
      NotificationModel.deleteMany({ userId: u }),
      NotificationPrefsModel.deleteMany({ userId: u }),
      PushSubscriptionModel.deleteMany({ userId: u }),
    ]);
  }

  constructor(private readonly d: NotificationsDeps) {}

  async prefs(userId: string | Types.ObjectId): Promise<NotificationPrefs> {
    const p = await NotificationPrefsModel.findOne({ userId }).lean();
    const channels = { ...DEFAULT_CHANNELS };
    for (const k of Object.keys(channels) as (keyof typeof channels)[]) {
      const c = p?.channels?.[k];
      if (c && typeof c.inApp === 'boolean')
        channels[k] = { inApp: !!c.inApp, email: !!c.email, push: !!c.push };
    }
    return {
      channels,
      quietHours: {
        enabled: p?.quietHours?.enabled ?? false,
        start: p?.quietHours?.start ?? '22:00',
        end: p?.quietHours?.end ?? '07:00',
        timezone: p?.quietHours?.timezone ?? DEFAULT_TIMEZONE,
      },
    };
  }

  async updatePrefs(viewer: AuthState, body: NotificationPrefs) {
    await NotificationPrefsModel.updateOne(
      { userId: viewer.userId },
      { $set: { channels: body.channels, quietHours: body.quietHours } },
      { upsert: true },
    );
    return this.prefs(viewer.userId);
  }

  /**
   * Notifies a member in the current tenant. In-app is immediate (and live over the socket);
   * email and push go through the job queue, after quiet hours where they apply.
   */
  async notify(
    userId: string | Types.ObjectId,
    type: NotificationType,
    data: Record<string, string>,
    opts: { noEmail?: boolean } = {},
  ): Promise<{ emailQueued: boolean }> {
    const tenantId = requireTenantId();
    const uid = String(userId);
    const prefs = await this.prefs(uid);
    const ch = prefs.channels[CATEGORY_OF[type]];
    if (ch.inApp) {
      if (type === 'new_message') {
        // Messages show as a live toast and an unread badge, not as stored notifications.
        this.d.realtime.emitToUser(tenantId, uid, 'notification:new', {
          id: `live-${randomBytes(6).toString('hex')}`,
          type,
          data,
          readAt: null,
          createdAt: new Date().toISOString(),
        });
      } else {
        const doc = await NotificationModel.create({
          userId: new Types.ObjectId(uid),
          type,
          data,
          expiresAt: new Date(Date.now() + RETENTION_MS),
        });
        this.d.realtime.emitToUser(
          tenantId,
          uid,
          'notification:new',
          view(doc.toObject() as NotificationDoc),
        );
      }
    }
    const email = ch.email && !opts.noEmail;
    const push = ch.push && this.d.push.enabled;
    if (!email && !push) return { emailQueued: false };
    if (type === 'new_message' && (await this.d.realtime.isOnline(tenantId, uid)))
      return { emailQueued: false };
    const delayMs = IGNORES_QUIET_HOURS.includes(type) ? 0 : quietDelayMs(prefs.quietHours);
    await this.d.jobs.enqueue(
      DELIVER_JOB,
      { tenantId: String(tenantId), userId: uid, type, data, email, push },
      delayMs ? { delayMs } : {},
    );
    return { emailQueued: email };
  }

  /** Job handler: email and push for one notification (runs inside the tenant context). */
  async deliver(job: TenantJob): Promise<void> {
    const type = job.type as NotificationType;
    const data = job.data as Record<string, string>;
    const user = await UserModel.findById(job.userId).select('email locale status').lean();
    const tenant = await findTenantById(job.tenantId);
    if (!user || user.status !== 'active' || !tenant || tenant.status !== 'active') return;
    const locale = (user.locale === 'te' ? 'te' : 'en') as Locale;
    const prefs = await this.prefs(String(job.userId));
    const text = renderNotification(type, data, locale, prefs.quietHours.timezone);
    const path = pathFor(type, data);
    if (job.email) {
      const content = renderEmail({
        college: tenant.branding.displayName,
        heading: text.title,
        body: text.body,
        cta: { label: text.open, url: this.d.tenantUrl(tenant, path) },
        footer: `${APP_NAME} · ${text.footer}`,
      });
      await this.d.mailer
        .send({ to: user.email, subject: `${text.title} · ${tenant.branding.shortName}`, ...content })
        .catch((err: unknown) => this.d.logger.error({ err, type }, 'notification email failed'));
    }
    if (job.push)
      await this.sendPush(String(job.userId), { title: text.title, body: text.body, url: path, tag: type });
  }

  private async sendPush(userId: string, payload: { title: string; body: string; url: string; tag: string }) {
    const subs = await PushSubscriptionModel.find({ userId }).lean();
    for (const s of subs) {
      const target = {
        endpoint: this.d.cipher.decrypt(s.endpointEnc),
        keys: JSON.parse(this.d.cipher.decrypt(s.keysEnc)) as { p256dh: string; auth: string },
      };
      const result = await this.d.push.send(target, JSON.stringify(payload));
      if (result === 'gone' || (result === 'failed' && s.failures >= 4))
        await PushSubscriptionModel.deleteOne({ _id: s._id });
      else if (result === 'failed')
        await PushSubscriptionModel.updateOne({ _id: s._id }, { $inc: { failures: 1 } });
      else
        await PushSubscriptionModel.updateOne(
          { _id: s._id },
          { $set: { failures: 0, lastUsedAt: new Date() } },
        );
    }
  }

  async list(viewer: AuthState, q: z.output<typeof notificationsQuery>) {
    const rows = await NotificationModel.find({
      userId: viewer.userId,
      ...(q.unread === 'true' ? { readAt: null } : {}),
      ...(q.cursor ? { _id: { $lt: new Types.ObjectId(q.cursor) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(31)
      .lean<NotificationDoc[]>();
    const page = rows.slice(0, 30);
    return { items: page.map(view), nextCursor: rows.length > 30 ? String(page.at(-1)?._id) : null };
  }

  async unreadCount(viewer: AuthState) {
    return { count: await NotificationModel.countDocuments({ userId: viewer.userId, readAt: null }) };
  }

  async markRead(viewer: AuthState, body: { ids?: string[] | undefined; all?: boolean | undefined }) {
    const filter: Record<string, unknown> = { userId: viewer.userId, readAt: null };
    if (!body.all) filter._id = { $in: body.ids ?? [] };
    const r = await NotificationModel.updateMany(filter, { $set: { readAt: new Date() } });
    return { updated: r.modifiedCount };
  }

  pushConfig() {
    return { enabled: this.d.push.enabled, publicKey: this.d.push.publicKey };
  }

  async subscribe(viewer: AuthState, body: z.output<typeof pushSubscriptionBody>) {
    // The same browser may move between accounts in a college: the latest sign-in owns it. Any
    // key's index matches; the write stores the current key's (re-indexes during a rotation).
    await PushSubscriptionModel.updateOne(
      { endpointIndex: { $in: this.d.cipher.blindIndexes(body.endpoint) } },
      {
        $set: {
          endpointIndex: this.d.cipher.blindIndex(body.endpoint),
          userId: new Types.ObjectId(viewer.userId),
          endpointEnc: this.d.cipher.encrypt(body.endpoint),
          keysEnc: this.d.cipher.encrypt(JSON.stringify(body.keys)),
          failures: 0,
        },
      },
      { upsert: true },
    );
    const count = await PushSubscriptionModel.countDocuments({ userId: viewer.userId });
    if (count > 10) {
      const oldest = await PushSubscriptionModel.find({ userId: viewer.userId })
        .sort({ updatedAt: 1 })
        .limit(count - 10)
        .select('_id')
        .lean();
      await PushSubscriptionModel.deleteMany({ _id: { $in: oldest.map((o) => o._id) } });
    }
    return { subscribed: true };
  }

  async unsubscribe(viewer: AuthState, endpoint: string) {
    await PushSubscriptionModel.deleteOne({
      userId: viewer.userId,
      endpointIndex: { $in: this.d.cipher.blindIndexes(endpoint) },
    });
    return { subscribed: false };
  }
}
