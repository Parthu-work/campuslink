import { z } from 'zod';
import type { AnyRouteSpec } from '../../../http/registry.js';
import { AppError } from '../../../lib/errors.js';
import { ErrorCode } from '@campuslink/shared';
import type { ChannelService } from './channel.service.js';
import { authOf } from '../../../http/request-context.js';

/**
 * Meta WhatsApp webhook (B3): the verification handshake and signed deliveries (statuses, button
 * taps, free text). Public and on any host (Meta calls one URL for every college: use the platform
 * host); the signature over the raw body is the authentication.
 */
export function channelRoutes(svc: ChannelService, verifyToken: string | undefined): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/webhooks/whatsapp',
      tag: 'Webhooks',
      summary: 'Meta webhook verification (echoes hub.challenge for the right token)',
      access: { kind: 'public' },
      scope: 'any',
      limiter: 'webhook',
      handler: async ({ req }) => {
        const q = req.query as Record<string, string | undefined>;
        if (!verifyToken || q['hub.mode'] !== 'subscribe' || q['hub.verify_token'] !== verifyToken)
          throw new AppError(403, ErrorCode.FORBIDDEN, 'Verification failed');
        const challenge = z
          .string()
          .regex(/^[\w-]{1,200}$/)
          .parse(q['hub.challenge']);
        return { data: null, raw: { body: challenge, headers: { 'content-type': 'text/plain' } } };
      },
    },
    {
      method: 'post',
      path: '/webhooks/whatsapp',
      tag: 'Webhooks',
      summary: 'Meta webhook deliveries (signed with X-Hub-Signature-256)',
      access: { kind: 'public' },
      scope: 'any',
      limiter: 'webhook',
      handler: async ({ req }) => {
        const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
        if (!svc.signatureValid(raw, req.get('x-hub-signature-256')))
          throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Bad signature');
        return { data: await svc.handleWebhook(req.body) };
      },
    },
    {
      method: 'get',
      path: '/me/whatsapp',
      tag: 'Notifications',
      summary: 'Whether WhatsApp can reach me (available, my opt-in, my number masked)',
      access: { kind: 'authenticated' },
      handler: async ({ req }) => ({ data: await svc.memberStatus(authOf(req).userId) }),
    },
    {
      method: 'get',
      path: '/admin/channels/usage',
      tag: 'Notifications',
      summary: "This month's WhatsApp messages against the college's allowance",
      access: { kind: 'permission', permission: 'tenant:settings' },
      handler: async () => ({ data: await svc.usage() }),
    },
  ];
}
