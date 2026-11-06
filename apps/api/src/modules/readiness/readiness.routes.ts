import {
  readinessBoardQuery,
  readinessConfigBody,
  readinessExportQuery,
  readinessNudgeBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { ReadinessService } from './readiness.service.js';

const tag = 'Readiness';
const VIEW = { kind: 'permission', permission: 'readiness:view' } as const;
const BOARD = { kind: 'permission', permission: 'readiness:board' } as const;
const MANAGE = { kind: 'permission', permission: 'readiness:manage' } as const;

/** Placement readiness (prompt 2, G5): the student's own score, and the placement cell's board. */
export function readinessRoutes(s: ReadinessService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/readiness',
      tag,
      summary: 'My readiness score: each component’s points and my next steps (mine only)',
      access: VIEW,
      handler: async ({ req }) => ({ data: await s.mine(authOf(req)) }),
    },
    {
      method: 'get',
      path: '/admin/readiness',
      tag,
      summary:
        'The readiness board: distribution by batch and branch (small counts hidden) and who needs help',
      access: BOARD,
      limiter: 'search',
      query: readinessBoardQuery,
      handler: async ({ query }) => ({ data: await s.board(query) }),
    },
    {
      method: 'get',
      path: '/admin/readiness/config',
      tag,
      summary: 'The college’s readiness weights, threshold and closing window',
      access: BOARD,
      handler: async () => ({ data: await s.configView() }),
    },
    {
      method: 'put',
      path: '/admin/readiness/config',
      tag,
      summary: 'Set the readiness weights, the "needs help" threshold and the closing window (audited)',
      access: MANAGE,
      limiter: 'adminWrite',
      body: readinessConfigBody,
      handler: async ({ req, body }) => ({ data: await s.setConfig(authOf(req), body, requestMeta(req)) }),
    },
    {
      method: 'post',
      path: '/admin/readiness/nudge',
      tag,
      summary: 'Nudge students who need help before a drive closes (once a week each, within WhatsApp caps)',
      access: MANAGE,
      limiter: 'adminWrite',
      idempotent: true,
      body: readinessNudgeBody,
      handler: async ({ req, body }) => ({
        data: await s.nudge(authOf(req), body.userIds, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/readiness/export',
      tag,
      summary: 'Export the readiness board, one row per student (minors never; audited)',
      access: MANAGE,
      limiter: 'search',
      query: readinessExportQuery,
      handler: async ({ req, query }) => {
        const { format, ...q } = query;
        const f = await s.export(authOf(req), q, format, requestMeta(req));
        return {
          data: null,
          raw: {
            body: f.body,
            headers: {
              'Content-Type': f.type,
              'Content-Disposition': `attachment; filename="${f.name}"`,
              'X-Content-Type-Options': 'nosniff',
              'Cache-Control': 'no-store',
            },
          },
        };
      },
    },
  ];
}
