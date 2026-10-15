import {
  updateMeBody,
  consentBody,
  listUsersQuery,
  updateRolesBody,
  updateCapabilitiesBody,
  updateStatusBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { idParams } from '../../http/validation.js';
import { requestMeta } from '../../lib/request-meta.js';
import { consentService } from '../consent/consent.service.js';
import type { UsersService } from './users.service.js';

export function meRoutes(svc: UsersService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me',
      tag: 'Me',
      summary: 'My account, roles and effective permissions',
      access: { kind: 'authenticated' },
      scope: 'any',
      handler: async ({ req }) => ({ data: await svc.me(authOf(req)) }),
    },
    {
      method: 'patch',
      path: '/me',
      tag: 'Me',
      summary: 'Update my name or language',
      access: { kind: 'authenticated' },
      body: updateMeBody,
      scope: 'any',
      handler: async ({ req, body }) => ({ data: await svc.updateMe(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/me/consents',
      tag: 'Me',
      summary: 'My current consent choices',
      access: { kind: 'authenticated' },
      handler: async ({ req }) => ({ data: await consentService.current(authOf(req).userId) }),
    },
    {
      method: 'post',
      path: '/me/consents',
      tag: 'Me',
      summary: 'Grant or withdraw a consent purpose',
      access: { kind: 'authenticated' },
      body: consentBody,
      handler: async ({ req, body }) => ({
        data: await consentService.set(authOf(req).userId, body.purpose, body.granted, requestMeta(req)),
      }),
    },
  ];
}

export function adminUserRoutes(svc: UsersService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/admin/users',
      tag: 'Admin',
      summary: 'List users (search, filter by role, cursor pagination)',
      access: { kind: 'permission', permission: 'users:read_admin' },
      query: listUsersQuery,
      handler: async ({ query }) => {
        const r = await svc.list(query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'patch',
      path: '/admin/users/:id/roles',
      tag: 'Admin',
      summary: 'Change a user’s roles',
      access: { kind: 'permission', permission: 'roles:assign' },
      limiter: 'adminWrite',
      params: idParams,
      body: updateRolesBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.updateRoles(authOf(req), params.id, body.roles, requestMeta(req)),
      }),
    },
    {
      method: 'patch',
      path: '/admin/users/:id/capabilities',
      tag: 'Admin',
      summary: 'Grant or revoke contributor capability',
      access: { kind: 'permission', permission: 'capabilities:grant' },
      limiter: 'adminWrite',
      params: idParams,
      body: updateCapabilitiesBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.updateCapabilities(authOf(req), params.id, body.capabilities, requestMeta(req)),
      }),
    },
    {
      method: 'patch',
      path: '/admin/users/:id/status',
      tag: 'Admin',
      summary: 'Suspend or reactivate a user',
      access: { kind: 'permission', permission: 'users:manage' },
      limiter: 'adminWrite',
      params: idParams,
      body: updateStatusBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.updateStatus(authOf(req), params.id, body.status, requestMeta(req)),
      }),
    },
  ];
}
