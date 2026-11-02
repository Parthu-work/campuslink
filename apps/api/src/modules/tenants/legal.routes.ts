import { z } from 'zod';
import {
  LEGAL_DOCS,
  SUPPORTED_LOCALES,
  legalSettingsBody,
  noticeAcceptBody,
  retentionBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { LegalService } from './legal.service.js';

const tag = 'Legal';
const docParams = z.strictObject({ doc: z.enum(LEGAL_DOCS) });
/** The reader's language (prompt 1b, R13): its reviewed translation when published, else English. */
const docQuery = z.strictObject({ lang: z.enum(SUPPORTED_LOCALES).optional() });

/** The college's privacy policy and terms, its legal details, and accepting a new notice (B14). */
export function legalRoutes(s: LegalService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/legal/:doc',
      tag,
      summary: 'The college’s privacy policy or terms, with its details filled in (public)',
      access: { kind: 'public' },
      params: docParams,
      query: docQuery,
      handler: async ({ req, params, query }) => ({ data: s.doc(tenantOf(req), params.doc, query.lang) }),
    },
    {
      method: 'get',
      path: '/admin/legal',
      tag,
      summary: 'The college’s legal details (legal name, address, grievance officer)',
      access: { kind: 'permission', permission: 'tenant:branding' },
      handler: async ({ req }) => ({ data: s.settings(tenantOf(req)) }),
    },
    // The inactive-account purge (prompt 1b, R7): off unless the college turns it on.
    {
      method: 'get',
      path: '/admin/retention',
      tag,
      summary: 'Whether accounts unused for some months are deleted (and after how many)',
      access: { kind: 'permission', permission: 'tenant:settings' },
      handler: async ({ req }) => ({ data: s.retention(tenantOf(req)) }),
    },
    {
      method: 'put',
      path: '/admin/retention',
      tag,
      summary: 'Turn the inactive-account purge on (24 to 120 months) or off; members accept the new notice',
      access: { kind: 'permission', permission: 'tenant:settings' },
      limiter: 'adminWrite',
      body: retentionBody,
      handler: async ({ req, body }) => ({
        data: await s.updateRetention(tenantOf(req), authOf(req).userId, body, requestMeta(req)),
      }),
    },
    {
      method: 'put',
      path: '/admin/legal',
      tag,
      summary: 'Publish the college’s legal details (members accept the new notice on next sign-in)',
      access: { kind: 'permission', permission: 'tenant:branding' },
      limiter: 'adminWrite',
      body: legalSettingsBody,
      handler: async ({ req, body }) => ({
        data: await s.update(tenantOf(req), authOf(req).userId, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/me/notice',
      tag,
      summary: 'Accept the current privacy notice and terms',
      access: { kind: 'authenticated' },
      readOnlyOk: true,
      body: noticeAcceptBody,
      handler: async ({ req, body }) => ({
        data: await s.accept(tenantOf(req), authOf(req).userId, body.version, requestMeta(req)),
      }),
    },
  ];
}
