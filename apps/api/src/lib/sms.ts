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
