import {
  referralPrefsBody,
  referralRequestBody,
  referralRespondBody,
  referralsQuery,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { badRequest } from '../../lib/errors.js';
import type { ReferralsService } from './referrals.service.js';
import type { FilesService } from '../files/files.service.js';

const REQUEST = { kind: 'permission', permission: 'referrals:request' } as const;
const OFFER = { kind: 'permission', permission: 'referrals:offer' } as const;
const tag = 'Referrals';

export function referralRoutes(s: { referrals: ReferralsService; files: FilesService }): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/referral-settings',
      tag,
      summary: 'My referral settings (off until I opt in) and this week’s count',
      access: OFFER,
      handler: async ({ req }) => ({ data: await s.referrals.prefs(authOf(req)) }),
    },
    {
      method: 'put',
      path: '/me/referral-settings',
      tag,
      summary: 'Opt in or out of referral requests and set a weekly cap',
      access: OFFER,
      body: referralPrefsBody,
      handler: async ({ req, body }) => ({ data: await s.referrals.updatePrefs(authOf(req), body) }),
    },
    {
      method: 'post',
      path: '/referrals/resume',
      tag,
      summary: 'Upload a résumé PDF for a referral request (rebuilt, metadata removed)',
      access: REQUEST,
      limiter: 'upload',
      upload: { field: 'file', maxBytes: 5 * 1024 * 1024 },
      handler: async ({ req, file }) => {
        if (!file) throw badRequest('Choose a PDF');
        return { status: 201, data: await s.files.storeResume(authOf(req).userId, file.buffer) };
      },
    },
    {
      method: 'post',
      path: '/referrals',
      tag,
      summary: 'Ask an alumnus at the company for a referral',
      access: REQUEST,
      limiter: 'referrals',
      bot: true,
      idempotent: true,
      body: referralRequestBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.referrals.create(authOf(req), tenantOf(req), body),
      }),
    },
    {
      method: 'get',
      path: '/referrals',
      tag,
      summary: 'Referral requests I received or sent',
      access: { kind: 'permission', permission: 'jobs:read' },
      query: referralsQuery,
      handler: async ({ req, query }) => {
        const r = await s.referrals.list(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'get',
      path: '/referrals/:id',
      tag,
      summary: 'One referral request (its two people only)',
      access: { kind: 'permission', permission: 'jobs:read' },
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.referrals.get(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/referrals/:id/respond',
      tag,
      summary: 'Refer, or decline with a kind template',
      access: OFFER,
      limiter: 'interact',
      params: idParams,
      body: referralRespondBody,
      handler: async ({ req, params, body }) => ({
        data: await s.referrals.respond(authOf(req), params.id, body),
      }),
    },
    {
      method: 'post',
      path: '/referrals/:id/withdraw',
      tag,
      summary: 'Withdraw my pending request',
      access: REQUEST,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.referrals.withdraw(authOf(req), params.id) }),
    },
  ];
}
