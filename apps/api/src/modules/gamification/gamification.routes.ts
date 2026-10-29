import {
  gamificationPrefsBody,
  leaderboardQuery,
  redeemBody,
  redemptionDecisionBody,
  redemptionsQuery,
  revokeXpBody,
  rewardBody,
  rewardUpdateBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { GamificationService } from './gamification.service.js';

const SIGNED_IN = { kind: 'authenticated' } as const;
const PEOPLE = { kind: 'permission', permission: 'directory:read' } as const;
const REDEEM = { kind: 'permission', permission: 'rewards:redeem' } as const;
const MANAGE = { kind: 'permission', permission: 'rewards:manage' } as const;
const tag = 'Gamification';

export function gamificationRoutes(s: GamificationService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/progress',
      tag,
      summary: 'My XP, level, streak, badges, impact and point balance',
      access: SIGNED_IN,
      handler: async ({ req }) => ({ data: await s.me(authOf(req)) }),
    },
    {
      method: 'put',
      path: '/me/progress/settings',
      tag,
      summary: 'Opt in or out of leaderboards and the Wall of Mentors',
      access: SIGNED_IN,
      body: gamificationPrefsBody,
      handler: async ({ req, body }) => ({ data: await s.setPrefs(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/leaderboard',
      feature: 'leaderboards',
      tag,
      summary: 'This month’s XP among members who opted in',
      access: PEOPLE,
      query: leaderboardQuery,
      handler: async ({ req, query }) => ({ data: await s.leaderboard(authOf(req), query.scope) }),
    },
    {
      method: 'get',
      path: '/wall-of-mentors',
      tag,
      summary: 'Opted-in mentors by level, and last month’s Mentor of the Month',
      access: PEOPLE,
      handler: async () => ({ data: await s.wall() }),
    },
    {
      method: 'get',
      path: '/rewards',
      tag,
      summary: 'Rewards I can redeem points for',
      access: REDEEM,
      handler: async () => ({ data: await s.rewards(false) }),
    },
    {
      method: 'post',
      path: '/rewards/redeem',
      tag,
      summary: 'Redeem points for a reward (pending until the college hands it over)',
      access: REDEEM,
      limiter: 'interact',
      idempotent: true,
      body: redeemBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.redeem(authOf(req), body.rewardId) }),
    },
    {
      method: 'get',
      path: '/me/redemptions',
      tag,
      summary: 'My reward requests',
      access: REDEEM,
      handler: async ({ req }) => ({ data: await s.myRedemptions(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/redemptions/:id/cancel',
      tag,
      summary: 'Cancel a pending reward request (points are returned)',
      access: REDEEM,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.cancelRedemption(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/admin/rewards',
      tag,
      summary: 'The rewards catalogue, including inactive rewards',
      access: MANAGE,
      handler: async () => ({ data: await s.rewards(true) }),
    },
    {
      method: 'post',
      path: '/admin/rewards',
      tag,
      summary: 'Add a reward',
      access: MANAGE,
      body: rewardBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.createReward(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'patch',
      path: '/admin/rewards/:id',
      tag,
      summary: 'Change or retire a reward',
      access: MANAGE,
      params: idParams,
      body: rewardUpdateBody,
      handler: async ({ req, params, body }) => ({
        data: await s.updateReward(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/redemptions',
      tag,
      summary: 'Reward requests to hand over',
      access: MANAGE,
      query: redemptionsQuery,
      handler: async ({ query }) => ({ data: await s.redemptions(query.status) }),
    },
    {
      method: 'post',
      path: '/admin/redemptions/:id/decide',
      tag,
      summary: 'Mark a reward handed over, or decline it (points are returned)',
      access: MANAGE,
      params: idParams,
      body: redemptionDecisionBody,
      handler: async ({ req, params, body }) => ({
        data: await s.decide(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/users/:id/xp',
      tag,
      summary: 'A member’s points ledger (audit tool)',
      access: MANAGE,
      params: idParams,
      handler: async ({ params }) => ({ data: await s.ledger(params.id) }),
    },
    {
      method: 'post',
      path: '/admin/xp/:id/revoke',
      tag,
      summary: 'Revoke an award with a reason (append-only, audited)',
      access: MANAGE,
      params: idParams,
      body: revokeXpBody,
      handler: async ({ req, params, body }) => ({
        data: await s.revoke(authOf(req), params.id, body.reason, requestMeta(req)),
      }),
    },
  ];
}
