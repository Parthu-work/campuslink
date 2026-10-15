import { z } from 'zod';
import { importSourceBody, startImportBody, whitelistRecordBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { idParams } from '../../http/validation.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { ImportsService } from './imports.service.js';
import type { WhitelistService } from './whitelist.service.js';
import type { InvitesService } from '../verification/invites.service.js';

const IMPORT = { kind: 'permission', permission: 'imports:manage' } as const;
const listQuery = z.strictObject({
  q: z.string().trim().max(60).optional(),
  status: z.enum(['unclaimed', 'claimed']).optional(),
  cursor: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export function importRoutes(
  svc: ImportsService,
  whitelist: WhitelistService,
  invites: InvitesService,
): AnyRouteSpec[] {
  return [
    {
      method: 'post',
      path: '/admin/imports/preview/upload',
      tag: 'Imports',
      summary: 'Upload a CSV or XLSX and get headers, sample rows and a suggested column mapping',
      access: IMPORT,
      limiter: 'adminWrite',
      upload: { field: 'file', maxBytes: 5 * 1024 * 1024 },
      handler: async ({ req, file }) => ({
        status: 201,
        data: await svc.previewUpload(authOf(req).userId, file),
      }),
    },
    {
      method: 'post',
      path: '/admin/imports/preview/remote',
      tag: 'Imports',
      summary: 'Preview a Google Sheet (shared link) or a REST/JSON source',
      access: IMPORT,
      limiter: 'adminWrite',
      body: importSourceBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await svc.previewRemote(authOf(req).userId, body),
      }),
    },
    {
      method: 'post',
      path: '/admin/imports',
      tag: 'Imports',
      summary: 'Start an import (or a dry run) from a preview with a column mapping',
      access: IMPORT,
      limiter: 'adminWrite',
      body: startImportBody,
      handler: async ({ req, body }) => ({
        status: 202,
        data: await svc.start(
          authOf(req).userId,
          body.previewId,
          body.mapping,
          body.dryRun,
          requestMeta(req),
        ),
      }),
    },
    {
      method: 'get',
      path: '/admin/imports',
      tag: 'Imports',
      summary: 'Recent imports with status and counts',
      access: IMPORT,
      handler: async () => ({ data: await svc.list() }),
    },
    {
      method: 'get',
      path: '/admin/imports/:id',
      tag: 'Imports',
      summary: 'Import progress, counts and the first row errors',
      access: IMPORT,
      params: idParams,
      handler: async ({ params }) => ({ data: await svc.get(params.id) }),
    },
    {
      method: 'get',
      path: '/admin/imports/:id/errors.csv',
      tag: 'Imports',
      summary: 'Download the row-level error report (row, field, problem — no personal values)',
      access: IMPORT,
      params: idParams,
      handler: async ({ params }) => ({
        data: null,
        raw: {
          body: '﻿' + (await svc.errorReportCsv(params.id)),
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="import-${params.id}-errors.csv"`,
            'X-Content-Type-Options': 'nosniff',
          },
        },
      }),
    },
    {
      method: 'post',
      path: '/admin/imports/:id/rollback',
      tag: 'Imports',
      summary: 'Undo the most recent import (claimed records are kept)',
      access: IMPORT,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await svc.rollback(params.id, authOf(req).userId, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/whitelist',
      tag: 'Imports',
      summary: 'The verification list (contact details masked)',
      access: IMPORT,
      query: listQuery,
      handler: async ({ query }) => {
        const r = await whitelist.list(query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/admin/whitelist',
      tag: 'Imports',
      summary: 'Add one person to the verification list (optionally email them an invite)',
      access: IMPORT,
      limiter: 'adminWrite',
      body: whitelistRecordBody,
      handler: async ({ req, body }) => {
        const r = await whitelist.add(authOf(req).userId, body, requestMeta(req));
        const invited =
          body.sendInvite && body.email
            ? await invites.invite(req, authOf(req).userId, [body.email], body.kind)
            : null;
        return { status: 201, data: { ...r, invited: invited?.sent ?? 0 } };
      },
    },
    {
      method: 'delete',
      path: '/admin/whitelist/:id',
      tag: 'Imports',
      summary: 'Remove an unclaimed record from the verification list',
      access: IMPORT,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ req, params }) => {
        await whitelist.remove(authOf(req).userId, params.id, requestMeta(req));
        return { status: 204, data: null };
      },
    },
  ];
}
