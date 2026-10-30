import {
  ATTACHMENT_MAX_BYTES,
  attachmentFields,
  messageBody,
  messagesQuery,
  readBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { badRequest } from '../../lib/errors.js';
import type { MessagingService } from './messaging.service.js';

const SEND = { kind: 'permission', permission: 'messages:send' } as const;
const tag = 'Messaging';

export function messagingRoutes(svc: MessagingService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/conversations',
      tag,
      summary: 'My conversations (opened by accepted mentorship requests)',
      access: SEND,
      handler: async ({ req }) => ({ data: await svc.list(authOf(req)) }),
    },
    {
      method: 'get',
      path: '/conversations/unread',
      tag,
      summary: 'Unread message count (navigation badge)',
      access: SEND,
      handler: async ({ req }) => ({ data: await svc.unreadTotal(authOf(req)) }),
    },
    {
      method: 'get',
      path: '/conversations/:id',
      tag,
      summary: 'One conversation (participants only)',
      access: SEND,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await svc.get(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/conversations/:id/messages',
      tag,
      summary: 'Messages, newest page first (participants only)',
      access: SEND,
      params: idParams,
      query: messagesQuery,
      handler: async ({ req, params, query }) => {
        const r = await svc.messages(authOf(req), params.id, query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/conversations/:id/messages',
      tag,
      summary: 'Send a message (rate-limited, idempotent)',
      access: SEND,
      limiter: 'messages',
      idempotent: true,
      params: idParams,
      body: messageBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await svc.send(authOf(req), params.id, body.body),
      }),
    },
    {
      method: 'post',
      path: '/conversations/:id/attachments',
      tag,
      summary: 'Send an image or PDF (sniffed; images re-encoded; PDFs stripped of metadata and scripts)',
      access: SEND,
      limiter: 'upload',
      params: idParams,
      upload: { field: 'file', maxBytes: ATTACHMENT_MAX_BYTES },
      body: attachmentFields,
      handler: async ({ req, params, body, file }) => {
        if (!file) throw badRequest('Choose a file');
        return {
          status: 201,
          data: await svc.sendAttachment(authOf(req), params.id, file.buffer, file.originalname, body.body),
        };
      },
    },
    {
      method: 'post',
      path: '/conversations/:id/read',
      readOnlyOk: true,
      tag,
      summary: 'Read receipt up to a message',
      access: SEND,
      params: idParams,
      body: readBody,
      handler: async ({ req, params, body }) => ({
        data: await svc.markRead(authOf(req), params.id, body.messageId),
      }),
    },
  ];
}
