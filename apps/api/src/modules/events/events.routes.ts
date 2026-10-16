import { z } from 'zod';
import {
  checkInBody,
  eventBody,
  eventQuestionBody,
  eventQuestionStatusBody,
  eventUpdateBody,
  eventsQuery,
  rsvpBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { EventsService } from './events.service.js';

const RSVP = { kind: 'permission', permission: 'events:rsvp' } as const;
const tag = 'Events';
const voteBody = z.strictObject({ on: z.boolean() });

export function eventRoutes(s: EventsService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/events',
      tag,
      summary: 'Upcoming, past or my events (only those meant for me)',
      access: RSVP,
      query: eventsQuery,
      handler: async ({ req, query }) => ({ data: await s.list(authOf(req), query) }),
    },
    {
      method: 'post',
      path: '/events',
      tag,
      summary: 'Create an event (staff: any kind; alumni hosts: AMAs and office hours)',
      // Authorised in the service by kind: `events:create`, or `ama:host` for hosted kinds.
      access: RSVP,
      limiter: 'interact',
      idempotent: true,
      body: eventBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.create(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/events/:id',
      tag,
      summary: 'One event, with my RSVP and the online link when it is open',
      access: RSVP,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.get(authOf(req), params.id) }),
    },
    {
      method: 'put',
      path: '/events/:id',
      tag,
      summary: 'Change an event (host or staff); people going are told',
      access: RSVP,
      params: idParams,
      body: eventUpdateBody,
      handler: async ({ req, params, body }) => ({
        data: await s.update(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/events/:id/cancel',
      tag,
      summary: 'Cancel an event (host or staff); people going are told',
      access: RSVP,
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await s.cancel(authOf(req), params.id, requestMeta(req)),
      }),
    },
    {
      method: 'put',
      path: '/events/:id/rsvp',
      tag,
      summary: 'RSVP (joins the waitlist when full) or cancel my RSVP',
      access: RSVP,
      limiter: 'interact',
      params: idParams,
      body: rsvpBody,
      handler: async ({ req, params, body }) => ({ data: await s.rsvp(authOf(req), params.id, body.going) }),
    },
    {
      method: 'get',
      path: '/events/:id/ics',
      tag,
      summary: 'Download the event for a calendar (.ics)',
      access: RSVP,
      params: idParams,
      handler: async ({ req, params }) => ({
        data: null,
        raw: {
          body: await s.ics(authOf(req), params.id),
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'attachment; filename="event.ics"',
          },
        },
      }),
    },
    {
      method: 'get',
      path: '/events/:id/attendees',
      tag,
      summary: 'Who is going or waiting (host or staff)',
      access: RSVP,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.attendees(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/events/:id/check-in',
      tag,
      summary: 'Mark an attendee as present (host or staff)',
      access: RSVP,
      params: idParams,
      body: checkInBody,
      handler: async ({ req, params, body }) => ({
        data: await s.checkIn(authOf(req), params.id, body.userId, body.attended),
      }),
    },
    {
      method: 'get',
      path: '/events/:id/questions',
      tag,
      summary: 'The live Q&A queue (AMAs, office hours, talks)',
      access: RSVP,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.questions(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/events/:id/questions',
      tag,
      summary: 'Ask a question in the queue',
      access: RSVP,
      limiter: 'interact',
      bot: true,
      params: idParams,
      body: eventQuestionBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await s.ask(authOf(req), params.id, body.body),
      }),
    },
    {
      method: 'put',
      path: '/event-questions/:id/vote',
      tag,
      summary: 'Upvote a question (one vote each)',
      access: RSVP,
      limiter: 'interact',
      params: idParams,
      body: voteBody,
      handler: async ({ req, params, body }) => ({ data: await s.vote(authOf(req), params.id, body.on) }),
    },
    {
      method: 'patch',
      path: '/event-questions/:id',
      tag,
      summary: 'Mark a question answered, reopen it or hide it (host or staff)',
      access: RSVP,
      params: idParams,
      body: eventQuestionStatusBody,
      handler: async ({ req, params, body }) => ({
        data: await s.setQuestionStatus(authOf(req), params.id, body.status),
      }),
    },
  ];
}
