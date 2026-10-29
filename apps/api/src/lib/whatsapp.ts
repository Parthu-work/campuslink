import { ConsoleOutbox } from './sms.js';

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
}

export class DisabledWhatsAppProvider implements WhatsAppProvider {
  readonly available = false;
  async sendTemplate(): Promise<{ messageId: string }> {
    throw new Error('WhatsApp is not configured for this deployment');
  }
  async sendAuthCode(): Promise<{ messageId: string }> {
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
}
