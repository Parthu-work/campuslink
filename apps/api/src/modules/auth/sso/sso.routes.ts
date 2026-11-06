import { z } from 'zod';
import {
  ssoCallbackQuery,
  ssoCompleteBody,
  ssoProviderParams,
  ssoSettingsBody,
  ssoStartQuery,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../../http/registry.js';
import { authOf, tenantOf } from '../../../http/request-context.js';
import { setAuthCookies } from '../../../http/cookies.js';
import { deviceLabel, requestMeta } from '../../../lib/request-meta.js';
import type { Request } from 'express';
import type { IssuedSession } from '../auth.service.js';
import type { SsoService } from './sso.service.js';

const tag = 'Auth';
/** Binds a sign-in to the browser that started it; sent back on the provider's redirect (Lax). */
export const SSO_STATE_COOKIE = 'cl_sso';
const STATE_PATH = '/api/v1/auth/sso';
const meta = (req: Request) => ({ ...requestMeta(req), device: deviceLabel(req.get('user-agent')) });
const redirect = (location: string) => ({
  status: 302,
  data: null,
  raw: { body: '', headers: { Location: location, 'Cache-Control': 'no-store' } },
});

/** Single sign-on (prompt 2, G9) and its settings in Admin › Sign-in options. */
export function ssoRoutes(s: SsoService, cookie: { secure: boolean; refreshTtlSec: number }): AnyRouteSpec[] {
  const issue = (res: Parameters<typeof setAuthCookies>[0], session: IssuedSession) => {
    setAuthCookies(res, session.refreshToken, cookie.refreshTtlSec, cookie.secure);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  };
  return [
    {
      method: 'get',
      path: '/auth/sso/providers',
      tag,
      summary: 'The college’s single sign-on options, for the sign-in page',
      access: { kind: 'public' },
      readOnlyOk: true,
      handler: async ({ req }) => ({ data: { providers: await s.providers(tenantOf(req)) } }),
    },
    {
      method: 'get',
      path: '/auth/sso/:provider/start',
      tag,
      summary: 'Go to the college’s identity provider to sign in',
      access: { kind: 'public' },
      readOnlyOk: true,
      limiter: 'login',
      params: ssoProviderParams,
      query: ssoStartQuery,
      handler: async ({ req, res, params, query }) => {
        const r = await s.start(tenantOf(req), params.provider, query.next);
        res.cookie(SSO_STATE_COOKIE, r.state, {
          httpOnly: true,
          secure: cookie.secure,
          sameSite: 'lax',
          path: STATE_PATH,
          maxAge: 10 * 60_000,
        });
        return redirect(r.location);
      },
    },
    {
      method: 'get',
      path: '/auth/sso/:provider/callback',
      tag,
      summary: 'Where the identity provider sends the member back',
      access: { kind: 'public' },
      readOnlyOk: true,
      limiter: 'login',
      params: ssoProviderParams,
      query: ssoCallbackQuery,
      handler: async ({ req, res, params, query }) => {
        const bound = req.cookies?.[SSO_STATE_COOKIE];
        res.clearCookie(SSO_STATE_COOKIE, {
          path: STATE_PATH,
          secure: cookie.secure,
          sameSite: 'lax',
          httpOnly: true,
        });
        const r = await s.callback(
          tenantOf(req),
          params.provider,
          query,
          typeof bound === 'string' ? bound : undefined,
          meta(req),
        );
        if (r.session) issue(res, r.session);
        return redirect(r.redirect);
      },
    },
    {
      method: 'post',
      path: '/auth/sso/pending',
      tag,
      summary: 'Who a first single sign-on was for (to finish the account)',
      access: { kind: 'public' },
      // Not while the college is read-only: no new accounts then (as /auth/signup).
      limiter: 'login',
      body: z.strictObject({ ticket: ssoCompleteBody.shape.ticket }),
      handler: async ({ body }) => ({ data: await s.pending(body.ticket) }),
    },
    {
      method: 'post',
      path: '/auth/sso/complete',
      tag,
      summary: 'Finish the account a first single sign-on started (terms, birth month, role)',
      access: { kind: 'public' },
      limiter: 'signup',
      body: ssoCompleteBody,
      handler: async ({ req, res, body }) => ({
        data: { session: issue(res, await s.complete(body, meta(req))) },
      }),
    },
    {
      method: 'get',
      path: '/admin/sign-in',
      tag: 'Admin',
      summary: 'Single sign-on settings (secrets are never returned)',
      access: { kind: 'permission', permission: 'tenant:settings' },
      handler: async ({ req }) => ({ data: await s.settings(tenantOf(req)) }),
    },
    {
      method: 'put',
      path: '/admin/sign-in/:provider',
      tag: 'Admin',
      summary: 'Turn Google Workspace or Microsoft Entra ID sign-in on or off, with its app details',
      access: { kind: 'permission', permission: 'tenant:settings' },
      limiter: 'adminWrite',
      params: ssoProviderParams,
      body: ssoSettingsBody,
      handler: async ({ req, params, body }) => ({
        data: await s.saveSettings(authOf(req), tenantOf(req), params.provider, body, requestMeta(req)),
      }),
    },
  ];
}
