import { z } from 'zod';
import {
  buddyCheckBody,
  buddyVolunteerBody,
  objectId,
  peerMentorBody,
  peerNominationBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import type { PeersService } from './peers.service.js';

const tag = 'Peer mentors and buddies';
const enroll = { kind: 'permission', permission: 'peers:enroll' } as const;
const manage = { kind: 'permission', permission: 'peers:manage' } as const;
const pairParams = z.strictObject({ id: objectId });

/** Peer mentors and the Senior Buddy (prompt 2, G7; under the `peerMentors` switch). */
export function peersRoutes(s: PeersService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/peer',
      tag,
      summary: 'Whether I can be a peer mentor or a senior buddy, and whether I am',
      access: enroll,
      handler: async ({ req }) => ({ data: await s.status(authOf(req)) }),
    },
    {
      method: 'put',
      path: '/me/peer/mentor',
      tag,
      summary: 'Become (or stop being) a peer mentor for juniors',
      access: enroll,
      body: peerMentorBody,
      handler: async ({ req, body }) => ({ data: await s.setPeer(authOf(req), body.on) }),
    },
    {
      method: 'put',
      path: '/me/peer/buddy',
      tag,
      summary: 'Volunteer (or stop) as a senior buddy for first-years',
      access: enroll,
      body: buddyVolunteerBody,
      handler: async ({ req, body }) => ({ data: await s.volunteer(authOf(req), body.on) }),
    },
    {
      method: 'get',
      path: '/me/buddy',
      tag,
      summary: 'My senior buddy (first-years) or the first-years I guide (seniors)',
      access: enroll,
      handler: async ({ req }) => ({ data: await s.buddy(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/buddies/:id/checklist',
      tag,
      summary: 'Tick (or untick) an item of the four-week buddy checklist',
      access: enroll,
      params: pairParams,
      body: buddyCheckBody,
      handler: async ({ req, params, body }) => ({
        data: await s.check(authOf(req), params.id, body.item, body.done),
      }),
    },
    {
      method: 'get',
      path: '/admin/peers',
      tag,
      summary: 'Peer mentor nominations and how buddy matching is going',
      access: manage,
      handler: async () => ({ data: { nominations: await s.nominations(), buddies: await s.board() } }),
    },
    {
      method: 'post',
      path: '/admin/peers/nominations',
      tag,
      summary: 'Nominate a student as a peer mentor (or withdraw the nomination)',
      access: manage,
      body: peerNominationBody,
      handler: async ({ req, body }) => ({ data: await s.nominate(authOf(req), body.userId, body.on) }),
    },
    {
      method: 'post',
      path: '/admin/peers/match-buddies',
      tag,
      summary: 'Match first-years without a buddy now (it also runs every day)',
      access: manage,
      handler: async () => ({ data: await s.matchFirstYears() }),
    },
  ];
}
