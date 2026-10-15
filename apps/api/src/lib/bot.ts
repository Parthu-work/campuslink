import type { safeFetch } from './safe-fetch.js';

/**
 * Bot protection hook (Turnstile-style). The client sends the widget token in `X-Bot-Token`.
 * Locally the adapter is disabled and lets everything through; rate limits still apply.
 */
export interface BotProtection {
  readonly enabled: boolean;
  verify(token: string | undefined, ip: string | undefined): Promise<boolean>;
}

export const disabledBotProtection: BotProtection = {
  enabled: false,
  verify: async () => true,
};

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare Turnstile (free tier). Fails closed: an unreachable verifier means "not verified". */
export class TurnstileBotProtection implements BotProtection {
  readonly enabled = true;
  constructor(
    private readonly secret: string,
    private readonly fetcher: typeof safeFetch,
  ) {}
  async verify(token: string | undefined, ip: string | undefined): Promise<boolean> {
    if (!token || token.length > 2048) return false;
    const form = new URLSearchParams({
      secret: this.secret,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    });
    try {
      const res = await this.fetcher(TURNSTILE_VERIFY, {
        method: 'POST',
        body: form.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        allowHosts: ['challenges.cloudflare.com'],
        maxBytes: 16 * 1024,
        timeoutMs: 5000,
      });
      if (res.status !== 200) return false;
      return (JSON.parse(res.body.toString('utf8')) as { success?: unknown }).success === true;
    } catch {
      return false;
    }
  }
}
