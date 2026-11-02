import { createHash, timingSafeEqual } from 'node:crypto';
import { clientErrorBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { notFound, unauthenticated } from '../../lib/errors.js';
import type { ErrorReporter } from '../../lib/error-reporter.js';
import { metrics, renderMetrics } from '../../lib/metrics.js';

const tag = 'Observability';
const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Application-side observability (build B14): browsers relay their errors here (so no reporting
 * endpoint or key ever reaches them, and the CSP stays as it is), and Prometheus scrapes `/metrics`
 * on the platform host with a bearer token.
 */
export function observabilityRoutes(
  reporter: ErrorReporter,
  metricsToken: string | undefined,
): AnyRouteSpec[] {
  return [
    {
      method: 'post',
      path: '/client-errors',
      tag,
      summary: 'A browser reports a broken screen or a failed chunk load (no personal data; rate-limited)',
      access: { kind: 'public' },
      scope: 'any',
      limiter: 'telemetry',
      readOnlyOk: true,
      body: clientErrorBody,
      handler: async ({ req, body }) => {
        metrics.clientErrors.inc({ kind: body.kind });
        await reporter.report({
          kind: 'web',
          type: body.kind,
          message: body.message,
          route: body.route,
          tenant: req.tenant?.slug,
          userHash: body.userHash,
          release: body.release,
          requestId: String(req.id ?? ''),
        });
        return { status: 202, data: { received: true } };
      },
    },
    {
      method: 'get',
      path: '/metrics',
      tag,
      summary: 'Prometheus metrics for this process (bearer token; platform host only)',
      access: { kind: 'public' },
      scope: 'platform',
      handler: async ({ req }) => {
        if (!metricsToken) throw notFound('Route');
        const given = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1] ?? '';
        if (!timingSafeEqual(digest(given), digest(metricsToken))) throw unauthenticated();
        return {
          data: null,
          raw: {
            body: Buffer.from(renderMetrics()),
            headers: {
              'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          },
        };
      },
    },
  ];
}
