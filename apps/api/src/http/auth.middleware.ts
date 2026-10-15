import type { RequestHandler } from 'express';
import { ErrorCode, requiresMfa, resolvePermissions, Role, type Capability } from '@campuslink/shared';
import { AppError, unauthenticated } from '../lib/errors.js';
import type { TokenService } from '../lib/jwt.js';
import { UserModel } from '../modules/auth/user.model.js';
import { SessionModel } from '../modules/auth/session.model.js';
import { csrfValid } from './cookies.js';
import type { OriginMatcher } from '../middleware/cors.js';

export function authenticate(tokens: TokenService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) return next(unauthenticated());
    const claims = await tokens.verifyAccess(token);
    if (!claims) return next(unauthenticated());
    const tenant = req.tenant;
    if (!tenant || claims.tid !== String(tenant._id)) {
      return next(
        new AppError(401, ErrorCode.TENANT_MISMATCH, 'This sign-in belongs to a different college'),
      );
    }
    // Tenant plugin scopes both lookups to req.tenant automatically.
    const [user, session] = await Promise.all([
      UserModel.findById(claims.sub)
        .select('roles capabilities status verified tokenVersion mfa.enabled')
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
    if (!user || !session || user.status !== 'active' || user.tokenVersion !== claims.ver)
      return next(unauthenticated());

    // Defence in depth: SUPER_ADMIN only on the platform host, never inside a college.
    const roles = (user.roles as Role[]).filter(
      (r) => (tenant.kind === 'platform') === (r === Role.SUPER_ADMIN),
    );
    const mfaEnabled = !!user.mfa?.enabled;
    req.auth = {
      userId: String(user._id),
      sessionId: String(session._id),
      roles,
      capabilities: user.capabilities as Capability[],
      verified: !!user.verified,
      mfaEnabled,
      mfaPending: requiresMfa(roles) && !mfaEnabled,
      permissions: resolvePermissions(
        { roles, capabilities: user.capabilities as Capability[], verified: !!user.verified, mfaEnabled },
        tenant.permissionOverrides,
      ),
    };
    next();
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
