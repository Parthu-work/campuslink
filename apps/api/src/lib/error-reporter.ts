import { randomUUID } from 'node:crypto';
import type { Logger } from './logger.js';
import { safeFetch } from './safe-fetch.js';
import { metrics } from './metrics.js';

/**
 * Error reporting (build B14): unhandled API errors, failed jobs and errors browsers relay through
 * `POST /client-errors`. Adapters: `disabled`, `console` (the log) and `sentry` (the Sentry envelope
 * protocol, so Sentry, self-hosted Sentry or GlitchTip work without an SDK).
 *
 * A report carries only what helps find the bug: the error type and a scrubbed message, the request
 * id, the route pattern, the college's slug and, from browsers, a one-way hash of the member's id.
 * Never a name, an email, a phone number, a body or a query string (`scrub`).
 */
export interface ErrorReport {
  kind: 'api' | 'job' | 'web';
  type: string;
  message: string;
  requestId?: string | undefined;
  route?: string | undefined;
  tenant?: string | undefined;
  /** From browsers only: a hash of the member's id, never the id. */
  userHash?: string | undefined;
  release?: string | undefined;
}

export interface ErrorReporter {
  report(r: ErrorReport): Promise<void>;
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /\+?\d[\d\s-]{7,}\d/g;
const LONG_DIGITS = /\d{6,}/g;
const OBJECT_ID = /\b[a-f0-9]{24}\b/gi;
const TOKENISH = /\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|[A-Za-z0-9_-]{32,})\b/g;

/** Removes anything that could identify a person or leak a secret, and caps the length. */
export function scrub(s: string, max = 300): string {
  return s
    .replace(TOKENISH, '[token]')
    .replace(EMAIL, '[email]')
    .replace(OBJECT_ID, ':id')
    .replace(PHONE, '[number]')
    .replace(LONG_DIGITS, '[number]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, max);
}

/** A concrete path with its ids masked (`/events/:id`); never a query string. */
export function maskRoute(path: string): string {
  return scrub(path.split('?')[0] ?? '', 200).replace(/\/\d+(?=\/|$)/g, '/:n');
}

const clean = (r: ErrorReport): ErrorReport => ({
  kind: r.kind,
  type: scrub(r.type, 80) || 'Error',
  message: scrub(r.message),
  ...(r.requestId ? { requestId: scrub(r.requestId, 64) } : {}),
  ...(r.route ? { route: maskRoute(r.route) } : {}),
  ...(r.tenant ? { tenant: scrub(r.tenant, 64) } : {}),
  ...(r.userHash && /^[a-f0-9]{16,64}$/.test(r.userHash) ? { userHash: r.userHash } : {}),
  ...(r.release ? { release: scrub(r.release, 40) } : {}),
});

export class DisabledErrorReporter implements ErrorReporter {
  async report(r: ErrorReport): Promise<void> {
    metrics.serverErrors.inc({ kind: r.kind });
  }
}

export class ConsoleErrorReporter implements ErrorReporter {
  constructor(private readonly logger: Logger) {}
  async report(r: ErrorReport): Promise<void> {
    metrics.serverErrors.inc({ kind: r.kind });
    this.logger.warn({ report: clean(r) }, 'error report');
  }
}

/** `https://<key>@<host>/<project>` → the envelope endpoint and the public key. */
export function parseDsn(dsn: string): { endpoint: string; key: string; host: string } {
  const u = new URL(dsn);
  const project = u.pathname.replace(/^\/+|\/+$/g, '');
  if (u.protocol !== 'https:' || !u.username || !/^\d+$/.test(project))
    throw new Error('ERROR_REPORTER_DSN must look like https://<key>@<host>/<project-id>');
  const base = `${u.protocol}//${u.host}`;
  return { endpoint: `${base}/api/${project}/envelope/`, key: u.username, host: u.hostname };
}

/** The Sentry event built from a cleaned report (exported for the payload test). */
export function sentryEvent(r: ErrorReport, environment: string, now = new Date()) {
  const c = clean(r);
  return {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: now.getTime() / 1000,
    platform: c.kind === 'web' ? 'javascript' : 'node',
    level: 'error',
    logger: c.kind,
    environment,
    ...(c.release ? { release: c.release } : {}),
    exception: { values: [{ type: c.type, value: c.message }] },
    tags: {
      kind: c.kind,
      ...(c.requestId ? { request_id: c.requestId } : {}),
      ...(c.route ? { route: c.route } : {}),
      ...(c.tenant ? { tenant: c.tenant } : {}),
    },
    ...(c.userHash ? { user: { id: c.userHash } } : {}),
  };
}

type Send = typeof safeFetch;

export class SentryErrorReporter implements ErrorReporter {
  private readonly dsn: ReturnType<typeof parseDsn>;
  constructor(
    dsn: string,
    private readonly environment: string,
    private readonly logger: Logger,
    private readonly send: Send = safeFetch,
  ) {
    this.dsn = parseDsn(dsn);
  }

  async report(r: ErrorReport): Promise<void> {
    metrics.serverErrors.inc({ kind: r.kind });
    const event = sentryEvent(r, this.environment);
    const body = [
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event', content_type: 'application/json' }),
      JSON.stringify(event),
    ].join('\n');
    try {
      const res = await this.send(this.dsn.endpoint, {
        method: 'POST',
        body,
        allowHosts: [this.dsn.host],
        timeoutMs: 5_000,
        maxBytes: 64 * 1024,
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${this.dsn.key}, sentry_client=campuslink/1.0`,
        },
      });
      if (res.status >= 400) this.logger.warn({ status: res.status }, 'error report refused');
    } catch (err) {
      // Reporting must never break the request that failed; the log keeps the original error.
      this.logger.warn({ err: (err as Error).message }, 'error report not sent');
    }
  }
}

export function createErrorReporter(
  cfg: { reporter: 'disabled' | 'console' | 'sentry'; dsn?: string | undefined; environment: string },
  logger: Logger,
): ErrorReporter {
  if (cfg.reporter === 'sentry' && cfg.dsn) return new SentryErrorReporter(cfg.dsn, cfg.environment, logger);
  if (cfg.reporter === 'console') return new ConsoleErrorReporter(logger);
  return new DisabledErrorReporter();
}
