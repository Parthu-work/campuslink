import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { runInTenant } from './context.js';
import type { Logger } from './logger.js';

/** Every job carries the tenant it belongs to; it is set server-side from the request context. */
export interface TenantJob {
  tenantId: string;
  [key: string]: unknown;
}
export type JobHandler = (data: TenantJob, progress: (pct: number) => Promise<void>) => Promise<void>;

export interface JobQueue {
  register(name: string, handler: JobHandler): void;
  enqueue(name: string, data: TenantJob, opts?: { jobId?: string }): Promise<void>;
  close(): Promise<void>;
}

/** Runs jobs in-process (unit tests, and as an explicit fallback). Awaitable via `drain()`. */
export class InlineJobQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private pending: Promise<void>[] = [];
  register(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }
  async enqueue(name: string, data: TenantJob) {
    const h = this.handlers.get(name);
    if (!h) throw new Error(`No handler for job ${name}`);
    this.pending.push(
      runInTenant(data.tenantId, () => h(data, async () => undefined)).catch(() => undefined),
    );
  }
  async drain() {
    while (this.pending.length) await Promise.all(this.pending.splice(0));
  }
  async close() {
    await this.drain();
  }
}

/** BullMQ-backed queue; each job runs inside its tenant's context. */
export class BullJobQueue implements JobQueue {
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  constructor(
    private readonly connection: ConnectionOptions,
    private readonly logger: Logger,
    private readonly runWorkers = true,
  ) {}
  register(name: string, handler: JobHandler) {
    this.queues.set(
      name,
      new Queue(name, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 500,
          removeOnFail: 1000,
        },
      }),
    );
    if (!this.runWorkers) return;
    const worker = new Worker(
      name,
      async (job) => {
        const data = job.data as TenantJob;
        await runInTenant(data.tenantId, () => handler(data, (pct) => job.updateProgress(pct)));
      },
      { connection: this.connection, concurrency: 2 },
    );
    worker.on('failed', (job, err) =>
      this.logger.error({ job: job?.name, jobId: job?.id, err: err.message }, 'job failed'),
    );
    this.workers.push(worker);
  }
  async enqueue(name: string, data: TenantJob, opts: { jobId?: string } = {}) {
    const q = this.queues.get(name);
    if (!q) throw new Error(`Unknown queue ${name}`);
    await q.add(name, data, opts.jobId ? { jobId: opts.jobId } : {});
  }
  async close() {
    await Promise.all([
      ...this.workers.map((w) => w.close()),
      ...[...this.queues.values()].map((q) => q.close()),
    ]);
  }
}
