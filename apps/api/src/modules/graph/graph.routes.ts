import {
  companiesQuery,
  companyKeyParams,
  experienceBody,
  experienceDecisionBody,
  experienceIdParams,
  experienceSentBody,
  experiencesReviewQuery,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import type { GraphService } from './graph.service.js';
import type { ExperiencesService } from './experiences.service.js';

const tag = 'Companies';
const view = { kind: 'permission', permission: 'companies:view' } as const;
const share = { kind: 'permission', permission: 'experiences:share' } as const;
const review = { kind: 'permission', permission: 'experiences:review' } as const;

/** Company pages from the Placement Graph and the Interview Experience Bank (prompt 2, G10). */
export function graphRoutes(graph: GraphService, experiences: ExperiencesService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/companies',
      tag,
      summary: 'Companies that recruit from the college or employ its alumni (aggregates, suppressed)',
      access: view,
      query: companiesQuery,
      limiter: 'search',
      handler: async ({ req, query }) => ({ data: await graph.companies(authOf(req), query.q) }),
    },
    {
      method: 'get',
      path: '/companies/:key',
      tag,
      summary: 'A company page: batches, branches, CTC bands, rounds, alumni there and interview write-ups',
      access: view,
      params: companyKeyParams,
      handler: async ({ req, params }) => ({ data: await graph.company(authOf(req), params.key) }),
    },
    {
      method: 'get',
      path: '/me/experiences',
      tag,
      summary: 'My interview write-ups and the companies I may write about',
      access: share,
      handler: async ({ req }) => ({ data: await experiences.mine(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/experiences',
      tag,
      summary: 'Share an interview experience (reviewed before it is published)',
      access: share,
      body: experienceBody,
      limiter: 'posting',
      idempotent: true,
      handler: async ({ req, body }) => ({ status: 201, data: await experiences.create(authOf(req), body) }),
    },
    {
      method: 'delete',
      path: '/me/experiences/:id',
      tag,
      summary: 'Withdraw a write-up that is not published yet',
      access: share,
      params: experienceIdParams,
      handler: async ({ req, params }) => {
        await experiences.withdraw(authOf(req), params.id);
        return { status: 204, data: null };
      },
    },
    {
      method: 'get',
      path: '/admin/experiences',
      tag,
      summary: 'Interview write-ups by review status',
      access: review,
      query: experiencesReviewQuery,
      handler: async ({ req, query }) => ({ data: await experiences.queue(authOf(req), query.status) }),
    },
    {
      method: 'post',
      path: '/admin/experiences/:id/decision',
      tag,
      summary: 'Publish a write-up (sending picked questions to the interview bank) or send it back',
      access: review,
      params: experienceIdParams,
      body: experienceDecisionBody,
      handler: async ({ req, params, body }) => ({
        data: await experiences.decide(authOf(req), params.id, body),
      }),
    },
    {
      method: 'post',
      path: '/admin/experiences/:id/practice',
      tag,
      summary: 'Mark a question of a published write-up as written up as a practice question',
      access: review,
      params: experienceIdParams,
      body: experienceSentBody,
      handler: async ({ params, body }) => {
        await experiences.markPractice(params.id, body.round, body.question);
        return { status: 204, data: null };
      },
    },
  ];
}
