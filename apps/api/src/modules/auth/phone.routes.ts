import type { Request, Response } from 'express';
import {
  guardianConfirmBody,
  guardianManualBody,
  guardianStartBody,
  otpConfirmBody,
  phoneChangeBody,
  phoneStartBody,
  phoneVerifyBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { setAuthCookies } from '../../http/cookies.js';
import { requestMeta, deviceLabel } from '../../lib/request-meta.js';
import type { PhoneAuthService } from './phone.service.js';
import type { IssuedSession } from './auth.service.js';
import type { GuardianService } from '../verification/guardian.service.js';

const meta = (req: Request) => ({ ...requestMeta(req), device: deviceLabel(req.get('user-agent')) });
const tag = 'Auth';

/** Phone sign-up and sign-in, changing the number, and guardian consent (build B2). */
export function phoneRoutes(
  phone: PhoneAuthService,
  guardian: GuardianService,
  cookie: { secure: boolean; refreshTtlSec: number },
): AnyRouteSpec[] {
  const issue = (res: Response, s: IssuedSession) => {
    setAuthCookies(res, s.refreshToken, cookie.refreshTtlSec, cookie.secure);
    return { accessToken: s.accessToken, expiresIn: s.expiresIn };
  };
  return [
    {
      method: 'post',
      path: '/auth/phone/start',
      tag,
      summary: 'Send a sign-up or sign-in code to a mobile number (same answer either way)',
      access: { kind: 'public' },
      limiter: 'otp',
      bot: true,
      body: phoneStartBody,
      handler: async ({ req, body }) => ({
        status: 202,
        data: await phone.start(body, body.locale ?? 'en', meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/auth/phone/verify',
      tag,
      summary: 'Confirm a phone code: sign in, or create the account from the sign-up fields',
      access: { kind: 'public' },
      limiter: 'login',
      body: phoneVerifyBody,
      handler: async ({ req, res, body }) => {
        const r = await phone.verify(body, meta(req));
        return {
          data: r.mfaRequired
            ? { mfaRequired: true, ticket: r.ticket }
            : { mfaRequired: false, created: r.created, session: issue(res, r.session) },
        };
      },
    },
    {
      method: 'post',
      path: '/me/phone/change',
      tag,
      summary: 'Change my number: a code to the old number (or the password), then to the new one',
      access: { kind: 'authenticated' },
      limiter: 'otp',
      body: phoneChangeBody,
      handler: async ({ req, body }) => ({
        status: 202,
        data: await phone.startChange(authOf(req).userId, body, meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/me/phone/change/confirm',
      tag,
      summary: 'Confirm a phone-change code (old number first, then the new one)',
      access: { kind: 'authenticated' },
      limiter: 'login',
      body: otpConfirmBody,
      handler: async ({ req, body }) => {
        const a = authOf(req);
        return { data: await phone.confirmChange(a.userId, a.sessionId, body, meta(req)) };
      },
    },
    {
      method: 'get',
      path: '/me/guardian',
      tag,
      summary: 'What the guardian-consent step needs (members under 18)',
      access: { kind: 'authenticated' },
      handler: async ({ req }) => ({ data: await guardian.status(authOf(req).userId) }),
    },
    {
      method: 'post',
      path: '/me/guardian/start',
      tag,
      summary: "Send a code to the guardian's number on the college's record",
      access: { kind: 'authenticated' },
      limiter: 'otp',
      body: guardianStartBody,
      handler: async ({ req, body }) => ({
        status: 202,
        data: await guardian.start(authOf(req).userId, body.channel, meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/me/guardian/confirm',
      tag,
      summary: 'Record the guardian’s consent with the code they received',
      access: { kind: 'authenticated' },
      limiter: 'login',
      body: guardianConfirmBody,
      handler: async ({ req, body }) => ({
        data: await guardian.confirm(authOf(req).userId, body, meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/me/guardian/manual',
      tag,
      summary: 'Ask the college to check a guardian number (no number on its record)',
      access: { kind: 'authenticated' },
      limiter: 'verify',
      body: guardianManualBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await guardian.requestManual(authOf(req).userId, body.phone, meta(req)),
      }),
    },
  ];
}
