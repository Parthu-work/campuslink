import { z } from 'zod';
import { bookingsQuery, cancelBody, feedbackBody, rescheduleBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import type { SessionsService } from './sessions.service.js';

const BOOK = { kind: 'permission', permission: 'sessions:book' } as const;
const tag = 'Sessions';

export function sessionRoutes(svc: SessionsService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/bookings',
      tag,
      summary: 'My upcoming or past sessions (as mentor or mentee)',
      access: BOOK,
      query: bookingsQuery,
      handler: async ({ req, query }) => {
        const r = await svc.list(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'get',
      path: '/bookings/:id',
      tag,
      summary: 'One session (participants only)',
      access: BOOK,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await svc.get(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/bookings/:id/slots',
      tag,
      summary: 'Times this session can move to (both calendars considered)',
      access: BOOK,
      params: idParams,
      query: z.strictObject({ days: z.coerce.number().int().min(1).max(21).default(14) }),
      handler: async ({ req, params, query }) => ({
        data: await svc.slotsFor(authOf(req), params.id, query.days),
      }),
    },
    {
      method: 'post',
      path: '/bookings/:id/reschedule',
      tag,
      summary: 'Move a session to another free slot (at most twice)',
      access: BOOK,
      idempotent: true,
      params: idParams,
      body: rescheduleBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.reschedule(authOf(req), params.id, body.slotStart),
      }),
    },
    {
      method: 'post',
      path: '/bookings/:id/cancel',
      tag,
      summary: 'Cancel an upcoming session (late cancellations are recorded)',
      access: BOOK,
      params: idParams,
      body: cancelBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.cancel(authOf(req), params.id, body.reason),
      }),
    },
    {
      method: 'post',
      path: '/bookings/:id/join',
      tag,
      summary: 'Short-lived video link (participants, around the session time only)',
      access: BOOK,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await svc.join(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/bookings/:id/ics',
      tag,
      summary: 'Calendar file for a session (no video link inside)',
      access: BOOK,
      params: idParams,
      handler: async ({ req, params }) => ({
        data: null,
        raw: {
          body: await svc.ics(authOf(req), tenantOf(req), params.id),
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'attachment; filename="session.ics"',
            'X-Content-Type-Options': 'nosniff',
          },
        },
      }),
    },
    {
      method: 'post',
      path: '/bookings/:id/no-show',
      tag,
      summary: 'Report that the other person did not join (within 48 hours)',
      access: BOOK,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await svc.markNoShow(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/bookings/:id/feedback',
      tag,
      summary: 'Rate a completed session (mentee; private to the mentor and admins)',
      access: BOOK,
      params: idParams,
      body: feedbackBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await svc.feedback(authOf(req), params.id, body),
      }),
    },
  ];
}
