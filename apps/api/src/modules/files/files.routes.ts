import { z } from 'zod';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { notFound } from '../../lib/errors.js';
import { backgroundAuth } from '../users/users.service.js';
import type { FilesService } from './files.service.js';

const tokenParams = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{20,600}\.[A-Za-z0-9_-]{43}$/) });

/** `bytes=start-end` (one range) → inclusive bounds within `size`, or null to send everything. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!m || (!m[1] && !m[2]) || size === 0) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : null;
}

export function fileRoutes(svc: FilesService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/files/:id/signed',
      tag: 'Files',
      summary: 'A five-minute link to a file you may see (for players and viewers that cannot send headers)',
      access: { kind: 'authenticated' },
      params: idParams,
      handler: async ({ req, params }) => {
        const s = await svc.signedUrl(params.id, authOf(req));
        return { data: { url: `/api/v1/files/s/${s.token}`, expiresAt: s.expiresAt } };
      },
    },
    {
      method: 'get',
      path: '/files/s/:token',
      tag: 'Files',
      summary:
        'Read a file through a signed link (access is checked again on every request; supports ranges)',
      access: { kind: 'public' },
      params: tokenParams,
      handler: async ({ req, params }) => {
        const tenant = tenantOf(req);
        const claim = svc.verifySigned(params.token, String(tenant._id));
        if (!claim) throw notFound('File');
        const viewer = await backgroundAuth(claim.userId, tenant);
        if (!viewer) throw notFound('File');
        const f = await svc.readForViewer(claim.fileId, viewer);
        if (f.purpose !== claim.purpose) throw notFound('File');
        const range = parseRange(req.get('range'), f.data.length);
        const headers: Record<string, string> = {
          'Content-Type': f.mime,
          'Accept-Ranges': 'bytes',
          'Content-Disposition': 'inline',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Cache-Control': 'private, max-age=300',
        };
        if (!range) return { data: null, raw: { body: f.data, headers } };
        return {
          status: 206,
          data: null,
          raw: {
            body: f.data.subarray(range.start, range.end + 1),
            headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${f.data.length}` },
          },
        };
      },
    },
    {
      method: 'get',
      path: '/files/:id',
      tag: 'Files',
      summary:
        'Download a file you are allowed to see (avatars, your own or reviewable ID cards, chat attachments)',
      access: { kind: 'authenticated' },
      params: idParams,
      handler: async ({ req, params }) => {
        const f = await svc.readForViewer(params.id, authOf(req));
        return {
          data: null,
          raw: {
            body: f.data,
            headers: {
              'Content-Type': f.mime,
              // Attachments, résumés and videos always download; re-encoded images may render inline (sandboxed).
              'Content-Disposition':
                f.purpose === 'message_attachment' ||
                f.mime === 'application/pdf' ||
                f.mime.startsWith('video/')
                  ? `attachment; filename="${(f.name ?? 'attachment').replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.name ?? 'attachment')}`
                  : 'inline; filename="image.webp"',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "default-src 'none'; sandbox",
              'Cross-Origin-Resource-Policy': 'same-origin',
              'Cache-Control':
                f.purpose === 'avatar' || f.purpose === 'post_media'
                  ? 'private, max-age=300'
                  : 'private, no-store',
            },
          },
        };
      },
    },
  ];
}
