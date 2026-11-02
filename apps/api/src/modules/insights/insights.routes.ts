import { Types } from 'mongoose';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { InsightsService } from './insights.service.js';
import type { PlatformService } from '../platform/platform.service.js';

const tag = 'Insights';

/** First-party product analytics (B9): the college's own, and the platform's cross-college view. */
export function insightsRoutes(s: InsightsService, platform: PlatformService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/admin/insights',
      tag,
      summary:
        'Activation, weekly actives, retention, mentorship and placement metrics (counts under 5 suppressed)',
      access: { kind: 'permission', permission: 'analytics:tenant' },
      handler: async () => ({ data: await s.dashboard() }),
    },
    {
      method: 'get',
      path: '/platform/insights',
      tag,
      summary: 'The same metrics per college, from per-college aggregates only (audited)',
      access: { kind: 'permission', permission: 'platform:tenants' },
      scope: 'platform',
      handler: async ({ req }) => {
        const colleges = (await platform.listTenants()).map((t) => ({
          id: new Types.ObjectId(t.id),
          slug: t.slug,
          name: t.branding.displayName,
        }));
        return { data: await s.platform(colleges, authOf(req).userId, requestMeta(req)) };
      },
    },
  ];
}
