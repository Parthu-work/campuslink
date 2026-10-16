import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import type { FilesService } from './files.service.js';

export function fileRoutes(svc: FilesService): AnyRouteSpec[] {
  return [
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
              // Chat attachments always download; images we re-encoded may render inline (sandboxed).
              'Content-Disposition':
                f.purpose === 'message_attachment' || f.mime.startsWith('video/')
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
