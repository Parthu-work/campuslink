import { createTenantBody, updateTenantBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { idParams } from '../../http/validation.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { PlatformService } from './platform.service.js';

export function platformRoutes(
  svc: PlatformService,
  checks: Record<string, () => Promise<boolean>>,
): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/platform/tenants',
      tag: 'Platform',
      summary: 'List colleges with aggregate usage',
      access: { kind: 'permission', permission: 'platform:tenants' },
      scope: 'platform',
      handler: async () => ({ data: await svc.listTenants() }),
    },
    {
      method: 'post',
      path: '/platform/tenants',
      tag: 'Platform',
      summary: 'Create a college and invite its first administrator',
      access: { kind: 'permission', permission: 'platform:tenants' },
      scope: 'platform',
      limiter: 'adminWrite',
      body: createTenantBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await svc.createTenant(authOf(req).userId, body, requestMeta(req)),
      }),
    },
    {
      method: 'patch',
      path: '/platform/tenants/:id',
      tag: 'Platform',
      summary: 'Suspend or resume a college; update subscription',
      access: { kind: 'permission', permission: 'platform:tenants' },
      scope: 'platform',
      limiter: 'adminWrite',
      params: idParams,
      body: updateTenantBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.updateTenant(authOf(req).userId, params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/platform/health',
      tag: 'Platform',
      summary: 'Platform health and aggregate counts',
      access: { kind: 'permission', permission: 'platform:health' },
      scope: 'platform',
      handler: async () => ({ data: await svc.health(checks) }),
    },
  ];
}
