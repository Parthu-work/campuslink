import { analyticsQuery, exportQuery } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { AnalyticsService } from './analytics.service.js';

const tag = 'Analytics';

export function analyticsRoutes(s: AnalyticsService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/admin/analytics',
      tag,
      summary: 'Aggregated college analytics (cohort view for faculty); counts under 5 are suppressed',
      access: { kind: 'permission', permission: 'analytics:cohort' },
      query: analyticsQuery,
      handler: async ({ req, query }) => ({ data: await s.dashboard(authOf(req), query) }),
    },
    {
      method: 'get',
      path: '/admin/analytics/export',
      tag,
      summary: 'Download a report as CSV (audited)',
      access: { kind: 'permission', permission: 'reports:export' },
      limiter: 'search',
      query: exportQuery,
      handler: async ({ req, query }) => {
        const { report, ...q } = query;
        const out = await s.exportCsv(authOf(req), q, report, requestMeta(req));
        return {
          data: null,
          raw: {
            body: out.csv,
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="${out.filename}"`,
            },
          },
        };
      },
    },
  ];
}
