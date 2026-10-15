/** Swappable SMS adapter. No free SMS gateway exists, so locally this is disabled and says so. */
export interface SmsProvider {
  readonly available: boolean;
  send(to: string, text: string): Promise<void>;
}
export class DisabledSmsProvider implements SmsProvider {
  readonly available = false;
  async send(): Promise<void> {
    throw new Error('SMS is not configured for this deployment');
  }
}
