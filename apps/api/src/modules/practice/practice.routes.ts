import {
  practiceAnswerBody,
  practiceDecisionBody,
  practiceDraftBody,
  practiceItemBody,
  practiceItemIdParams,
  practiceItemsQuery,
  practiceMasteryQuery,
  practiceSetIdParams,
  practiceStartBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import type { PracticeService } from './practice.service.js';

const tag = 'Practice';
const use = { kind: 'permission', permission: 'practice:use' } as const;
const author = { kind: 'permission', permission: 'practice:author' } as const;
const review = { kind: 'permission', permission: 'practice:review' } as const;
const cohort = { kind: 'permission', permission: 'analytics:cohort' } as const;

/** Aptitude and coding practice (prompt 2, G4). */
export function practiceRoutes(s: PracticeService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/practice',
      tag,
      summary: 'Today\x27s set, my streak, topic accuracy and the companies I can prepare for',
      access: use,
      handler: async ({ req }) => ({ data: await s.home(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/practice/sets',
      tag,
      summary: 'Start (or resume) today\x27s set, or a "Preparing for <company>" set',
      access: use,
      idempotent: true,
      body: practiceStartBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.start(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/practice/sets/:id',
      tag,
      summary: 'One of my practice sets with the answers so far',
      access: use,
      params: practiceSetIdParams,
      handler: async ({ req, params }) => ({ data: await s.get(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/practice/sets/:id/answers',
      tag,
      summary: 'Answer one question (coding answers run on the platform\x27s code runner, when it is on)',
      access: use,
      limiter: 'posting',
      params: practiceSetIdParams,
      body: practiceAnswerBody,
      handler: async ({ req, params, body }) => ({ data: await s.answer(authOf(req), params.id, body) }),
    },
    {
      method: 'post',
      path: '/practice/items',
      tag,
      summary: 'Write a practice question (an alumnus\x27s waits for faculty review)',
      access: author,
      limiter: 'posting',
      body: practiceItemBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.add(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/admin/practice/items',
      tag,
      summary: 'The practice bank by status (alumni questions and AI drafts wait here for review)',
      access: review,
      query: practiceItemsQuery,
      handler: async ({ query }) => ({ data: await s.items(query) }),
    },
    {
      method: 'put',
      path: '/admin/practice/items/:id',
      tag,
      summary: 'Correct a practice question or tag the companies it prepares for',
      access: review,
      params: practiceItemIdParams,
      body: practiceItemBody,
      handler: async ({ req, params, body }) => ({ data: await s.update(authOf(req), params.id, body) }),
    },
    {
      method: 'post',
      path: '/admin/practice/items/:id/decision',
      tag,
      summary: 'Approve (optionally corrected) or reject a practice question',
      access: review,
      params: practiceItemIdParams,
      body: practiceDecisionBody,
      handler: async ({ req, params, body }) => ({ data: await s.decide(authOf(req), params.id, body) }),
    },
    {
      method: 'post',
      path: '/admin/practice/drafts',
      tag,
      summary: 'Ask the AI to draft questions for a topic (they wait for review)',
      access: review,
      limiter: 'aiChat',
      body: practiceDraftBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.draft(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/admin/practice/mastery',
      tag,
      summary: 'Topic accuracy by graduation year, small groups suppressed (for planning training)',
      access: cohort,
      query: practiceMasteryQuery,
      handler: async ({ query }) => ({ data: await s.mastery(query) }),
    },
  ];
}
