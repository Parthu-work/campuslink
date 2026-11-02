import { INACTIVE_WARNING_DAYS } from '@campuslink/shared';
import type { AuthService } from '../auth/auth.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PrivacyService } from './privacy.service.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';

const DAY = 86_400_000;
const [FIRST, LAST] = INACTIVE_WARNING_DAYS;

export interface InactivityDeps {
  auth: AuthService;
  privacy: PrivacyService;
  notifications: NotificationsService;
  /**
   * Members never purged however long they are away: an open placement registration, an offer
   * waiting for verification, or a support report not closed (from the services that own them).
   */
  keep: (userIds: string[]) => Promise<Set<string>>;
}

/** `months` calendar months after `d` (the deadline). */
export const addMonths = (d: Date, months: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + months);
  return x;
};

/**
 * The inactive-account purge (prompt 1b, R7), run daily per college that turned it on
 * (`retention.inactiveAccountMonths`). A member with no activity for that long is warned 60 days
 * before the deadline and again 14 days before, then their erasure is scheduled through
 * PrivacyService with the college's normal grace period. Each step waits for the one before it, so
 * a college that turns the purge on gives even long-inactive members both warnings and 60 days.
 * Any activity (signing in, a session refreshing) starts the clock again. Staff and admins are
 * never selected, nor anyone `keep` names.
 */
export class InactivityService {
  constructor(private readonly d: InactivityDeps) {}

  async run(tenant: TenantRecord, now = new Date()) {
    const months = tenant.retention?.inactiveAccountMonths;
    const out = { warned: 0, scheduled: 0 };
    if (!months) return out;
    // Everyone whose first warning is due: no activity since (deadline − 60 days).
    const cutoff = new Date(addMonths(now, -months).getTime() + FIRST * DAY);
    const candidates = await this.d.auth.inactiveSince(cutoff);
    if (!candidates.length) return out;
    const kept = await this.d.keep(candidates.map((c) => c.userId));
    for (const c of candidates) {
      if (kept.has(c.userId)) continue;
      const deadline = addMonths(c.lastActivity, months);
      const w = c.warning;
      if (!w) {
        await this.warn(
          c.userId,
          FIRST,
          months,
          new Date(Math.max(deadline.getTime(), now.getTime() + FIRST * DAY)),
          now,
        );
        out.warned++;
      } else if (w.stage === FIRST) {
        // The second warning: 14 days before the deadline, and at least 46 days after the first.
        const due = Math.max(deadline.getTime() - LAST * DAY, w.at.getTime() + (FIRST - LAST) * DAY);
        if (now.getTime() >= due) {
          await this.warn(c.userId, LAST, months, new Date(now.getTime() + LAST * DAY), now);
          out.warned++;
        }
      } else if (
        w.stage === LAST &&
        now.getTime() >= Math.max(deadline.getTime(), w.at.getTime() + LAST * DAY)
      ) {
        await this.d.privacy.scheduleDeletion(c.userId, tenant, 'inactive');
        out.scheduled++;
      }
    }
    return out;
  }

  private async warn(userId: string, stage: number, months: number, on: Date, now: Date) {
    await this.d.auth.setInactivityWarning(userId, stage, now);
    await this.d.notifications.notify(userId, 'account_inactive', {
      months: String(months),
      start: on.toISOString(),
    });
  }
}
