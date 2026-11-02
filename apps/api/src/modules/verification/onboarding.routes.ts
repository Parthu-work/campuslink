import type { Request, Response } from 'express';
import {
  claimConfirmBody,
  claimStartBody,
  createJoinCodeBody,
  inviteTokenParams,
  joinCodeParams,
  joinStartBody,
  onboardingNudgeBody,
  onboardingProgressQuery,
  onboardingRecordsQuery,
  sendInvitesBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { idParams } from '../../http/validation.js';
import { setAuthCookies } from '../../http/cookies.js';
import { requestMeta, deviceLabel } from '../../lib/request-meta.js';
import type { IssuedSession } from '../auth/auth.service.js';
import type { OnboardingService } from './onboarding.service.js';

const meta = (req: Request) => ({ ...requestMeta(req), device: deviceLabel(req.get('user-agent')) });
const lang = (req: Request) => (req.acceptsLanguages('te', 'hi', 'en') || 'en') as string;
const MANAGE = { kind: 'permission', permission: 'onboarding:manage' } as const;
const tag = 'Onboarding';

/** One-tap invite links and class join codes (build B4). */
export function onboardingRoutes(
  svc: OnboardingService,
  cookie: { secure: boolean; refreshTtlSec: number },
): AnyRouteSpec[] {
  const signedIn = (res: Response, r: { session: IssuedSession; kind: 'student' | 'alumni' }) => {
    setAuthCookies(res, r.session.refreshToken, cookie.refreshTtlSec, cookie.secure);
    return {
      kind: r.kind,
      session: { accessToken: r.session.accessToken, expiresIn: r.session.expiresIn },
    };
  };
  return [
    // ── Public: invite links ─────────────────────────────
    {
      method: 'get',
      path: '/invite/:token',
      tag,
      summary: 'What a personal invite link is for (first name, masked roll number, where the code goes)',
      access: { kind: 'public' },
      limiter: 'invite',
      params: inviteTokenParams,
      handler: async ({ req, params }) => ({ data: await svc.inviteInfo(tenantOf(req), params.token) }),
    },
    {
      method: 'post',
      path: '/invite/:token/accept',
      tag,
      summary: "Send a code to the number or email on the college's record",
      access: { kind: 'public' },
      limiter: 'otp',
      bot: true,
      params: inviteTokenParams,
      body: claimStartBody,
      handler: async ({ req, params, body }) => ({
        status: 202,
        data: await svc.inviteStart(tenantOf(req), params.token, body.channel, lang(req), meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/invite/:token/accept/confirm',
      tag,
      summary: 'Confirm the code: creates the verified member from the record and signs them in',
      access: { kind: 'public' },
      limiter: 'login',
      params: inviteTokenParams,
      body: claimConfirmBody,
      handler: async ({ req, res, params, body }) => ({
        status: 201,
        data: signedIn(res, await svc.inviteConfirm(params.token, body, meta(req))),
      }),
    },
    // ── Public: class join codes ─────────────────────────────
    {
      method: 'get',
      path: '/join/:code',
      tag,
      summary: 'Which class a join code is for',
      access: { kind: 'public' },
      limiter: 'invite',
      params: joinCodeParams,
      handler: async ({ req, params }) => ({ data: await svc.joinInfo(tenantOf(req), params.code) }),
    },
    {
      method: 'post',
      path: '/join/:code/start',
      tag,
      summary: "Find my roll number in the code's class and send a code to the contact on record",
      access: { kind: 'public' },
      limiter: 'otp',
      bot: true,
      params: joinCodeParams,
      body: joinStartBody,
      handler: async ({ req, params, body }) => ({
        status: 202,
        data: await svc.joinStart(tenantOf(req), params.code, body, lang(req), meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/join/:code/confirm',
      tag,
      summary: 'Confirm the code: creates the verified member from the record and signs them in',
      access: { kind: 'public' },
      limiter: 'login',
      params: joinCodeParams,
      body: claimConfirmBody,
      handler: async ({ req, res, params, body }) => ({
        status: 201,
        data: signedIn(res, await svc.joinConfirm(params.code, body, meta(req))),
      }),
    },
    // ── Admin › Onboarding ─────────────────────────────
    {
      method: 'get',
      path: '/admin/onboarding',
      tag,
      summary: 'Onboarding progress per branch and batch (on the list, invited, joined, verified, active)',
      access: MANAGE,
      query: onboardingProgressQuery,
      handler: async ({ query }) => ({ data: await svc.progress(query) }),
    },
    {
      method: 'post',
      path: '/admin/onboarding/nudge',
      tag,
      summary: 'Invite everyone not yet joined in one branch and batch on WhatsApp (B4 limits apply)',
      access: MANAGE,
      limiter: 'adminWrite',
      idempotent: true,
      body: onboardingNudgeBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await svc.sendInvites(
          tenantOf(req),
          authOf(req).userId,
          { branch: body.branch, gradYear: body.gradYear, channel: 'whatsapp', attestOptIn: true },
          meta(req),
        ),
      }),
    },
    {
      method: 'get',
      path: '/admin/onboarding/records',
      tag,
      summary: "The college's list with invite status, filtered by branch, year and kind",
      access: MANAGE,
      query: onboardingRecordsQuery,
      handler: async ({ query }) => {
        const r = await svc.records(query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/admin/onboarding/invites',
      tag,
      summary: 'Create personal invite links and send them by WhatsApp, or download them as CSV',
      access: MANAGE,
      limiter: 'adminWrite',
      idempotent: true,
      body: sendInvitesBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await svc.sendInvites(tenantOf(req), authOf(req).userId, body, meta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/join-codes',
      tag,
      summary: 'Recent class join codes',
      access: MANAGE,
      handler: async () => ({ data: await svc.joinCodes() }),
    },
    {
      method: 'post',
      path: '/admin/join-codes',
      tag,
      summary: 'Create a class join code (kind, optional branch and year, days valid)',
      access: MANAGE,
      limiter: 'adminWrite',
      body: createJoinCodeBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await svc.createJoinCode(authOf(req).userId, body, meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/admin/join-codes/:id/expire',
      tag,
      summary: 'Stop a join code working now',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await svc.expireJoinCode(authOf(req).userId, params.id, meta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/join-codes/:id/poster',
      tag,
      summary: 'A printable poster for a join code (QR code of the join link)',
      access: MANAGE,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await svc.poster(tenantOf(req), params.id) }),
    },
  ];
}
