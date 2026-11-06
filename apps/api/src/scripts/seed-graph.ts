import type { Env } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { MemoryMailProvider } from '../lib/mailer.js';
import { InlineJobQueue } from '../lib/jobs.js';
import { storageFromEnv } from '../lib/storage-factory.js';
import { createApp } from '../app.js';
import type { GraphService } from '../modules/graph/graph.service.js';

/**
 * Prompt 2, G10: builds the demo colleges' Placement Graph from their seeded (DEMO) records, as the
 * nightly job would, so company pages have something to show straight after `pnpm seed`.
 */
export function graphSeeder(env: Env) {
  const app = createApp({
    env,
    logger: createLogger('silent'),
    readiness: {},
    mailer: new MemoryMailProvider(),
    jobs: new InlineJobQueue(),
    storage: storageFromEnv(env).storage,
  });
  const services = app.locals.services as { graph: GraphService };
  /** Builds the graph of the college in context (call inside its tenant context). */
  return async function seedGraph() {
    await services.graph.run();
  };
}
