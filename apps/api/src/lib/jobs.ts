import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { runInTenant } from './context.js';
import type { Logger } from './logger.js';

/** Every job carries the tenant it belongs to; it is set server-side from the request context. */
export interface TenantJob {
  tenantId: string;
  [key: string]: unknown;
}
export type JobHandler = (data: TenantJob, progress: (pct: number) => Promise<void>) => Promise<void>;

export interface EnqueueOptions {
  /** Deduplicates: a second enqueue with the same id is ignored while the first exists. No ':' allowed. */
  jobId?: string;
  /** Run no earlier than this many milliseconds from now. */
  delayMs?: number;
}

export interface JobQueue {
  register(name: string, handler: JobHandler): void;
  enqueue(name: string, data: TenantJob, opts?: EnqueueOptions): Promise<void>;
  /** Removes a delayed job that has not run yet (no-op when unknown). */
  cancel(name: string, jobId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Runs jobs in-process (unit tests, and as an explicit fallback). Awaitable via `drain()`.
 * Delayed jobs wait in `delayed` until `runDelayed()` (tests decide when "later" is).
 */
export class InlineJobQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private pending: Promise<void>[] = [];
  readonly delayed: { name: string; data: TenantJob; jobId?: string | undefined; dueAt: number }[] = [];
  register(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }
  async enqueue(name: string, data: TenantJob, opts: EnqueueOptions = {}) {
    if (!this.handlers.has(name)) throw new Error(`No handler for job ${name}`);
    if (opts.jobId?.includes(':')) throw new Error('Job ids cannot contain ":"');
    if (opts.delayMs && opts.delayMs > 0) {
      if (opts.jobId && this.delayed.some((j) => j.name === name && j.jobId === opts.jobId)) return;
      this.delayed.push({ name, data, jobId: opts.jobId, dueAt: Date.now() + opts.delayMs });
      return;
    }
    this.run(name, data);
  }
  private run(name: string, data: TenantJob) {
    const h = this.handlers.get(name);
    if (!h) throw new Error(`No handler for job ${name}`);
    this.pending.push(
      runInTenant(data.tenantId, () => h(data, async () => undefined)).catch(() => undefined),
    );
  }
  async cancel(name: string, jobId: string) {
    const i = this.delayed.findIndex((j) => j.name === name && j.jobId === jobId);
    if (i >= 0) this.delayed.splice(i, 1);
  }
  /** Runs delayed jobs (optionally only one kind, or only those due by `until`) and waits for them. */
  async runDelayed(filter: { name?: string; until?: number } = {}) {
    const due = this.delayed.filter(
      (j) =>
        (!filter.name || j.name === filter.name) && (filter.until === undefined || j.dueAt <= filter.until),
    );
    for (const j of due) this.delayed.splice(this.delayed.indexOf(j), 1);
    for (const j of due) this.run(j.name, j.data);
    await this.drain();
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
  async enqueue(name: string, data: TenantJob, opts: EnqueueOptions = {}) {
    const q = this.queues.get(name);
    if (!q) throw new Error(`Unknown queue ${name}`);
    await q.add(name, data, {
      ...(opts.jobId ? { jobId: opts.jobId } : {}),
      ...(opts.delayMs && opts.delayMs > 0 ? { delay: Math.round(opts.delayMs) } : {}),
    });
  }
  async cancel(name: string, jobId: string) {
    const job = await this.queues.get(name)?.getJob(jobId);
    // Only waiting/delayed jobs are removed; an active job finishes and checks its own preconditions.
    if (job && (await job.isDelayed())) await job.remove();
  }
  async close() {
    await Promise.all([
      ...this.workers.map((w) => w.close()),
      ...[...this.queues.values()].map((q) => q.close()),
    ]);
  }
}
