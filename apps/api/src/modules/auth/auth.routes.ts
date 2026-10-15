import { z } from 'zod';
import {
  signupBody,
  loginBody,
  mfaLoginBody,
  tokenBody,
  emailBody,
  resetPasswordBody,
  changePasswordBody,
  mfaEnableBody,
  mfaDisableBody,
  objectId,
  APP_NAME,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import type { Response } from 'express';
import { setAuthCookies, clearAuthCookies, REFRESH_COOKIE } from '../../http/cookies.js';
import { requestMeta, deviceLabel } from '../../lib/request-meta.js';
import { unauthenticated, notFound } from '../../lib/errors.js';
import type { Request } from 'express';
import type { AuthService, IssuedSession } from './auth.service.js';

const meta = (req: Request) => ({ ...requestMeta(req), device: deviceLabel(req.get('user-agent')) });
const ACCEPTED = {
  status: 202,
  data: { message: 'If the details are right, you will get an email shortly.' },
};

export function authRoutes(
  svc: AuthService,
  cookie: { secure: boolean; refreshTtlSec: number },
): AnyRouteSpec[] {
  const issue = (res: Response, s: IssuedSession) => {
    setAuthCookies(res, s.refreshToken, cookie.refreshTtlSec, cookie.secure);
    return { accessToken: s.accessToken, expiresIn: s.expiresIn };
  };
  return [
    {
      method: 'post',
      path: '/auth/signup',
      tag: 'Auth',
      summary: 'Create an account (college verification follows)',
      access: { kind: 'public' },
      limiter: 'signup',
      bot: true,
      body: signupBody,
      handler: async ({ req, body }) => {
        await svc.signup(tenantOf(req), body, meta(req));
        return ACCEPTED;
      },
    },
    {
      method: 'post',
      path: '/auth/verify-email',
      tag: 'Auth',
      summary: 'Confirm an email address with the emailed token',
      access: { kind: 'public' },
      limiter: 'emailAction',
      body: tokenBody,
      handler: async ({ req, body }) => {
        await svc.verifyEmail(body.token, meta(req));
        return { data: { verified: true } };
      },
    },
    {
      method: 'post',
      path: '/auth/verify-email/resend',
      tag: 'Auth',
      summary: 'Send a new email confirmation link',
      access: { kind: 'public' },
      limiter: 'emailAction',
      body: emailBody,
      handler: async ({ req, body }) => {
        await svc.resendVerification(tenantOf(req), body.email);
        return ACCEPTED;
      },
    },
    {
      method: 'post',
      path: '/auth/login',
      tag: 'Auth',
      summary: 'Sign in with email and password',
      access: { kind: 'public' },
      limiter: 'login',
      body: loginBody,
      scope: 'any',
      handler: async ({ req, res, body }) => {
        const r = await svc.login(body.email, body.password, meta(req));
        return {
          data: r.mfaRequired
            ? { mfaRequired: true, ticket: r.ticket }
            : { mfaRequired: false, session: issue(res, r.session) },
        };
      },
    },
    {
      method: 'post',
      path: '/auth/login/mfa',
      tag: 'Auth',
      summary: 'Complete sign-in with a TOTP or recovery code',
      access: { kind: 'public' },
      limiter: 'mfa',
      body: mfaLoginBody,
      scope: 'any',
      handler: async ({ req, res, body }) => {
        const s = await svc.loginWithMfa(
          tenantOf(req),
          body.ticket,
          'code' in body ? { code: body.code } : { recoveryCode: body.recoveryCode },
          meta(req),
        );
        return { data: { session: issue(res, s) } };
      },
    },
    {
      method: 'post',
      path: '/auth/refresh',
      tag: 'Auth',
      summary: 'Rotate the refresh cookie and get a new access token',
      access: { kind: 'public' },
      limiter: 'refresh',
      csrf: true,
      scope: 'any',
      handler: async ({ req, res }) => {
        const token = req.cookies?.[REFRESH_COOKIE];
        if (typeof token !== 'string') throw unauthenticated();
        try {
          return { data: { session: issue(res, await svc.refresh(token, meta(req))) } };
        } catch (e) {
          clearAuthCookies(res, cookie.secure);
          throw e;
        }
      },
    },
    {
      method: 'post',
      path: '/auth/logout',
      tag: 'Auth',
      summary: 'Sign out on this device',
      access: { kind: 'public' },
      csrf: true,
      scope: 'any',
      handler: async ({ req, res }) => {
        const t = req.cookies?.[REFRESH_COOKIE];
        await svc.logout(typeof t === 'string' ? t : undefined, meta(req));
        clearAuthCookies(res, cookie.secure);
        return { status: 204, data: null };
      },
    },
    {
      method: 'post',
      path: '/auth/password/forgot',
      tag: 'Auth',
      summary: 'Email a password reset link',
      access: { kind: 'public' },
      limiter: 'emailAction',
      body: emailBody,
      scope: 'any',
      handler: async ({ req, body }) => {
        await svc.forgotPassword(tenantOf(req), body.email, meta(req));
        return ACCEPTED;
      },
    },
    {
      method: 'post',
      path: '/auth/password/reset',
      tag: 'Auth',
      summary: 'Set a new password with a reset token',
      access: { kind: 'public' },
      limiter: 'emailAction',
      body: resetPasswordBody,
      scope: 'any',
      handler: async ({ req, body }) => {
        await svc.resetPassword(tenantOf(req), body.token, body.password, meta(req));
        return { data: { reset: true } };
      },
    },
    {
      method: 'post',
      path: '/auth/password/change',
      tag: 'Auth',
      summary: 'Change password (signs out other devices)',
      access: { kind: 'authenticated' },
      limiter: 'login',
      body: changePasswordBody,
      scope: 'any',
      handler: async ({ req, body }) => ({
        data: await svc.changePassword(
          tenantOf(req),
          authOf(req).userId,
          authOf(req).sessionId,
          body.currentPassword,
          body.newPassword,
          meta(req),
        ),
      }),
    },
    {
      method: 'get',
      path: '/auth/sessions',
      tag: 'Auth',
      summary: 'List my signed-in devices',
      access: { kind: 'authenticated' },
      scope: 'any',
      handler: async ({ req }) => ({
        data: await svc.listSessions(authOf(req).userId, authOf(req).sessionId),
      }),
    },
    {
      method: 'delete',
      path: '/auth/sessions/:id',
      tag: 'Auth',
      summary: 'Sign out one of my devices',
      access: { kind: 'authenticated' },
      params: z.strictObject({ id: objectId }),
      scope: 'any',
      handler: async ({ req, params }) => {
        if (!(await svc.revokeSession(authOf(req).userId, params.id, meta(req)))) throw notFound('Session');
        return { status: 204, data: null };
      },
    },
    {
      method: 'post',
      path: '/auth/sessions/revoke-others',
      tag: 'Auth',
      summary: 'Sign out all my other devices',
      access: { kind: 'authenticated' },
      scope: 'any',
      handler: async ({ req }) => ({
        data: {
          revoked: await svc.revokeAllSessions(
            authOf(req).userId,
            'user_revoked_others',
            authOf(req).sessionId,
          ),
        },
      }),
    },
    {
      method: 'post',
      path: '/auth/mfa/setup',
      tag: 'Auth',
      summary: 'Start TOTP enrolment (returns QR code)',
      access: { kind: 'authenticated' },
      limiter: 'mfa',
      scope: 'any',
      handler: async ({ req }) => ({
        data: await svc.mfaSetup(authOf(req).userId, tenantOf(req).branding.shortName, APP_NAME),
      }),
    },
    {
      method: 'post',
      path: '/auth/mfa/enable',
      tag: 'Auth',
      summary: 'Confirm TOTP enrolment; returns one-time recovery codes',
      access: { kind: 'authenticated' },
      limiter: 'mfa',
      body: mfaEnableBody,
      scope: 'any',
      handler: async ({ req, body }) => ({
        data: await svc.mfaEnable(authOf(req).userId, authOf(req).sessionId, body.code, meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/auth/mfa/disable',
      tag: 'Auth',
      summary: 'Turn off TOTP (not allowed for admins)',
      access: { kind: 'authenticated' },
      limiter: 'mfa',
      body: mfaDisableBody,
      scope: 'any',
      handler: async ({ req, body }) => {
        await svc.mfaDisable(authOf(req).userId, authOf(req).roles, body.password, body.code, meta(req));
        return { status: 204, data: null };
      },
    },
  ];
}
