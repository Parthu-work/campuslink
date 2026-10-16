import { z } from 'zod';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { PrivacyService } from './privacy.service.js';

const SIGNED_IN = { kind: 'authenticated' } as const;
const tag = 'Privacy';
const deletionBody = z.strictObject({ password: z.string().min(1).max(200) });

export function privacyRoutes(s: PrivacyService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/export',
      tag,
      summary: 'Download everything this college’s space holds about me (JSON, audited)',
      access: SIGNED_IN,
      limiter: 'privacy',
      handler: async ({ req }) => {
        const data = await s.export(authOf(req), tenantOf(req), requestMeta(req));
        return {
          data: null,
          raw: {
            body: JSON.stringify(data, null, 2),
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Disposition': `attachment; filename="my-data-${data.exportedAt.slice(0, 10)}.json"`,
            },
          },
        };
      },
    },
    {
      method: 'get',
      path: '/me/deletion',
      tag,
      summary: 'Whether my account is scheduled for deletion, and when',
      access: SIGNED_IN,
      handler: async ({ req }) => ({ data: await s.status(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/deletion',
      tag,
      summary: 'Delete my account after the college’s grace period (password required; signs out everywhere)',
      access: SIGNED_IN,
      limiter: 'privacy',
      body: deletionBody,
      handler: async ({ req, body }) => ({
        data: await s.requestDeletion(authOf(req), tenantOf(req), body.password, requestMeta(req)),
      }),
    },
    {
      method: 'delete',
      path: '/me/deletion',
      tag,
      summary: 'Cancel my account deletion during the grace period',
      access: SIGNED_IN,
      handler: async ({ req }) => ({ data: await s.cancelDeletion(authOf(req), requestMeta(req)) }),
    },
  ];
}
