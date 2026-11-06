import { calendarFeedParams } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { notFound } from '../../lib/errors.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { CalendarService } from './calendar.service.js';

const tag = 'Calendar';
const member = { kind: 'authenticated' } as const;

/** The member's calendar feed (prompt 2, G9): a secret address calendars subscribe to. */
export function calendarRoutes(s: CalendarService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/calendar-feed',
      tag,
      summary: 'Whether my calendar feed is on, and when a calendar last read it',
      access: member,
      handler: async ({ req }) => ({ data: await s.view(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/calendar-feed',
      tag,
      summary: 'Make my calendar feed, or replace its address (the old one stops working)',
      access: member,
      limiter: 'adminWrite',
      handler: async ({ req }) => ({ data: await s.issue(authOf(req), tenantOf(req), requestMeta(req)) }),
    },
    {
      method: 'delete',
      path: '/me/calendar-feed',
      tag,
      summary: 'Turn my calendar feed off',
      access: member,
      handler: async ({ req }) => ({ data: await s.stop(authOf(req), requestMeta(req)) }),
    },
    {
      method: 'get',
      path: '/calendar/:file',
      tag,
      summary: 'A member’s calendar (ICS), by its secret address',
      access: { kind: 'public' },
      limiter: 'search',
      params: calendarFeedParams,
      handler: async ({ req, params }) => {
        const body = await s.feed(tenantOf(req), params.file.slice(0, -'.ics'.length));
        if (!body) throw notFound('Calendar');
        return {
          data: null,
          raw: {
            body,
            headers: {
              'Content-Type': 'text/calendar; charset=utf-8',
              'Cache-Control': 'private, max-age=900',
              'X-Content-Type-Options': 'nosniff',
            },
          },
        };
      },
    },
  ];
}
