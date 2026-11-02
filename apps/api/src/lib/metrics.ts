/**
 * Application metrics in the Prometheus text format (build B14), served at `GET /metrics` behind a
 * token. In-process counters only: each API and worker process exposes its own, and Prometheus
 * sums them. Labels never carry a member, a college or free text: only route patterns, methods,
 * status codes, job names, channels and token kinds, so the label sets stay small and anonymous.
 */
type Labels = Record<string, string>;

class Counter {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    if (!(by > 0)) return;
    const picked = Object.fromEntries(this.labelNames.map((k) => [k, labels[k] ?? '']));
    const key = JSON.stringify(picked);
    const cur = this.values.get(key);
    if (cur) cur.value += by;
    else this.values.set(key, { labels: picked, value: by });
  }

  get(labels: Labels = {}): number {
    const picked = Object.fromEntries(this.labelNames.map((k) => [k, labels[k] ?? '']));
    return this.values.get(JSON.stringify(picked))?.value ?? 0;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      const l = Object.entries(labels)
        .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
        .join(',');
      lines.push(`${this.name}${l ? `{${l}}` : ''} ${value}`);
    }
    return lines.join('\n');
  }

  reset(): void {
    this.values.clear();
  }
}

const escapeLabel = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export const metrics = {
  httpRequests: new Counter(
    'campuslink_http_requests_total',
    'API requests by route pattern, method and status',
    ['route', 'method', 'status'],
  ),
  jobs: new Counter('campuslink_jobs_total', 'Background jobs by name and outcome', ['job', 'outcome']),
  otpSends: new Counter('campuslink_otp_sends_total', 'One-time codes sent, by channel', ['channel']),
  whatsappFailures: new Counter(
    'campuslink_whatsapp_delivery_failures_total',
    'WhatsApp messages Meta reported as failed',
    [],
  ),
  aiTokens: new Counter('campuslink_ai_tokens_total', 'AI tokens used, by kind and direction', [
    'kind',
    'direction',
  ]),
  clientErrors: new Counter(
    'campuslink_client_errors_total',
    'Errors browsers reported (screens that broke, failed chunk loads)',
    ['kind'],
  ),
  serverErrors: new Counter('campuslink_server_errors_total', 'Unhandled API and job errors', ['kind']),
} as const;

/** The whole registry, in the Prometheus text exposition format (version 0.0.4). */
export function renderMetrics(): string {
  return `${Object.values(metrics)
    .map((c) => c.render())
    .join('\n')}\n`;
}

/** Tests only. */
export function resetMetrics(): void {
  for (const c of Object.values(metrics)) c.reset();
}

/** A request's route pattern (`/events/:id/rsvp`), never its concrete path (which holds ids). */
export function routePattern(req: { route?: { path?: unknown } }): string {
  const p = req.route?.path;
  return typeof p === 'string' ? p : 'unmatched';
}
