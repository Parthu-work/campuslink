import { brandingSchema, tenantSettingsBody, type PublicBotCheck } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import { tenantsService, toPublicTenant } from './tenants.service.js';

/** `botCheck`: the public half of the bot-protection config (site key), the same for every college. */
export function tenantRoutes(botCheck: PublicBotCheck | null = null): AnyRouteSpec[] {
  return [
    {
      // Public on purpose: the sign-in page needs the college's name and colours. Contains no personal data.
      method: 'get',
      path: '/tenant',
      tag: 'Tenant',
      summary: 'Public branding for the college on this subdomain',
      access: { kind: 'public' },
      scope: 'any',
      handler: async ({ req }) => ({ data: toPublicTenant(tenantOf(req), botCheck) }),
    },
    {
      method: 'put',
      path: '/tenant/branding',
      tag: 'Tenant',
      summary: 'Update college branding',
      access: { kind: 'permission', permission: 'tenant:branding' },
      limiter: 'adminWrite',
      body: brandingSchema,
      handler: async ({ req, body }) => ({
        data: await tenantsService.updateBranding(tenantOf(req), authOf(req).userId, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/tenant/settings',
      tag: 'Tenant',
      summary: 'Features, limits and permission overrides',
      access: { kind: 'permission', permission: 'tenant:settings' },
      handler: async ({ req }) => ({ data: await tenantsService.settings(tenantOf(req)) }),
    },
    {
      method: 'patch',
      path: '/tenant/settings',
      tag: 'Tenant',
      summary: 'Update features, limits and permission overrides',
      access: { kind: 'permission', permission: 'tenant:settings' },
      limiter: 'adminWrite',
      body: tenantSettingsBody,
      handler: async ({ req, body }) => ({
        data: await tenantsService.updateSettings(tenantOf(req), authOf(req).userId, body, requestMeta(req)),
      }),
    },
  ];
}
