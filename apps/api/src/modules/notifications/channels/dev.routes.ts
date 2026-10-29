import { z } from 'zod';
import { phone } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../../http/registry.js';
import { ConsoleSmsProvider, type SmsProvider } from '../../../lib/sms.js';
import { ConsoleWhatsAppProvider, type WhatsAppProvider } from '../../../lib/whatsapp.js';
import { notFound } from '../../../lib/errors.js';

/**
 * The console providers' outbox: what "would have been" sent by SMS and WhatsApp, so developers and
 * the e2e suite can read codes (as Mailpit does for email). Registered only outside production, and
 * empty unless a console provider is configured.
 */
export function devRoutes(sms: SmsProvider, whatsapp: WhatsAppProvider): AnyRouteSpec[] {
  const outboxes = [sms, whatsapp]
    .filter((p) => p instanceof ConsoleSmsProvider || p instanceof ConsoleWhatsAppProvider)
    .map((p) => (p as ConsoleSmsProvider | ConsoleWhatsAppProvider).outbox);
  return [
    {
      method: 'get',
      path: '/dev/outbox',
      tag: 'Development',
      summary: 'Messages the console SMS and WhatsApp providers kept (never in production)',
      access: { kind: 'public' },
      scope: 'any',
      query: z.strictObject({ to: phone }),
      handler: async ({ query }) => {
        if (!outboxes.length) throw notFound('Outbox');
        const items = outboxes
          .flatMap((o) => o.entries.filter((e) => e.to === query.to))
          .sort((a, b) => b.at.getTime() - a.at.getTime());
        return { data: items };
      },
    },
  ];
}
