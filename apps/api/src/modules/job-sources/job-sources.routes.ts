import { z } from 'zod';
import { jobSourceBody, jobSourceUpdateBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { JobSourcesService } from './job-sources.service.js';

const MANAGE = { kind: 'permission', permission: 'jobs:sources' } as const;
const tag = 'Job sources';

export function jobSourceRoutes(svc: JobSourcesService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/admin/job-sources',
      tag,
      summary: 'Job sources with health (last fetch, failures, open jobs)',
      access: MANAGE,
      handler: async () => ({ data: await svc.list() }),
    },
    {
      method: 'post',
      path: '/admin/job-sources/test',
      tag,
      summary: 'Test an ATS board, Adzuna search or RSS feed before adding',
      access: MANAGE,
      limiter: 'adminWrite',
      body: jobSourceBody,
      handler: async ({ body }) => ({ data: await svc.test(body) }),
    },
    {
      method: 'post',
      path: '/admin/job-sources',
      tag,
      summary: 'Add a job source (tested first)',
      access: MANAGE,
      limiter: 'adminWrite',
      body: jobSourceBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await svc.create(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/job-sources/starter',
      tag,
      summary: 'Curated public job boards and their verification status',
      access: MANAGE,
      handler: async () => ({ data: await svc.starterList() }),
    },
    {
      method: 'post',
      path: '/admin/job-sources/starter/:key',
      tag,
      summary: 'Add a verified starter board',
      access: MANAGE,
      limiter: 'adminWrite',
      params: z.strictObject({ key: z.string().regex(/^[a-z0-9-]{2,60}$/) }),
      handler: async ({ req, params }) => ({
        status: 201,
        data: await svc.addStarter(authOf(req), params.key, requestMeta(req)),
      }),
    },
    {
      method: 'patch',
      path: '/admin/job-sources/:id',
      tag,
      summary: 'Rename, pause, resume or change interval',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      body: jobSourceUpdateBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.update(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'delete',
      path: '/admin/job-sources/:id',
      tag,
      summary: 'Remove a source (its open jobs close)',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await svc.remove(authOf(req), params.id, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/admin/job-sources/:id/fetch',
      tag,
      summary: 'Fetch now',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ params }) => ({ data: await svc.fetchNow(params.id) }),
    },
  ];
}
