import { z } from 'zod';
import { sourceBody, sourceTestBody, sourceUpdateBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { ContentSourcesService } from './sources.service.js';

const MANAGE = { kind: 'permission', permission: 'sources:manage' } as const;
const tag = 'Content sources';

export function sourceRoutes(svc: ContentSourcesService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/admin/sources',
      tag,
      summary: 'Sources with health (last fetch, failures, items in 7 days)',
      access: MANAGE,
      handler: async () => ({ data: await svc.adminList() }),
    },
    {
      method: 'post',
      path: '/admin/sources/test',
      tag,
      summary: 'Test a feed URL (robots.txt, reachability, parsing) before adding',
      access: MANAGE,
      limiter: 'adminWrite',
      body: sourceTestBody,
      handler: async ({ body }) => ({ data: await svc.test(body.url) }),
    },
    {
      method: 'post',
      path: '/admin/sources',
      tag,
      summary: 'Add an RSS/Atom source (tested first)',
      access: MANAGE,
      limiter: 'adminWrite',
      body: sourceBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await svc.create(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/sources/starter',
      tag,
      summary: 'Curated starter feeds and their verification status',
      access: MANAGE,
      handler: async () => ({ data: await svc.starterList() }),
    },
    {
      method: 'post',
      path: '/admin/sources/starter/:key',
      tag,
      summary: 'Add a verified starter feed',
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
      path: '/admin/sources/:id',
      tag,
      summary: 'Rename, retag, change interval, pause or resume',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      body: sourceUpdateBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.update(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'delete',
      path: '/admin/sources/:id',
      tag,
      summary: 'Remove a source and its items',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await svc.remove(authOf(req), params.id, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/admin/sources/:id/fetch',
      tag,
      summary: 'Fetch now',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ params }) => ({ data: await svc.fetchNow(params.id) }),
    },
  ];
}
