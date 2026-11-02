import {
  examBody,
  higherStudyBody,
  outcomeDecisionBody,
  outcomeKindParams,
  outcomeParams,
  outcomesQueueQuery,
  ventureBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { OutcomesService } from './outcomes.service.js';

const REPORT = { kind: 'permission', permission: 'outcomes:report' } as const;
const VERIFY = { kind: 'permission', permission: 'outcomes:verify' } as const;
const tag = 'Outcomes';

/** Higher studies, exams and ventures: reported by members, verified or imported by the cell (B8). */
export function outcomeRoutes(s: OutcomesService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/outcomes',
      tag,
      summary: 'My higher studies, exams and ventures, with what the placement cell decided',
      access: REPORT,
      handler: async ({ req }) => ({ data: await s.mine(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/outcomes/higher_study',
      tag,
      summary: 'Report my admission to higher studies (counts once verified)',
      access: REPORT,
      limiter: 'requests',
      idempotent: true,
      body: higherStudyBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.report(authOf(req), 'higher_study', body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/me/outcomes/exam',
      tag,
      summary: 'Report an exam I qualified (GATE, CAT, GRE and others; counts once verified)',
      access: REPORT,
      limiter: 'requests',
      idempotent: true,
      body: examBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.report(authOf(req), 'exam', body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/me/outcomes/venture',
      tag,
      summary: 'Report a venture I started (counts once verified)',
      access: REPORT,
      limiter: 'requests',
      idempotent: true,
      body: ventureBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.report(authOf(req), 'venture', body, requestMeta(req)),
      }),
    },
    {
      method: 'delete',
      path: '/me/outcomes/:kind/:id',
      tag,
      summary: 'Take back one of my outcomes the placement cell has not verified',
      access: REPORT,
      params: outcomeParams,
      handler: async ({ req, params }) => ({ data: await s.remove(authOf(req), params.kind, params.id) }),
    },
    {
      method: 'get',
      path: '/admin/outcomes/:kind',
      tag,
      summary: 'Reported, verified or rejected outcomes of one kind',
      access: VERIFY,
      params: outcomeKindParams,
      query: outcomesQueueQuery,
      handler: async ({ params, query }) => {
        const r = await s.queue(params.kind, query.status, query.cursor);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/admin/outcomes/:kind/:id/decision',
      tag,
      summary: 'Verify or reject a reported outcome (the member sees the reason)',
      access: VERIFY,
      limiter: 'adminWrite',
      params: outcomeParams,
      body: outcomeDecisionBody,
      handler: async ({ req, params, body }) => ({
        data: await s.decide(
          authOf(req).userId,
          params.kind,
          params.id,
          body.decision,
          body.reason,
          requestMeta(req),
        ),
      }),
    },
    {
      method: 'post',
      path: '/admin/outcomes/:kind/import',
      tag,
      summary:
        'Outcomes from the college’s CSV or Excel sheet keyed by roll number (verified; unknown rolls listed)',
      access: VERIFY,
      limiter: 'upload',
      params: outcomeKindParams,
      upload: { field: 'file', maxBytes: 5 * 1024 * 1024 },
      handler: async ({ req, params, file }) => ({
        data: await s.importSheet(authOf(req), params.kind, file, requestMeta(req)),
      }),
    },
  ];
}
