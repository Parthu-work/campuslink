import { z } from 'zod';
import {
  notificationPrefsBody,
  notificationsQuery,
  objectId,
  pushSubscriptionBody,
  pushUnsubscribeBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import type { NotificationsService } from './notifications.service.js';

const SELF = { kind: 'authenticated' } as const;
const tag = 'Notifications';
const markReadBody = z.union([
  z.strictObject({ all: z.literal(true) }),
  z.strictObject({ ids: z.array(objectId).min(1).max(100) }),
]);

export function notificationRoutes(svc: NotificationsService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/notifications',
      tag,
      summary: 'My notifications (90 days)',
      access: SELF,
      query: notificationsQuery,
      handler: async ({ req, query }) => {
        const r = await svc.list(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'get',
      path: '/notifications/unread-count',
      tag,
      summary: 'Unread notification count',
      access: SELF,
      handler: async ({ req }) => ({ data: await svc.unreadCount(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/notifications/read',
      tag,
      summary: 'Mark notifications as read',
      access: SELF,
      body: markReadBody,
      handler: async ({ req, body }) => ({ data: await svc.markRead(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/me/notification-preferences',
      tag,
      summary: 'Per-type channels and quiet hours',
      access: SELF,
      handler: async ({ req }) => ({ data: await svc.prefs(authOf(req).userId) }),
    },
    {
      method: 'put',
      path: '/me/notification-preferences',
      tag,
      summary: 'Update channels and quiet hours',
      access: SELF,
      body: notificationPrefsBody,
      handler: async ({ req, body }) => ({ data: await svc.updatePrefs(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/notifications/push/config',
      tag,
      summary: 'Whether web push is available, and the VAPID public key',
      access: SELF,
      handler: async () => ({ data: svc.pushConfig() }),
    },
    {
      method: 'post',
      path: '/notifications/push/subscriptions',
      tag,
      summary: 'Register this browser for push (known push services only)',
      access: SELF,
      limiter: 'push',
      body: pushSubscriptionBody,
      handler: async ({ req, body }) => ({ status: 201, data: await svc.subscribe(authOf(req), body) }),
    },
    {
      method: 'post',
      path: '/notifications/push/unsubscribe',
      tag,
      summary: 'Remove this browser’s push subscription',
      access: SELF,
      limiter: 'push',
      body: pushUnsubscribeBody,
      handler: async ({ req, body }) => ({ data: await svc.unsubscribe(authOf(req), body.endpoint) }),
    },
  ];
}
