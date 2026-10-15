import { z } from 'zod';
import type { AnyRouteSpec } from '../../http/registry.js';
import { audit } from './audit.service.js';

const query = z.strictObject({
  cursor: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z
    .string()
    .regex(/^[a-z_]+\.[a-z_]+$/)
    .optional(),
});

export function auditRoutes(): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/admin/audit',
      tag: 'Admin',
      summary: 'Read this college’s audit log (newest first)',
      access: { kind: 'permission', permission: 'audit:read' },
      query,
      scope: 'any',
      handler: async ({ query: q }) => {
        const r = await audit.list(q);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
  ];
}
