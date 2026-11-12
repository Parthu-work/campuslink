import { istDay } from '@campuslink/shared';
import { NotificationPrefsModel } from './notification.model.js';
import type { NotificationsService } from './notifications.service.js';
import { UserModel } from '../auth/user.model.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { withPlatformScope } from '../../lib/context.js';
import type { JobQueue } from '../../lib/jobs.js';

export const DIGEST_JOB = 'notifications.weekly_digest';
const IST_MS = 5.5 * 3600_000;

/** What the digest counts, from the services that own each (modules talk through services). */
export interface DigestDeps {
  notifications: NotificationsService;
  /** Drives opened this week, still open, the member is eligible for and not registered for. */
  newDrives: (userIds: string[], now: Date) => Promise<Map<string, number>>;
  /** Mentorship requests waiting for the member's reply. */
  pendingRequests: (userIds: string[]) => Promise<Map<string, number>>;
  /** The member's sessions in the next seven days. */
  sessionsThisWeek: (userIds: string[], now: Date) => Promise<Map<string, number>>;
}

/**
 * The weekly digest (prompt 1b, R8). Once a week per college (Monday from 09:00 IST), members who
 * turned it on get their first name and three counts on WhatsApp, or by push or email when WhatsApp
 * cannot carry it (not opted in, the weekly cap, the college's allowance). Nothing when nothing is
 * new. The job is gated on the college's `whatsapp` switch.
 */
export class DigestService {
  constructor(private readonly d: DigestDeps) {}

  /** The Monday (IST) that starts `now`'s week: the job id, so each college runs once a week. */
  static weekOf(now: Date): string {
    const ist = new Date(now.getTime() + IST_MS);
    const back = (ist.getUTCDay() + 6) % 7; // days since Monday
    return istDay(new Date(now.getTime() - back * 86_400_000));
  }

  /** The scheduler (prompt 4, P5): colleges where at least one member turned the digest on. */
  static async optedInTenantIds(): Promise<Set<string>> {
    const ids = await withPlatformScope('scheduler:digest-opted-in', () =>
      NotificationPrefsModel.distinct('tenantId', { weeklyDigest: true }),
    );
    return new Set(ids.map(String));
  }

  /** Queues this week's run per active college, from Monday 09:00 IST (job ids dedupe per week). */
  static async enqueueWeekly(jobs: JobQueue, now = new Date(), only?: ReadonlySet<string>): Promise<number> {
    const ist = new Date(now.getTime() + IST_MS);
    const monday = ist.getUTCDay() === 1;
    if (monday && ist.getUTCHours() < 9) return 0;
    const week = DigestService.weekOf(now).replaceAll('-', '');
    const tenants = (
      await TenantModel.find({ kind: 'college', status: 'active' }).select('_id').lean()
    ).filter((t) => !only || only.has(String(t._id)));
    for (const t of tenants)
      await jobs.enqueue(
        DIGEST_JOB,
        { tenantId: String(t._id) },
        { jobId: `digest-${String(t._id)}-${week}` },
      );
    return tenants.length;
  }

  /** In one college: every member who turned the digest on and has something new. */
  async run(now = new Date()): Promise<{ sent: number; skipped: number }> {
    const ids = (
      await NotificationPrefsModel.find({ weeklyDigest: true }).select('userId').lean<{ userId: unknown }[]>()
    ).map((p) => String(p.userId));
    if (!ids.length) return { sent: 0, skipped: 0 };
    const users = await UserModel.find({ _id: { $in: ids }, status: 'active' })
      .select('name')
      .lean<{ _id: unknown; name: string }[]>();
    const active = users.map((u) => String(u._id));
    const [drives, requests, sessions] = await Promise.all([
      this.d.newDrives(active, now),
      this.d.pendingRequests(active),
      this.d.sessionsThisWeek(active, now),
    ]);
    let sent = 0;
    for (const u of users) {
      const id = String(u._id);
      const counts = {
        drives: drives.get(id) ?? 0,
        requests: requests.get(id) ?? 0,
        sessions: sessions.get(id) ?? 0,
      };
      // Never when there is nothing new.
      if (!counts.drives && !counts.requests && !counts.sessions) continue;
      await this.d.notifications.notify(id, 'weekly_digest', {
        name: u.name.trim().split(/\s+/)[0] ?? '',
        drives: String(counts.drives),
        requests: String(counts.requests),
        sessions: String(counts.sessions),
      });
      sent++;
    }
    return { sent, skipped: users.length - sent };
  }
}
