import { rosterSyncBody, rosterSyncUpdateBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { RosterSyncService } from './roster-sync.service.js';

const tag = 'Imports';
const IMPORT = { kind: 'permission', permission: 'imports:manage' } as const;

/** The scheduled roster sync (prompt 2, G9): set up from a completed import, approved above 5%. */
export function rosterSyncRoutes(s: RosterSyncService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/admin/roster-sync',
      tag,
      summary: 'The roster sync: its schedule, last run and any change waiting for approval',
      access: IMPORT,
      handler: async () => ({ data: await s.get() }),
    },
    {
      method: 'put',
      path: '/admin/roster-sync',
      tag,
      summary: 'Repeat a completed import of a Google Sheet or REST source, daily or weekly',
      access: IMPORT,
      limiter: 'adminWrite',
      body: rosterSyncBody,
      handler: async ({ req, body }) => ({ data: await s.save(authOf(req), body, requestMeta(req)) }),
    },
    {
      method: 'patch',
      path: '/admin/roster-sync',
      tag,
      summary: 'Pause, resume or reschedule the roster sync',
      access: IMPORT,
      body: rosterSyncUpdateBody,
      handler: async ({ req, body }) => ({ data: await s.update(authOf(req), body, requestMeta(req)) }),
    },
    {
      method: 'delete',
      path: '/admin/roster-sync',
      tag,
      summary: 'Stop syncing (imported records stay)',
      access: IMPORT,
      handler: async ({ req }) => ({ data: await s.remove(authOf(req), requestMeta(req)) }),
    },
    {
      method: 'post',
      path: '/admin/roster-sync/run',
      tag,
      summary: 'Sync now (a large change still waits for approval)',
      access: IMPORT,
      limiter: 'adminWrite',
      handler: async ({ req }) => ({ status: 202, data: await s.runNow(authOf(req), requestMeta(req)) }),
    },
    {
      method: 'post',
      path: '/admin/roster-sync/approve',
      tag,
      summary: 'Apply the change waiting for approval (exactly the rows it was made from)',
      access: IMPORT,
      limiter: 'adminWrite',
      handler: async ({ req }) => ({ data: await s.approve(authOf(req), requestMeta(req)) }),
    },
    {
      method: 'post',
      path: '/admin/roster-sync/reject',
      tag,
      summary: 'Discard the change waiting for approval',
      access: IMPORT,
      handler: async ({ req }) => ({ data: await s.reject(authOf(req), requestMeta(req)) }),
    },
  ];
}
