import { Router } from 'express';
import type { ApiSuccess } from '@campuslink/shared';

export type ReadinessCheck = () => Promise<boolean>;

export function healthRouter(checks: Record<string, ReadinessCheck>) {
  const router = Router();

  /** Liveness: the process is up. Never touches dependencies. */
  router.get('/health', (_req, res) => {
    res.json({ ok: true, data: { status: 'ok' } } satisfies ApiSuccess<{ status: string }>);
  });

  /** Readiness: dependencies reachable. Used by load balancers before routing traffic. */
  router.get('/ready', async (_req, res) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          return [name, await check()] as const;
        } catch {
          return [name, false] as const;
        }
      }),
    );
    const results = Object.fromEntries(entries);
    const ready = entries.every(([, ok]) => ok);
    res
      .status(ready ? 200 : 503)
      .json({ ok: ready, data: { status: ready ? 'ready' : 'degraded', checks: results } });
  });

  return router;
}
