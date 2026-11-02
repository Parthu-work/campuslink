import type { Request } from 'express';
import { reportExportQuery, reportParams, reportQuery } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { ReportsService } from './reports.service.js';

const VIEW = { kind: 'permission', permission: 'analytics:tenant' } as const;
const EXPORT = { kind: 'permission', permission: 'reports:export' } as const;
const tag = 'Reports';

const file = (f: { body: Buffer; type: string; name: string }) => ({
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
});
const meta = (req: Request) => requestMeta(req);

/** Accreditation and placement reports, and the principal's dashboard (B8). */
export function reportRoutes(s: ReportsService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/admin/outcome-reports',
      tag,
      summary: 'The reports the college can generate (NBA, NAAC, NIRF-style and internal)',
      access: VIEW,
      handler: async () => ({ data: s.list() }),
    },
    {
      method: 'get',
      path: '/admin/outcome-reports/dashboard',
      tag,
      summary: 'Placement %, median band, top recruiters and the five-year trend (counts under 5 suppressed)',
      access: VIEW,
      query: reportQuery,
      handler: async ({ query }) => ({ data: await s.dashboard(query) }),
    },
    {
      method: 'get',
      path: '/admin/outcome-reports/:id',
      tag,
      summary: 'One report for a programme and batch (counts under 5 suppressed)',
      access: VIEW,
      params: reportParams,
      query: reportQuery,
      handler: async ({ params, query }) => ({ data: await s.run(params.id, query) }),
    },
    {
      method: 'get',
      path: '/admin/outcome-reports/:id/export',
      tag,
      summary: 'Download the report table as CSV or Excel (audited)',
      access: EXPORT,
      limiter: 'search',
      params: reportParams,
      query: reportExportQuery,
      handler: async ({ req, params, query }) =>
        file(await s.exportSummary(authOf(req), params.id, query, query.format, meta(req))),
    },
    {
      method: 'get',
      path: '/admin/outcome-reports/:id/evidence',
      tag,
      summary: 'Evidence workbook: exact counts and every student behind them (audited)',
      access: EXPORT,
      limiter: 'search',
      params: reportParams,
      query: reportQuery,
      handler: async ({ req, params, query }) =>
        file(await s.exportEvidence(authOf(req), params.id, query, meta(req))),
    },
  ];
}
