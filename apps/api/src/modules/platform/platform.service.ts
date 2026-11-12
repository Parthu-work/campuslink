import type { Types } from 'mongoose';
import { APP_NAME, EMPLOYER_SLUG_PREFIX, Role } from '@campuslink/shared';
import type { z } from 'zod';
import type { createTenantBody, updateTenantBody } from '@campuslink/shared';
import { TenantModel } from '../tenants/tenant.model.js';
import { invalidateTenant, type TenantRecord } from '../tenants/tenant.cache.js';
import { UserModel } from '../auth/user.model.js';
import { SessionModel } from '../auth/session.model.js';
import { runInTenant, withPlatformScope } from '../../lib/context.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/passwords.js';
import { randomToken } from '../../lib/crypto.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { AuthService } from '../auth/auth.service.js';

/**
 * Super-admin operations. Reads across tenants happen only inside withPlatformScope with a named
 * reason, and only return aggregates — never message content or personal data of college users.
 */
export class PlatformService {
  constructor(private readonly auth: AuthService) {}

  async listTenants() {
    const tenants = await TenantModel.find({ kind: 'college' })
      .sort({ createdAt: -1 })
      .lean<(TenantRecord & { subscription: unknown; createdAt: Date })[]>();
    const counts = await withPlatformScope('platform:tenant-stats', () =>
      UserModel.aggregate<{ _id: Types.ObjectId; users: number; active30d: number }>([
        { $match: { tenantId: { $in: tenants.map((t) => t._id) } } },
        {
          $group: {
            _id: '$tenantId',
            users: { $sum: 1 },
            active30d: {
              $sum: { $cond: [{ $gt: ['$lastLoginAt', new Date(Date.now() - 30 * 864e5)] }, 1, 0] },
            },
          },
        },
      ]),
    );
    const byId = new Map(counts.map((c) => [String(c._id), c]));
    return tenants.map((t) => ({
      id: String(t._id),
      slug: t.slug,
      status: t.status,
      branding: t.branding,
      subscription: t.subscription,
      createdAt: t.createdAt,
      users: byId.get(String(t._id))?.users ?? 0,
      active30d: byId.get(String(t._id))?.active30d ?? 0,
    }));
  }

  /**
   * Prompt 4, P1: the way into a fresh production database (`platform:bootstrap`). Creates the
   * platform tenant (`admin`) if it is missing and exactly one super admin, with an unusable
   * password and a single-use set-password link that works for 30 minutes. Two-factor enrolment is
   * forced at the first sign-in, as for every super admin (no permission until it is on).
   *
   * It refuses when any super admin exists. `reissue` gives the one existing super admin a new
   * link, only while that account has never signed in (the first link expired unused).
   */
  async bootstrap(
    input: { email: string; name: string; reissue?: boolean },
    meta: RequestMetaLite = { requestId: 'platform-bootstrap', ipPrefix: null },
  ): Promise<{ setupUrl: string; expiresInMinutes: number; createdTenant: boolean; reissued: boolean }> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw badRequest('--email needs a valid email address');
    if (name.length < 2 || name.length > 100) throw badRequest('--name needs 2 to 100 characters');

    let tenant = await TenantModel.findOne({ kind: 'platform' }).lean<TenantRecord>();
    const existing = await withPlatformScope('platform:bootstrap', () =>
      UserModel.find({ roles: Role.SUPER_ADMIN })
        .select('_id tenantId email lastLoginAt mfa.enabled')
        .limit(2)
        .lean<
          { _id: Types.ObjectId; email: string; lastLoginAt: Date | null; mfa?: { enabled?: boolean } }[]
        >(),
    );
    if (existing.length) {
      const only = existing[0];
      const unused =
        existing.length === 1 && !!only && !only.lastLoginAt && !only.mfa?.enabled && only.email === email;
      if (!input.reissue || !unused || !tenant || !only)
        throw conflict(
          'A platform administrator already exists. Sign in at the platform host, or use "Forgot password" there.',
        );
      const record = tenant;
      const setupUrl = await runInTenant(record._id, async () => {
        await audit.record(
          { action: 'platform.bootstrap_link_reissued', targetType: 'user', targetId: String(only._id) },
          meta,
        );
        return this.auth.setupLink(record, only._id);
      });
      return { setupUrl, expiresInMinutes: 30, createdTenant: false, reissued: true };
    }

    let createdTenant = false;
    if (!tenant) {
      if (await TenantModel.exists({ slug: 'admin' }))
        throw conflict('The "admin" host belongs to another tenant; the platform tenant cannot be created');
      const created = await TenantModel.create({
        slug: 'admin',
        kind: 'platform',
        branding: {
          displayName: `${APP_NAME} Platform`,
          shortName: 'Platform',
          primary: '#3fb8e6',
          secondary: '#6d5ae6',
          accent: '#f2b705',
          monogram: 'CL',
        },
      });
      tenant = created.toObject() as unknown as TenantRecord;
      createdTenant = true;
    }
    const record = tenant;
    const setupUrl = await runInTenant(record._id, async () => {
      const user = await UserModel.create({
        email,
        name,
        // Unusable random password until the set-password link is used.
        passwordHash: await hashPassword(randomToken(32)),
        roles: [Role.SUPER_ADMIN],
        verified: true,
        ageCheckedAt: new Date(),
      });
      // Two commands at the same moment: only one administrator may come out of it.
      const count = await withPlatformScope('platform:bootstrap', () =>
        UserModel.countDocuments({ roles: Role.SUPER_ADMIN }),
      );
      if (count > 1) {
        await UserModel.deleteOne({ _id: user._id });
        throw conflict('A platform administrator already exists.');
      }
      await audit.record(
        {
          action: 'platform.bootstrap',
          targetType: 'user',
          targetId: String(user._id),
          meta: { createdTenant },
        },
        meta,
      );
      await this.auth.onUserCreated?.(String(user._id));
      return this.auth.setupLink(record, user._id);
    });
    invalidateTenant(record.slug);
    return { setupUrl, expiresInMinutes: 30, createdTenant, reissued: false };
  }

  /** Runs inside the new college's tenant context (installs the roadmap library). */
  onTenantCreated?: () => Promise<unknown>;

  async createTenant(actorId: string, body: z.output<typeof createTenantBody>, meta: RequestMetaLite) {
    // Employer hosts are emp-<name> (prompt 2, G12, ADR 0014 N2); a college never takes the prefix.
    if (body.slug.startsWith(EMPLOYER_SLUG_PREFIX))
      throw conflict('That subdomain is reserved for employers');
    if (await TenantModel.exists({ slug: body.slug })) throw conflict('That subdomain is taken');
    const tenant = await TenantModel.create({
      slug: body.slug,
      kind: 'college',
      branding: body.branding,
      // The term starts today (a pilot runs its days from here; B10).
      subscription: { ...body.subscription, startedOn: new Date() },
    });
    const record = tenant.toObject() as unknown as TenantRecord;
    const admin = await runInTenant(tenant._id, async () => {
      const user = await UserModel.create({
        email: body.firstAdmin.email,
        name: body.firstAdmin.name,
        // Unusable random password until the invite link is used.
        passwordHash: await hashPassword(randomToken(32)),
        roles: [Role.COLLEGE_ADMIN],
        verified: true,
        ageCheckedAt: new Date(),
      });
      await audit.record(
        {
          action: 'tenant.created_by_platform',
          targetType: 'tenant',
          targetId: String(tenant._id),
          meta: { slug: body.slug },
        },
        meta,
      );
      await this.auth.onUserCreated?.(String(user._id));
      await this.auth.sendInvite(record, user._id, user.email, user.name);
      await this.onTenantCreated?.();
      return user;
    });
    await audit.record(
      {
        action: 'platform.tenant_created',
        actorId,
        targetType: 'tenant',
        targetId: String(tenant._id),
        meta: { slug: body.slug, adminId: String(admin._id) },
      },
      meta,
    );
    return { id: String(tenant._id), slug: tenant.slug };
  }

  async updateTenant(
    actorId: string,
    id: string,
    body: z.output<typeof updateTenantBody>,
    meta: RequestMetaLite,
  ) {
    const t = await TenantModel.findOne({ _id: id, kind: 'college' }).lean<TenantRecord>();
    if (!t) throw notFound('College');
    const set: Record<string, unknown> = {};
    if (body.status) {
      set.status = body.status;
      set.suspendedAt = body.status === 'suspended' ? new Date() : null;
    }
    for (const [k, v] of Object.entries(body.subscription ?? {}))
      set[`subscription.${k}`] = k === 'renewalDate' && v ? new Date(v as string) : v;
    await TenantModel.updateOne({ _id: id }, { $set: set });
    invalidateTenant(t.slug);
    if (body.status === 'suspended') {
      await runInTenant(t._id, () =>
        SessionModel.updateMany(
          { revokedAt: null },
          { $set: { revokedAt: new Date(), revokedReason: 'tenant_suspended' } },
        ),
      );
    }
    const action = body.status
      ? `platform.tenant_${body.status === 'suspended' ? 'suspended' : 'resumed'}`
      : 'platform.subscription_changed';
    await audit.record(
      { action, actorId, targetType: 'tenant', targetId: id, meta: { fields: Object.keys(set) } },
      meta,
    );
    await audit.recordInTenant(t._id, { action, targetType: 'tenant', targetId: id }, meta);
    return { id, ...set };
  }

  async health(checks: Record<string, () => Promise<boolean>>) {
    const results = Object.fromEntries(
      await Promise.all(
        Object.entries(checks).map(async ([k, f]) => [k, await f().catch(() => false)] as const),
      ),
    );
    const [tenants, suspended] = await Promise.all([
      TenantModel.countDocuments({ kind: 'college' }),
      TenantModel.countDocuments({ kind: 'college', status: 'suspended' }),
    ]);
    const [users, activeSessions] = await withPlatformScope('platform:health-stats', () =>
      Promise.all([
        UserModel.countDocuments({}),
        SessionModel.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),
      ]),
    );
    return {
      dependencies: results,
      tenants,
      suspended,
      users,
      activeSessions,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    };
  }
}
