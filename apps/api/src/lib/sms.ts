import type { safeFetch as SafeFetch } from './safe-fetch.js';

/**
 * Swappable SMS adapter (CLAUDE.md: providers behind interfaces). India's DLT rules allow only
 * registered templates, so the only way to send is a registered template id plus its variables
 * (`modules/notifications/channels/sms-templates.ts`). There is no free SMS gateway: locally the
 * provider is `disabled` or `console` (development and tests; refused in production).
 */
export interface SmsProvider {
  readonly available: boolean;
  sendTemplate(to: string, dltTemplateId: string, vars: string[]): Promise<{ messageId: string }>;
}

export class DisabledSmsProvider implements SmsProvider {
  readonly available = false;
  async sendTemplate(): Promise<{ messageId: string }> {
    throw new Error('SMS is not configured for this deployment');
  }
}

/** One message a console provider "sent" (development and tests only). */
export interface OutboxEntry {
  id: string;
  channel: 'sms' | 'whatsapp';
  to: string;
  /** Template name (WhatsApp) or DLT template id (SMS). */
  template: string;
  lang: string | null;
  params: string[];
  at: Date;
}

/** Keeps the last 200 messages in memory; `GET /dev/outbox` shows them outside production. */
export class ConsoleOutbox {
  readonly entries: OutboxEntry[] = [];
  private seq = 0;
  add(e: Omit<OutboxEntry, 'id' | 'at'>): OutboxEntry {
    const entry = { ...e, id: `console-${e.channel}-${++this.seq}`, at: new Date() };
    this.entries.push(entry);
    if (this.entries.length > 200) this.entries.shift();
    return entry;
  }
  /** The newest message to `to` (E.164). */
  lastTo(to: string): OutboxEntry | undefined {
    return this.entries.findLast((e) => e.to === to);
  }
}

export class ConsoleSmsProvider implements SmsProvider {
  readonly available = true;
  constructor(readonly outbox = new ConsoleOutbox()) {}
  async sendTemplate(to: string, dltTemplateId: string, vars: string[]) {
    const e = this.outbox.add({ channel: 'sms', to, template: dltTemplateId, lang: null, params: vars });
    return { messageId: e.id };
  }
}

export interface Msg91Config {
  authKey: string;
  /** The DLT-approved six-letter header. */
  senderId: string;
  /** The principal entity id from the DLT registration. */
  dltEntityId: string;
}

/**
 * MSG91 (decision D4), through its v5 Flow API: each template is created in the MSG91 panel with the
 * DLT template id, sender and entity mapped to it, and its id is what SMS_DLT_TEMPLATE_IDS holds.
 * Variables are sent as var1, var2, … in the order of the template's {#var#} placeholders.
 * Built from MSG91's published API description; check it against a live account before use
 * (docs/sms-templates.md).
 */
export class Msg91SmsProvider implements SmsProvider {
  readonly available = true;
  constructor(
    private readonly c: Msg91Config,
    private readonly fetcher: typeof SafeFetch,
  ) {}

  async sendTemplate(to: string, templateId: string, vars: string[]) {
    const recipient: Record<string, string> = { mobiles: to.replace(/^\+/, '') };
    vars.forEach((v, i) => (recipient[`var${i + 1}`] = v));
    const r = await this.fetcher('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      allowHosts: ['control.msg91.com'],
      timeoutMs: 10_000,
      maxBytes: 16 * 1024,
      headers: { authkey: this.c.authKey, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [recipient] }),
    });
    const json = JSON.parse(r.body.toString('utf8') || '{}') as { type?: string; message?: string };
    if (r.status >= 300 || json.type !== 'success' || !json.message)
      throw new Error(`SMS send failed (${r.status})`);
    return { messageId: json.message };
  }
}
