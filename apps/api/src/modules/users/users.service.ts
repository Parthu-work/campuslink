import { Types } from 'mongoose';
import {
  ASSIGNABLE_ROLES,
  Role,
  requiresMfa,
  resolvePermissions,
  type Capability,
  type MeResponse,
} from '@campuslink/shared';
import { UserModel } from '../auth/user.model.js';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import { ErrorCode } from '@campuslink/shared';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { AuthState } from '../../types.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import type { AuthService } from '../auth/auth.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ADMIN_FIELDS =
  'name email roles capabilities status verified emailVerifiedAt mfa.enabled lastLoginAt createdAt';

type AdminUserRow = {
  _id: Types.ObjectId;
  name: string;
  email: string;
  roles: string[];
  capabilities: string[];
  status: string;
  verified: boolean;
  emailVerifiedAt: Date | null;
  mfa?: { enabled?: boolean };
  lastLoginAt: Date | null;
  createdAt: Date;
};
const toAdminUser = (u: AdminUserRow) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  roles: u.roles,
  capabilities: u.capabilities,
  status: u.status,
  verified: u.verified,
  emailVerified: !!u.emailVerifiedAt,
  mfaEnabled: !!u.mfa?.enabled,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

/** Vertical-escalation guard: only a college admin may act on another college admin. */
function assertCanActOn(actor: AuthState, targetRoles: string[]) {
  if (targetRoles.includes(Role.COLLEGE_ADMIN) && !actor.roles.includes(Role.COLLEGE_ADMIN))
    throw forbidden();
}

export class UsersService {
  constructor(
    private readonly auth: AuthService,
    private readonly profiles: ProfilesService,
  ) {}

  async me(auth: AuthState): Promise<MeResponse> {
    const u = await UserModel.findById(auth.userId).select('name email locale').lean();
    if (!u) throw notFound('User');
    return {
      id: auth.userId,
      name: u.name,
      email: u.email,
      roles: auth.roles,
      capabilities: auth.capabilities,
      verified: auth.verified,
      mfaEnabled: auth.mfaEnabled,
      mfaRequired: requiresMfa(auth.roles),
      locale: u.locale as 'en' | 'te',
      permissions: [...auth.permissions].sort(),
    };
  }

  async updateMe(auth: AuthState, patch: { name?: string | undefined; locale?: 'en' | 'te' | undefined }) {
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length) await UserModel.updateOne({ _id: auth.userId }, { $set: set });
    if (set.name) await this.profiles.sync(auth.userId);
    return this.me(auth);
  }

  async list(q: {
    cursor?: string | undefined;
    limit: number;
    q?: string | undefined;
    role?: string | undefined;
  }) {
    const filter: Record<string, unknown> = {};
    if (q.cursor) filter._id = { $lt: new Types.ObjectId(q.cursor) };
    if (q.role) filter.roles = q.role;
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ name: rx }, { email: rx }];
    }
    const rows = await UserModel.find(filter)
      .sort({ _id: -1 })
      .limit(q.limit + 1)
      .select(ADMIN_FIELDS)
      .lean<AdminUserRow[]>();
    const page = rows.slice(0, q.limit);
    return {
      items: page.map(toAdminUser),
      nextCursor: rows.length > q.limit ? String(page.at(-1)?._id) : null,
    };
  }

  private async target(id: string) {
    const u = await UserModel.findById(id).select(ADMIN_FIELDS).lean<AdminUserRow>();
    if (!u) throw notFound('User'); // also the answer for ids in other tenants
    return u;
  }

  async updateRoles(actor: AuthState, id: string, roles: Role[], meta: RequestMetaLite) {
    const target = await this.target(id);
    assertCanActOn(actor, target.roles);
    const assignable = new Set(actor.roles.flatMap((r) => ASSIGNABLE_ROLES[r] ?? []));
    const changed = [...new Set([...roles, ...target.roles])].filter(
      (r) => roles.includes(r as Role) !== target.roles.includes(r),
    );
    if (changed.some((r) => !assignable.has(r as Role))) throw forbidden();
    if (target.roles.includes(Role.COLLEGE_ADMIN) && !roles.includes(Role.COLLEGE_ADMIN)) {
      const admins = await UserModel.countDocuments({ roles: Role.COLLEGE_ADMIN, status: 'active' });
      if (admins <= 1)
        throw new AppError(409, ErrorCode.CONFLICT, 'A college needs at least one active administrator');
    }
    const unique = [...new Set(roles)];
    const update: Record<string, unknown> = { roles: unique };
    if (!unique.includes(Role.STUDENT)) update.capabilities = [];
    await UserModel.updateOne({ _id: id }, { $set: update });
    await this.profiles.sync(id);
    await audit.record(
      {
        action: 'user.roles_changed',
        actorId: actor.userId,
        targetType: 'user',
        targetId: id,
        meta: { from: target.roles, to: unique },
      },
      meta,
    );
    // A newly promoted admin without 2FA keeps their session but has no permissions until they enrol.
    return toAdminUser({ ...target, ...update } as AdminUserRow);
  }

  async updateCapabilities(actor: AuthState, id: string, capabilities: Capability[], meta: RequestMetaLite) {
    const target = await this.target(id);
    assertCanActOn(actor, target.roles);
    if (capabilities.length && !target.roles.includes(Role.STUDENT))
      throw badRequest('Contributor rights are granted to students only');
    const unique = [...new Set(capabilities)];
    await UserModel.updateOne({ _id: id }, { $set: { capabilities: unique } });
    await audit.record(
      {
        action: 'user.capabilities_changed',
        actorId: actor.userId,
        targetType: 'user',
        targetId: id,
        meta: { from: target.capabilities, to: unique },
      },
      meta,
    );
    return toAdminUser({ ...target, capabilities: unique });
  }

  async updateStatus(actor: AuthState, id: string, status: 'active' | 'suspended', meta: RequestMetaLite) {
    if (id === actor.userId) throw badRequest('You can’t change your own account status');
    const target = await this.target(id);
    assertCanActOn(actor, target.roles);
    await UserModel.updateOne(
      { _id: id },
      { $set: { status }, ...(status === 'suspended' ? { $inc: { tokenVersion: 1 } } : {}) },
    );
    if (status === 'suspended') await this.auth.revokeAllSessions(id, 'suspended');
    await this.profiles.sync(id);
    await audit.record(
      {
        action: status === 'suspended' ? 'user.suspended' : 'user.reactivated',
        actorId: actor.userId,
        targetType: 'user',
        targetId: id,
      },
      meta,
    );
    return toAdminUser({ ...target, status });
  }

  /** Mirrors the backend rules for the UI. */
  static effective(
    tenant: TenantRecord,
    u: { roles: Role[]; capabilities: Capability[]; verified: boolean; mfaEnabled: boolean },
  ) {
    return resolvePermissions(u, tenant.permissionOverrides);
  }
}
