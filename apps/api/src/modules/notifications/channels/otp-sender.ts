import type { OtpChannel } from '@campuslink/shared';
import type { SmsProvider } from '../../../lib/sms.js';
import type { WhatsAppProvider } from '../../../lib/whatsapp.js';
import type { Logger } from '../../../lib/logger.js';
import type { SmsTemplateKey } from './sms-templates.js';

export interface OtpSenderDeps {
  whatsapp: WhatsAppProvider;
  sms: SmsProvider;
  /** Registered DLT template id for a key (the key itself for the console provider). */
  smsTemplateId: (key: SmsTemplateKey) => string;
  logger: Logger;
}

/**
 * Sends one-time codes to a phone: WhatsApp (an authentication template with a copy-code button)
 * when it is available, allowed for the college and the member has not chosen SMS; otherwise SMS.
 * A WhatsApp failure falls back to SMS once. Returns the channel that carried the code.
 */
export class OtpSender {
  constructor(private readonly d: OtpSenderDeps) {}

  /** Some channel can carry codes at all. */
  get available(): boolean {
    return this.d.whatsapp.available || this.d.sms.available;
  }

  /** The channel a code would go by. */
  channelFor(preferred: OtpChannel | undefined, whatsappAllowed: boolean): OtpChannel | null {
    const wa = this.d.whatsapp.available && whatsappAllowed;
    if (preferred === 'sms' && this.d.sms.available) return 'sms';
    if (wa) return 'whatsapp';
    return this.d.sms.available ? 'sms' : null;
  }

  async send(
    phone: string,
    code: string,
    lang: string,
    preferred: OtpChannel | undefined,
    whatsappAllowed: boolean,
  ): Promise<OtpChannel> {
    const channel = this.channelFor(preferred, whatsappAllowed);
    if (!channel) throw new Error('No channel can deliver codes');
    if (channel === 'whatsapp') {
      try {
        await this.d.whatsapp.sendAuthCode(phone, code, lang);
        return 'whatsapp';
      } catch (err) {
        if (!this.d.sms.available) throw err;
        this.d.logger.warn({ err }, 'whatsapp code failed; falling back to sms');
      }
    }
    await this.d.sms.sendTemplate(phone, this.d.smsTemplateId('otp'), [code]);
    return 'sms';
  }
}
