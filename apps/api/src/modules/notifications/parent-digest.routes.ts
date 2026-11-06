import { z } from 'zod';
import { parentDigestBody, parentDigestConfirmBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { ParentDigestService } from './parent-digest.service.js';

const tag = 'Parent digest';
const digest = { kind: 'permission', permission: 'parents:digest' } as const;

/** The monthly parent digest (prompt 2, G8): student-initiated, confirmed by the parent, revocable. */
export function parentDigestRoutes(s: ParentDigestService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/parent-digest',
      tag,
      summary: 'My monthly summary to a parent: on, waiting for the code, or off',
      access: digest,
      handler: async ({ req }) => ({ data: await s.get(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/parent-digest',
      tag,
      summary: 'Add a parent\x27s number: they get a code, and I enter it to turn the summary on',
      access: digest,
      limiter: 'otp',
      body: parentDigestBody,
      handler: async ({ req, body }) => ({ data: await s.start(authOf(req), body, requestMeta(req)) }),
    },
    {
      method: 'post',
      path: '/me/parent-digest/confirm',
      tag,
      summary: 'Enter the code the parent received',
      access: digest,
      limiter: 'otp',
      body: parentDigestConfirmBody,
      handler: async ({ req, body }) => ({ data: await s.confirm(authOf(req), body.code, requestMeta(req)) }),
    },
    {
      method: 'put',
      path: '/me/parent-digest/grades',
      tag,
      summary: 'Include my CGPA in the summary (or not)',
      access: digest,
      body: z.strictObject({ includeGrades: z.boolean() }),
      handler: async ({ req, body }) => ({ data: await s.setGrades(authOf(req), body.includeGrades) }),
    },
    {
      method: 'delete',
      path: '/me/parent-digest',
      tag,
      summary: 'Stop the summary (the number is deleted)',
      access: digest,
      handler: async ({ req }) => ({ data: await s.stop(authOf(req), requestMeta(req)) }),
    },
  ];
}
