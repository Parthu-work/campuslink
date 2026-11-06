import { batchmatesInviteBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import type { Request } from 'express';
import { deviceLabel, requestMeta } from '../../lib/request-meta.js';
import type { OnboardingService } from './onboarding.service.js';

const tag = 'Invites';
const meta = (req: Request) => ({ ...requestMeta(req), device: deviceLabel(req.get('user-agent')) });
const batchmates = { kind: 'permission', permission: 'invites:batchmates' } as const;
const captain = { kind: 'permission', permission: 'captains:class' } as const;

/** Members invite their batch, and Campus Captains their class (prompt 2, G8): counts only, never names or numbers. */
export function memberInviteRoutes(s: OnboardingService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/batchmates',
      tag,
      summary: 'How many of my batch are on the college\x27s list but not here yet',
      access: batchmates,
      handler: async ({ req }) => ({ data: await s.batchmates(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/batchmates/invite',
      tag,
      summary: 'Invite them on WhatsApp (within my weekly limit and the college\x27s allowance)',
      access: batchmates,
      limiter: 'posting',
      body: batchmatesInviteBody,
      handler: async ({ req, body }) => ({
        data: await s.inviteBatch(tenantOf(req), authOf(req), body.count, 'member', meta(req)),
      }),
    },
    {
      method: 'get',
      path: '/captain/class',
      tag,
      summary: 'My class joining CampusLink (Campus Captains; counts only)',
      access: captain,
      handler: async ({ req }) => ({ data: await s.captainClass(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/captain/invites',
      tag,
      summary: 'Invite classmates on WhatsApp (Campus Captains; a daily limit)',
      access: captain,
      limiter: 'posting',
      body: batchmatesInviteBody,
      handler: async ({ req, body }) => ({
        data: await s.inviteBatch(tenantOf(req), authOf(req), body.count, 'captain', meta(req)),
      }),
    },
  ];
}
