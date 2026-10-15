import { z } from 'zod';
import {
  availabilityBody,
  menteePrefsBody,
  mentorSettingsBody,
  mentorsQuery,
  mentorshipRequestBody,
  objectId,
  requestsQuery,
  respondBody,
  slotsQuery,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import type { MentorsService } from './mentors.service.js';
import type { RequestsService } from './requests.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';

const MENTOR = { kind: 'permission', permission: 'mentorship:mentor' } as const;
const REQUEST = { kind: 'permission', permission: 'mentorship:request' } as const;
const OVERSEE = { kind: 'permission', permission: 'mentorship:oversee' } as const;
const tag = 'Mentorship';
const userParams = z.strictObject({ userId: objectId });
const cursorQuery = z.strictObject({ cursor: objectId.optional() });

export function mentorshipRoutes(
  mentors: MentorsService,
  requests: RequestsService,
  sessions: SessionsService,
): AnyRouteSpec[] {
  return [
    // ── Mentor setup ─────────────────────────────
    {
      method: 'get',
      path: '/me/mentor',
      tag,
      summary: 'My mentor settings and availability',
      access: MENTOR,
      handler: async ({ req }) => ({ data: await mentors.settings(authOf(req)) }),
    },
    {
      method: 'put',
      path: '/me/mentor',
      tag,
      summary: 'Update mentor settings (accepting switch, weekly cap, session types, audience)',
      access: MENTOR,
      body: mentorSettingsBody,
      handler: async ({ req, body }) => ({ data: await mentors.updateSettings(authOf(req), body) }),
    },
    {
      method: 'put',
      path: '/me/mentor/availability',
      tag,
      summary: 'Set weekly availability and date exceptions (in my timezone)',
      access: MENTOR,
      body: availabilityBody,
      handler: async ({ req, body }) => ({ data: await mentors.updateAvailability(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/me/mentor/impact',
      tag,
      summary: 'My impact card (people helped this month, sessions, rating)',
      access: MENTOR,
      handler: async ({ req }) => {
        const auth = authOf(req);
        const [impact, pendingRequests] = await Promise.all([
          sessions.impact(auth.userId, await mentors.timezoneOf(auth.userId)),
          requests.pendingFor(auth.userId),
        ]);
        return { data: { ...impact, pendingRequests } };
      },
    },
    {
      method: 'get',
      path: '/me/mentor/feedback',
      tag,
      summary: 'Private feedback on my sessions',
      access: MENTOR,
      query: cursorQuery,
      handler: async ({ req, query }) => {
        const r = await sessions.feedbackFor({ mentorId: authOf(req).userId }, query.cursor);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'get',
      path: '/me/match-preferences',
      tag,
      summary: 'My private Alumni Match inputs (goals, target companies)',
      access: REQUEST,
      handler: async ({ req }) => ({ data: await mentors.prefs(authOf(req)) }),
    },
    {
      method: 'put',
      path: '/me/match-preferences',
      tag,
      summary: 'Update my Alumni Match inputs',
      access: REQUEST,
      body: menteePrefsBody,
      handler: async ({ req, body }) => ({ data: await mentors.updatePrefs(authOf(req), body) }),
    },
    // ── Discovery ─────────────────────────────
    {
      method: 'get',
      path: '/mentors',
      tag,
      summary: 'Browse mentors who are taking requests',
      access: REQUEST,
      limiter: 'search',
      query: mentorsQuery,
      handler: async ({ req, query }) => {
        const r = await mentors.list(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'get',
      path: '/mentors/match',
      tag,
      summary: 'Alumni Match: mentors ranked for me, with the reasons',
      access: REQUEST,
      limiter: 'search',
      handler: async ({ req }) => ({ data: await mentors.match(authOf(req)) }),
    },
    {
      method: 'get',
      path: '/mentors/:userId',
      tag,
      summary: 'A mentor’s card and session types',
      access: REQUEST,
      params: userParams,
      handler: async ({ req, params }) => ({ data: await mentors.get(authOf(req), params.userId) }),
    },
    {
      method: 'get',
      path: '/mentors/:userId/slots',
      tag,
      summary: 'Free slots for a session type (UTC; both calendars considered)',
      access: REQUEST,
      params: userParams,
      query: slotsQuery,
      handler: async ({ req, params, query }) => ({
        data: await mentors.slots(authOf(req), params.userId, query),
      }),
    },
    // ── Requests ─────────────────────────────
    {
      method: 'post',
      path: '/mentorship/requests',
      tag,
      summary: 'Send a structured mentorship request (rate-limited, idempotent)',
      access: REQUEST,
      limiter: 'requests',
      bot: true,
      idempotent: true,
      body: mentorshipRequestBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await requests.create(authOf(req), tenantOf(req), body),
      }),
    },
    {
      method: 'get',
      path: '/mentorship/requests',
      tag,
      summary: 'Requests I received or sent',
      access: REQUEST,
      query: requestsQuery,
      handler: async ({ req, query }) => {
        const r = await requests.list(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'get',
      path: '/mentorship/requests/:id',
      tag,
      summary: 'One request (participants only)',
      access: REQUEST,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await requests.get(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/mentorship/requests/:id/respond',
      tag,
      summary: 'Accept, accept at another time, or decline with a kind reply',
      access: MENTOR,
      idempotent: true,
      params: idParams,
      body: respondBody,
      handler: async ({ req, params, body }) => ({
        data: await requests.respond(authOf(req), params.id, body),
      }),
    },
    {
      method: 'post',
      path: '/mentorship/requests/:id/withdraw',
      tag,
      summary: 'Withdraw a pending request I sent',
      access: REQUEST,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await requests.withdraw(authOf(req), params.id) }),
    },
    // ── Oversight ─────────────────────────────
    {
      method: 'get',
      path: '/admin/mentorship/overview',
      tag,
      summary: 'Mentorship activity for the college (last 30 days)',
      access: OVERSEE,
      handler: async () => ({
        data: { requests30d: await requests.overview(), sessions: await sessions.overview() },
      }),
    },
    {
      method: 'get',
      path: '/admin/mentorship/feedback',
      tag,
      summary: 'All session feedback (private to mentors and admins)',
      access: OVERSEE,
      query: cursorQuery,
      handler: async ({ query }) => {
        const r = await sessions.feedbackFor({}, query.cursor);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
  ];
}
