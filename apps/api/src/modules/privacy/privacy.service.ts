import { APP_NAME } from '@campuslink/shared';
import { badRequest, conflict } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { Logger } from '../../lib/logger.js';
import type { AuthService } from '../auth/auth.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import type { AuthState } from '../../types.js';

const DAY = 86_400_000;

/** What each module contributes for one member: their data (export) and how to erase it. */
export interface PrivacyHooks {
  exportFor?: (userId: string) => Promise<unknown>;
  eraseFor?: (userId: string) => Promise<void>;
}

export interface PrivacyDeps {
  auth: AuthService;
  profiles: ProfilesService;
  logger: Logger;
}

/**
 * Data rights (DPDP Act 2023): self-service export of everything we hold about a member, and
 * erasure after a grace period. Modules register hooks; this service never reads their models.
 * Consent records and the audit log are kept as evidence, keyed only by id.
 */
export class PrivacyService {
  private readonly hooks = new Map<string, PrivacyHooks>();
  constructor(private readonly d: PrivacyDeps) {}

  register(name: string, hooks: PrivacyHooks) {
    this.hooks.set(name, hooks);
  }

  get modules() {
    return [...this.hooks.keys()];
  }

  async export(viewer: AuthState, tenant: TenantRecord, meta: RequestMetaLite) {
    const sections: Record<string, unknown> = {};
    for (const [name, h] of this.hooks) if (h.exportFor) sections[name] = await h.exportFor(viewer.userId);
    await audit.record(
      { action: 'privacy.exported', actorId: viewer.userId, targetType: 'user', targetId: viewer.userId },
      meta,
    );
    return {
      exportedAt: new Date().toISOString(),
      service: APP_NAME,
      college: tenant.slug,
      userId: viewer.userId,
      note: 'Everything this college’s space holds about you. Messages include only those you sent.',
      deletion: await this.d.auth.deletionOf(viewer.userId),
      ...sections,
    };
  }

  async status(viewer: AuthState) {
    return { deletion: await this.d.auth.deletionOf(viewer.userId) };
  }

  /** Start erasure: everyone is signed out, the profile is hidden, and it runs after the grace period. */
  async requestDeletion(viewer: AuthState, tenant: TenantRecord, password: string, meta: RequestMetaLite) {
    if (!(await this.d.auth.checkPassword(viewer.userId, password)))
      throw badRequest('Your password is incorrect');
    if (await this.d.auth.deletionOf(viewer.userId))
      throw conflict('Your account is already scheduled for deletion');
    const days = tenant.retention?.deletedAccountGraceDays ?? 30;
    const purgeAt = new Date(Date.now() + days * DAY);
    await this.d.auth.setDeletion(viewer.userId, purgeAt);
    await this.d.auth.revokeAllSessions(viewer.userId, 'deletion_requested');
    await this.d.profiles.sync(viewer.userId);
    await audit.record(
      {
        action: 'privacy.deletion_requested',
        actorId: viewer.userId,
        targetType: 'user',
        targetId: viewer.userId,
        meta: { graceDays: days },
      },
      meta,
    );
    return { deletion: { requestedAt: new Date(), purgeAt } };
  }

  async cancelDeletion(viewer: AuthState, meta: RequestMetaLite) {
    if (!(await this.d.auth.deletionOf(viewer.userId)))
      throw conflict('Your account is not scheduled for deletion');
    await this.d.auth.setDeletion(viewer.userId, null);
    await this.d.profiles.sync(viewer.userId);
    await audit.record(
      {
        action: 'privacy.deletion_cancelled',
        actorId: viewer.userId,
        targetType: 'user',
        targetId: viewer.userId,
      },
      meta,
    );
    return { deletion: null };
  }

  /** Retention job (in a tenant context): erase accounts whose grace period has ended. */
  async purgeDue(now = new Date()) {
    const due = await this.d.auth.dueDeletions(now);
    for (const userId of due) {
      for (const [name, h] of this.hooks)
        if (h.eraseFor)
          try {
            await h.eraseFor(userId);
          } catch (err) {
            // Leave the account for the next run rather than half-erasing it silently.
            this.d.logger.error({ err, module: name }, 'erasure step failed');
            throw err;
          }
      await this.d.auth.deleteUserRecord(userId);
      await audit.record({ action: 'privacy.erased', targetType: 'user', targetId: userId });
    }
    return due.length;
  }
}
