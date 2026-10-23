import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import type { AdminOverviewService } from './overview.service.js';

export function adminOverviewRoutes(s: AdminOverviewService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/admin/overview',
      tag: 'Admin',
      summary:
        'What is waiting for me: queue sizes I may act on, and member and activity counts (suppressed); 403 without admin access',
      access: { kind: 'authenticated' },
      handler: async ({ req }) => ({ data: await s.overview(authOf(req)) }),
    },
  ];
}
