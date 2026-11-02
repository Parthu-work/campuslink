import { z } from 'zod';
import { directoryQuery, objectId, profileBody, searchQuery } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import { badRequest } from '../../lib/errors.js';
import type { ProfilesService } from './profiles.service.js';
import type { AuthState } from '../../types.js';

const DIRECTORY = { kind: 'permission', permission: 'directory:read' } as const;

/** Other modules add their results to the command-palette search (posts, questions). */
export type ExtraSearch = (auth: AuthState, q: string) => Promise<Record<string, unknown>>;

export function profileRoutes(svc: ProfilesService, extraSearch?: ExtraSearch): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/profile',
      tag: 'Profiles',
      summary: 'My profile with visibility settings',
      access: { kind: 'authenticated' },
      handler: async ({ req }) => ({ data: await svc.mine(authOf(req)) }),
    },
    {
      method: 'put',
      path: '/me/profile',
      readOnlyOk: true,
      tag: 'Profiles',
      summary: 'Update my profile and who can see each field',
      access: { kind: 'authenticated' },
      body: profileBody,
      handler: async ({ req, body }) => ({ data: await svc.updateMine(authOf(req), body) }),
    },
    {
      method: 'post',
      path: '/me/avatar',
      tag: 'Profiles',
      summary: 'Upload a profile photo (re-encoded, metadata removed)',
      access: { kind: 'authenticated' },
      limiter: 'upload',
      upload: { field: 'photo', maxBytes: 3 * 1024 * 1024 },
      handler: async ({ req, file }) => {
        if (!file) throw badRequest('Choose an image');
        return { data: await svc.setAvatar(authOf(req), file.buffer, requestMeta(req)) };
      },
    },
    {
      method: 'get',
      path: '/directory',
      tag: 'Profiles',
      summary: 'Browse verified members (filters, cursor pagination)',
      access: DIRECTORY,
      limiter: 'search',
      query: directoryQuery,
      handler: async ({ req, query }) => {
        const r = await svc.directory(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'get',
      path: '/profiles/:userId',
      tag: 'Profiles',
      summary: 'A member’s profile (only the fields you are allowed to see)',
      access: DIRECTORY,
      params: z.strictObject({ userId: objectId }),
      handler: async ({ req, params }) => ({ data: await svc.view(authOf(req), params.userId) }),
    },
    {
      method: 'get',
      path: '/search',
      tag: 'Profiles',
      summary: 'Command-palette search: people, posts and questions',
      access: DIRECTORY,
      limiter: 'search',
      query: searchQuery,
      handler: async ({ req, query }) => {
        const auth = authOf(req);
        const [people, extra] = await Promise.all([
          svc.search(auth, query.q),
          extraSearch?.(auth, query.q) ?? {},
        ]);
        return { data: { ...people, ...extra } };
      },
    },
  ];
}
