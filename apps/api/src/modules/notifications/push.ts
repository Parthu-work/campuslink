import webpush from 'web-push';
import { isPushServiceHost, PUSH_SERVICE_HOSTS } from '@campuslink/shared';
import type { safeFetch } from '../../lib/safe-fetch.js';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export type PushResult = 'ok' | 'gone' | 'failed';

export interface PushSender {
  readonly enabled: boolean;
  readonly publicKey: string | null;
  send(target: PushTarget, payload: string): Promise<PushResult>;
}

/**
 * Web push with VAPID. `web-push` only builds the encrypted request; delivery goes through the
 * SSRF-safe fetcher and only to known browser push services (endpoints are client-supplied URLs).
 */
export class WebPushSender implements PushSender {
  readonly enabled: boolean;
  readonly publicKey: string | null;
  constructor(
    private readonly vapid: { publicKey: string; privateKey: string; subject: string } | null,
    private readonly fetcher: typeof safeFetch,
  ) {
    this.enabled = !!vapid;
    this.publicKey = vapid?.publicKey ?? null;
  }

  async send(target: PushTarget, payload: string): Promise<PushResult> {
    if (!this.vapid) return 'failed';
    let host: string;
    try {
      host = new URL(target.endpoint).hostname;
    } catch {
      return 'gone';
    }
    if (!isPushServiceHost(host)) return 'gone';
    const req = webpush.generateRequestDetails(target, payload, {
      vapidDetails: this.vapid,
      TTL: 3600,
      urgency: 'normal',
      contentEncoding: 'aes128gcm',
    });
    const headers = Object.fromEntries(
      Object.entries(req.headers)
        .filter(([k]) => k.toLowerCase() !== 'content-length')
        .map(([k, v]) => [k, String(v)]),
    );
    try {
      const res = await this.fetcher(req.endpoint, {
        method: 'POST',
        headers,
        ...(req.body ? { body: req.body } : {}),
        allowHosts: PUSH_SERVICE_HOSTS,
        timeoutMs: 5000,
        maxBytes: 16 * 1024,
      });
      if (res.status >= 200 && res.status < 300) return 'ok';
      return res.status === 404 || res.status === 410 ? 'gone' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
