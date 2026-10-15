import type { Types } from 'mongoose';
import { Role } from '@campuslink/shared';
import type { z } from 'zod';
import type { createTenantBody, updateTenantBody } from '@campuslink/shared';
import { TenantModel } from '../tenants/tenant.model.js';
import { invalidateTenant, type TenantRecord } from '../tenants/tenant.cache.js';
import { UserModel } from '../auth/user.model.js';
import { SessionModel } from '../auth/session.model.js';
import { runInTenant, withPlatformScope } from '../../lib/context.js';
import { conflict, notFound } from '../../lib/errors.js';
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

  async createTenant(actorId: string, body: z.output<typeof createTenantBody>, meta: RequestMetaLite) {
    if (await TenantModel.exists({ slug: body.slug })) throw conflict('That subdomain is taken');
    const tenant = await TenantModel.create({
      slug: body.slug,
      kind: 'college',
      branding: body.branding,
      subscription: body.subscription,
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
        ageDeclaredAt: new Date(),
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
      await this.auth.sendInvite(record, user._id, user.email, user.name);
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
