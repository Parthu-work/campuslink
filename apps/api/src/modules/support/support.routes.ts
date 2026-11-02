import { z } from 'zod';
import {
  SUPPORT_LIMITS,
  objectId,
  supportQueueQuery,
  supportReplyBody,
  supportStatusBody,
  supportTicketBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { badRequest } from '../../lib/errors.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { FilesService } from '../files/files.service.js';
import type { SupportService } from './support.service.js';

const tag = 'Support';
const CREATE = { kind: 'permission', permission: 'support:create' } as const;
const MANAGE = { kind: 'permission', permission: 'support:manage' } as const;
const PLATFORM = { kind: 'permission', permission: 'platform:support' } as const;
const platformTicketParams = z.strictObject({ tenantId: objectId, id: objectId });

/** Help and support (build B14): problem reports, the college's desk and the platform's desk. */
export function supportRoutes(s: SupportService, files: FilesService): AnyRouteSpec[] {
  return [
    {
      method: 'post',
      path: '/support/screenshots',
      tag,
      summary: 'Upload a screenshot for a problem report (attach it within a day, once)',
      access: CREATE,
      limiter: 'upload',
      upload: { field: 'screenshot', maxBytes: SUPPORT_LIMITS.screenshotMb * 1024 * 1024 },
      handler: async ({ req, file }) => {
        if (!file) throw badRequest('Choose an image');
        return {
          status: 201,
          data: await files.storeImage(authOf(req).userId, 'support_screenshot', file.buffer),
        };
      },
    },
    {
      method: 'post',
      path: '/support/tickets',
      // Asking for help works while the college is read-only (B14), billing questions included.
      readOnlyOk: true,
      tag,
      summary: 'Report a problem (college matters go to the college, bugs to the platform)',
      access: CREATE,
      limiter: 'support',
      idempotent: true,
      body: supportTicketBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.create(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/support/tickets',
      tag,
      summary: 'My problem reports',
      access: CREATE,
      handler: async ({ req }) => ({ data: await s.mine(authOf(req)) }),
    },
    {
      method: 'get',
      path: '/support/tickets/:id',
      tag,
      summary: 'A problem report (its reporter, or the college’s desk for college matters)',
      access: { kind: 'authenticated' },
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.get(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/support/tickets/:id/replies',
      // Asking for help works while the college is read-only (B14), billing questions included.
      readOnlyOk: true,
      tag,
      summary: 'Reply to a problem report (its reporter, or the college’s desk)',
      access: { kind: 'authenticated' },
      limiter: 'support',
      params: idParams,
      body: supportReplyBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await s.reply(authOf(req), params.id, body.body),
      }),
    },
    {
      method: 'patch',
      path: '/support/tickets/:id',
      // Asking for help works while the college is read-only (B14), billing questions included.
      readOnlyOk: true,
      tag,
      summary: 'Close or reopen a problem report',
      access: { kind: 'authenticated' },
      params: idParams,
      body: supportStatusBody,
      handler: async ({ req, params, body }) => ({
        data: await s.setStatus(authOf(req), params.id, body.status),
      }),
    },
    {
      method: 'get',
      path: '/admin/support/tickets',
      tag,
      summary: 'Problem reports sent to the college, newest activity first',
      access: MANAGE,
      query: supportQueueQuery,
      handler: async ({ query }) => ({ data: await s.queue(query.status) }),
    },
    {
      method: 'get',
      path: '/platform/support/tickets',
      tag,
      summary: 'Bug reports from every college, newest activity first',
      access: PLATFORM,
      scope: 'platform',
      query: supportQueueQuery,
      handler: async ({ query }) => ({ data: await s.platformQueue(query.status) }),
    },
    {
      method: 'get',
      path: '/platform/support/tickets/:tenantId/:id',
      tag,
      summary: 'A bug report sent to the platform (audited)',
      access: PLATFORM,
      scope: 'platform',
      params: platformTicketParams,
      handler: async ({ req, params }) => ({
        data: await s.platformGet(params.tenantId, params.id, authOf(req).userId, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/platform/support/tickets/:tenantId/:id/replies',
      tag,
      summary: 'Answer a bug report (the member is told; audited)',
      access: PLATFORM,
      scope: 'platform',
      limiter: 'adminWrite',
      params: platformTicketParams,
      body: supportReplyBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await s.platformReply(
          params.tenantId,
          params.id,
          authOf(req).userId,
          body.body,
          requestMeta(req),
        ),
      }),
    },
    {
      method: 'patch',
      path: '/platform/support/tickets/:tenantId/:id',
      tag,
      summary: 'Close or reopen a bug report',
      access: PLATFORM,
      scope: 'platform',
      limiter: 'adminWrite',
      params: platformTicketParams,
      body: supportStatusBody,
      handler: async ({ params, body }) => {
        await s.platformSetStatus(params.tenantId, params.id, body.status);
        return { data: { ok: true } };
      },
    },
    {
      method: 'get',
      path: '/platform/support/tickets/:tenantId/:id/screenshot',
      tag,
      summary: 'The screenshot attached to a bug report',
      access: PLATFORM,
      scope: 'platform',
      params: platformTicketParams,
      handler: async ({ params }) => {
        const f = await s.platformScreenshot(params.tenantId, params.id);
        return {
          data: null,
          raw: {
            body: f.data,
            headers: {
              'Content-Type': f.mime,
              'Content-Disposition': 'inline; filename="screenshot.webp"',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "default-src 'none'; sandbox",
              'Cross-Origin-Resource-Policy': 'same-origin',
              'Cache-Control': 'private, no-store',
            },
          },
        };
      },
    },
  ];
}
