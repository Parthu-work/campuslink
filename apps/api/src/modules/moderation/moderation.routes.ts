import { z } from 'zod';
import { blockBody, objectId, reportBody, reportsQuery, resolveReportBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { SafetyService } from './safety.service.js';

const tag = 'Safety';

export function moderationRoutes(svc: SafetyService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/blocks',
      tag,
      summary: 'People I blocked',
      access: { kind: 'authenticated' },
      handler: async ({ req }) => ({ data: await svc.myBlocks(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/blocks',
      readOnlyOk: true,
      tag,
      summary: 'Block someone (closes chat, withdraws requests, cancels future sessions)',
      access: { kind: 'authenticated' },
      limiter: 'reports',
      body: blockBody,
      handler: async ({ req, body }) => ({ data: await svc.block(authOf(req), body.userId) }),
    },
    {
      method: 'delete',
      path: '/me/blocks/:userId',
      readOnlyOk: true,
      tag,
      summary: 'Unblock someone',
      access: { kind: 'authenticated' },
      params: z.strictObject({ userId: objectId }),
      handler: async ({ req, params }) => ({ data: await svc.unblock(authOf(req), params.userId) }),
    },
    {
      method: 'post',
      path: '/reports',
      readOnlyOk: true,
      tag,
      summary: 'Report a person, message or request',
      access: { kind: 'permission', permission: 'content:report' },
      limiter: 'reports',
      body: reportBody,
      handler: async ({ req, body }) => ({ status: 201, data: await svc.report(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/admin/reports',
      tag,
      summary: 'Reports to review (message reports carry a snapshot, never the conversation)',
      access: { kind: 'permission', permission: 'moderation:act' },
      query: reportsQuery,
      handler: async ({ query }) => {
        const r = await svc.listReports(query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/admin/reports/:id/resolve',
      readOnlyOk: true,
      tag,
      summary: 'Resolve a report (audited)',
      access: { kind: 'permission', permission: 'moderation:act' },
      limiter: 'adminWrite',
      params: idParams,
      body: resolveReportBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.resolveReport(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
  ];
}
