import type { RequestHandler } from 'express';
import {
  ErrorCode,
  effectiveOverrides,
  isMinor,
  requiresMfa,
  resolvePermissions,
  Role,
  type Capability,
} from '@campuslink/shared';
import { AppError, unauthenticated } from '../lib/errors.js';
import type { TokenService } from '../lib/jwt.js';
import { UserModel } from '../modules/auth/user.model.js';
import { SessionModel } from '../modules/auth/session.model.js';
import { csrfValid } from './cookies.js';
import type { TenantRecord } from '../modules/tenants/tenant.cache.js';
import type { AuthState } from '../types.js';
import type { OriginMatcher } from '../middleware/cors.js';

/**
 * Verifies an access token for a tenant and loads the caller's live state (roles, status, session).
 * Shared by HTTP and the realtime gateway. Throws AppError when the token is not acceptable.
 */
export async function authFromToken(
  tokens: TokenService,
  tenant: TenantRecord | undefined,
  token: string | null | undefined,
): Promise<AuthState & { expiresAt: number }> {
  if (!token) throw unauthenticated();
  const claims = await tokens.verifyAccess(token);
  if (!claims) throw unauthenticated();
  if (!tenant || claims.tid !== String(tenant._id))
    throw new AppError(401, ErrorCode.TENANT_MISMATCH, 'This sign-in belongs to a different college');
  // Tenant plugin scopes both lookups to the current tenant context automatically.
  const [user, session] = await Promise.all([
    UserModel.findById(claims.sub)
      .select('roles capabilities status verified tokenVersion mfa.enabled adultOn')
      .lean(),
    SessionModel.findOne({
      _id: claims.sid,
      userId: claims.sub,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .select('_id')
      .lean(),
  ]);
  if (!user || !session || user.status === 'suspended' || user.tokenVersion !== claims.ver)
    throw unauthenticated();
  // A pending deletion keeps only signed-in basics (see /me, export, cancel): no permissions at all.
  const deleting = user.status === 'deleting';
  // So does a member under 18 until a guardian consents: verification and the guardian step only.
  const guardianPending = user.status === 'guardian_pending';

  // Defence in depth: SUPER_ADMIN only on the platform host, never inside a college.
  const roles = (user.roles as Role[]).filter(
    (r) => (tenant.kind === 'platform') === (r === Role.SUPER_ADMIN),
  );
  const mfaEnabled = !!user.mfa?.enabled;
  return {
    userId: String(user._id),
    sessionId: String(session._id),
    roles,
    capabilities: user.capabilities as Capability[],
    verified: !!user.verified,
    mfaEnabled,
    mfaPending: requiresMfa(roles) && !mfaEnabled,
    guardianPending,
    minor: isMinor(user.adultOn),
    permissions:
      deleting || guardianPending
        ? new Set()
        : resolvePermissions(
            { roles, capabilities: user.capabilities as Capability[], verified: !!user.verified, mfaEnabled },
            effectiveOverrides(tenant.features, tenant.permissionOverrides),
          ),
    expiresAt: claims.exp * 1000,
  };
}

export function authenticate(tokens: TokenService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    try {
      const { expiresAt: _exp, ...auth } = await authFromToken(tokens, req.tenant, token);
      req.auth = auth;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function csrfProtection(isAllowedOrigin: OriginMatcher): RequestHandler {
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !isAllowedOrigin(origin))
      return next(new AppError(403, ErrorCode.CSRF_FAILED, 'Request origin not allowed'));
    if (!csrfValid(req))
      return next(
        new AppError(
          403,
          ErrorCode.CSRF_FAILED,
          'Your session check failed. Refresh the page and try again.',
        ),
      );
    next();
  };
}
