import { ConsoleOutbox } from './sms.js';
import type { safeFetch as SafeFetch } from './safe-fetch.js';

/**
 * WhatsApp channel (decision D3: the Meta WhatsApp Cloud API directly, behind this interface).
 * Every business-initiated message is an approved template; codes use an authentication template
 * with a copy-code button. Locally the provider is `disabled` or `console`.
 */
export interface WhatsAppProvider {
  readonly available: boolean;
  sendTemplate(
    to: string,
    name: string,
    lang: string,
    params: string[],
    buttons?: { payload: string }[],
  ): Promise<{ messageId: string }>;
  sendAuthCode(to: string, code: string, lang: string): Promise<{ messageId: string }>;
  /** A free-form reply inside the 24-hour customer-service window (the fixed auto-reply only). */
  sendText(to: string, body: string): Promise<{ messageId: string }>;
}

export class DisabledWhatsAppProvider implements WhatsAppProvider {
  readonly available = false;
  async sendTemplate(): Promise<{ messageId: string }> {
    throw new Error('WhatsApp is not configured for this deployment');
  }
  async sendAuthCode(): Promise<{ messageId: string }> {
    throw new Error('WhatsApp is not configured for this deployment');
  }
  async sendText(): Promise<{ messageId: string }> {
    throw new Error('WhatsApp is not configured for this deployment');
  }
}

export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  readonly available = true;
  constructor(readonly outbox = new ConsoleOutbox()) {}
  async sendTemplate(
    to: string,
    name: string,
    lang: string,
    params: string[],
    buttons?: { payload: string }[],
  ) {
    const e = this.outbox.add({
      channel: 'whatsapp',
      to,
      template: name,
      lang,
      params: [...params, ...(buttons ?? []).map((b) => `button:${b.payload}`)],
    });
    return { messageId: e.id };
  }
  async sendAuthCode(to: string, code: string, lang: string) {
    const e = this.outbox.add({ channel: 'whatsapp', to, template: 'auth_code', lang, params: [code] });
    return { messageId: e.id };
  }
  async sendText(to: string, body: string) {
    const e = this.outbox.add({ channel: 'whatsapp', to, template: 'text', lang: null, params: [body] });
    return { messageId: e.id };
  }
}

export interface CloudConfig {
  token: string;
  phoneNumberId: string;
  graphVersion: string;
  /** The approved authentication template (copy-code button). */
  authTemplate: string;
}

/**
 * Meta WhatsApp Cloud API (decision D3: no reseller). Every call goes through the SSRF-safe fetcher
 * to graph.facebook.com only. Numbers are sent as digits without the plus sign.
 */
export class CloudWhatsAppProvider implements WhatsAppProvider {
  readonly available = true;
  constructor(
    private readonly c: CloudConfig,
    private readonly fetcher: typeof SafeFetch,
  ) {}

  private async post(body: Record<string, unknown>): Promise<{ messageId: string }> {
    const r = await this.fetcher(
      `https://graph.facebook.com/${this.c.graphVersion}/${this.c.phoneNumberId}/messages`,
      {
        method: 'POST',
        allowHosts: ['graph.facebook.com'],
        timeoutMs: 10_000,
        maxBytes: 64 * 1024,
        headers: { authorization: `Bearer ${this.c.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...body }),
      },
    );
    const json = JSON.parse(r.body.toString('utf8') || '{}') as {
      messages?: { id?: string }[];
      error?: { code?: number; message?: string };
    };
    const id = json.messages?.[0]?.id;
    if (r.status >= 300 || !id)
      throw new Error(
        `WhatsApp send failed (${r.status}${json.error?.code ? `, code ${json.error.code}` : ''})`,
      );
    return { messageId: id };
  }

  sendTemplate(
    to: string,
    name: string,
    lang: string,
    params: string[],
    buttons: { payload: string }[] = [],
  ) {
    return this.post({
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name,
        language: { code: lang },
        components: [
          ...(params.length
            ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
            : []),
          ...buttons.map((b, i) => ({
            type: 'button',
            sub_type: 'quick_reply',
            index: String(i),
            parameters: [{ type: 'payload', payload: b.payload }],
          })),
        ],
      },
    });
  }

  /** Authentication template: the code in the body and in the copy-code button. */
  sendAuthCode(to: string, code: string, lang: string) {
    return this.post({
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: this.c.authTemplate,
        language: { code: lang },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    });
  }

  sendText(to: string, body: string) {
    return this.post({ to: to.replace(/^\+/, ''), type: 'text', text: { preview_url: false, body } });
  }
}
