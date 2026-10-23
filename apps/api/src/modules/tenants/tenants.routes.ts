import { z } from 'zod';
import { brandingSchema, LOGO_MAX_BYTES, tenantSettingsBody, type PublicBotCheck } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { FilesService } from '../files/files.service.js';
import { tenantsService, toPublicTenant } from './tenants.service.js';

/** `?v=` is only a cache key (the current logo's id); the logo served is always the current one. */
const logoQuery = z.strictObject({
  v: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .optional(),
});

/** `botCheck`: the public half of the bot-protection config (site key), the same for every college. */
export function tenantRoutes(files: FilesService, botCheck: PublicBotCheck | null = null): AnyRouteSpec[] {
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
      // Public like `/tenant`: the sign-in page shows the logo. It is a re-encoded image, served sandboxed.
      method: 'get',
      path: '/tenant/logo',
      tag: 'Tenant',
      summary: 'The college logo (re-encoded WebP)',
      access: { kind: 'public' },
      query: logoQuery,
      handler: async ({ req, query }) => {
        const id = tenantOf(req).logo?.fileId;
        if (!id) throw notFound('Logo');
        const f = await files.readLogo(String(id));
        return {
          data: null,
          raw: {
            body: f.data,
            headers: {
              'Content-Type': f.mime,
              'Content-Disposition': 'inline; filename="logo.webp"',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "default-src 'none'; sandbox",
              'Cross-Origin-Resource-Policy': 'same-origin',
              // A versioned link never changes; the bare one may (a new logo).
              'Cache-Control':
                query.v === String(id) ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
            },
          },
        };
      },
    },
    {
      method: 'post',
      path: '/tenant/logo',
      tag: 'Tenant',
      summary: `Upload the college logo (PNG or WebP up to ${LOGO_MAX_BYTES / 1024} KB; re-encoded, scanned, audited)`,
      access: { kind: 'permission', permission: 'tenant:branding' },
      limiter: 'upload',
      upload: { field: 'file', maxBytes: LOGO_MAX_BYTES },
      handler: async ({ req, file }) => {
        if (!file) throw badRequest('Choose an image');
        return {
          data: await tenantsService.setLogo(
            files,
            tenantOf(req),
            authOf(req).userId,
            file.buffer,
            requestMeta(req),
          ),
        };
      },
    },
    {
      method: 'delete',
      path: '/tenant/logo',
      tag: 'Tenant',
      summary: 'Remove the college logo (the monogram shows again; audited)',
      access: { kind: 'permission', permission: 'tenant:branding' },
      limiter: 'adminWrite',
      handler: async ({ req }) => ({
        data: await tenantsService.removeLogo(files, tenantOf(req), authOf(req).userId, requestMeta(req)),
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
