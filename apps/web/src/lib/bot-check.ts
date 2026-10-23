import { BOT_CHECK_HOST_ID, botCheckConfig } from './bot-check-config';

/**
 * The human check (Cloudflare Turnstile) for writes the API protects with `bot: true`.
 *
 * Nothing loads until the API answers BOT_CHECK_FAILED: then the API client calls `getBotToken()`,
 * which loads the Turnstile script once, renders the widget into `#bot-check-host` (shown only if
 * Cloudflare needs an interaction), and resolves with a single-use token. The request is retried
 * once with `X-Bot-Token`. While bot protection is off (the default, and always locally), the
 * college config carries `botCheck: null` and none of this runs. This file itself loads only
 * then (the API client imports it on demand; the config lives in `bot-check-config.ts`).
 */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TIMEOUT_MS = 120_000;

interface TurnstileOptions {
  sitekey: string;
  appearance?: 'always' | 'execute' | 'interaction-only';
  callback: (token: string) => void;
  'error-callback': () => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
}
interface Turnstile {
  render(el: HTMLElement, opts: TurnstileOptions): string;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')));
    s.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(s);
  }).catch((e: unknown) => {
    loading = null; // allow a retry on the next protected write
    throw e;
  });
  return loading;
}

function runWidget(ts: Turnstile, siteKey: string): Promise<string> {
  const host = document.getElementById(BOT_CHECK_HOST_ID);
  if (!host) return Promise.reject(new Error('Bot check host missing'));
  return new Promise<string>((resolve, reject) => {
    const el = document.createElement('div');
    host.appendChild(el);
    host.hidden = false;
    let widgetId: string | null = null;
    const finish = (err: Error | null, token?: string) => {
      clearTimeout(timer);
      if (widgetId !== null) {
        try {
          ts.remove(widgetId);
        } catch {
          /* already gone */
        }
      }
      el.remove();
      host.hidden = host.childElementCount === 0;
      if (err) reject(err);
      else resolve(token ?? '');
    };
    const timer = setTimeout(() => finish(new Error('Bot check timed out')), TIMEOUT_MS);
    widgetId = ts.render(el, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      callback: (token) => finish(null, token),
      'error-callback': () => finish(new Error('Bot check failed')),
      'expired-callback': () => finish(new Error('Bot check expired')),
      'timeout-callback': () => finish(new Error('Bot check timed out')),
    });
  });
}

// Tokens are single use: one widget at a time, each call gets its own token.
let queue: Promise<unknown> = Promise.resolve();
export function getBotToken(): Promise<string> {
  const c = botCheckConfig();
  if (!c) return Promise.reject(new Error('Bot check is not configured'));
  const next = queue.then(async () => runWidget(await loadTurnstile(), c.siteKey));
  queue = next.catch(() => undefined);
  return next;
}
