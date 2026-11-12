import { createHash } from 'node:crypto';
import type { Feature } from '@campuslink/shared';
import type { Logger } from './logger.js';
import type { JobQueue } from './jobs.js';
import { networkEnabled } from './network-switch.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { findTenantById, type TenantRecord } from '../modules/tenants/tenant.cache.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { BillingService } from '../modules/billing/billing.service.js';
import { DigestService } from '../modules/notifications/digest.service.js';
import { ParentDigestService } from '../modules/notifications/parent-digest.service.js';
import { NextStepService } from '../modules/next-step/next-step.service.js';
import { PeersService } from '../modules/peers/peers.service.js';
import { RosterSyncService } from '../modules/imports/roster-sync.service.js';
import { GraphService } from '../modules/graph/graph.service.js';
import { CopilotIndexService } from '../modules/copilot/copilot-index.service.js';
import { NetworkService } from '../modules/network/network.service.js';
import { GuardianService } from '../modules/verification/guardian.service.js';
import { RoadmapsService } from '../modules/roadmaps/roadmaps.service.js';
import { ContentSourcesService } from '../modules/content-sources/sources.service.js';
import { JobSourcesService } from '../modules/job-sources/job-sources.service.js';
import { JobsService } from '../modules/jobs/jobs.service.js';

/**
 * The worker's one scheduler (prompt 4, P5). It replaces the separate timers that lived in
 * `server.ts`: one timer wakes every few seconds, looks at a table of tasks, and runs those whose
 * next slot has come. A task runs at most once per slot across every worker (a lock in Redis keyed
 * by task and slot), and each task starts a little after its slot begins (a fixed jitter per task,
 * so the hourly tasks do not all hit the database in the same second).
 *
 * Tasks only queue work; the work itself runs as jobs (`lib/jobs.ts`). A task that concerns
 * colleges queues nothing for a college with nothing to do (see `collegeTasks`), which is what
 * keeps an idle deployment at near-zero work and at zero paid calls.
 */
export interface ScheduledTask {
  name: string;
  everyMs: number;
  run: (now: Date) => Promise<unknown>;
}

/** One run per task and slot across processes. Redis in production; memory for a single process. */
export interface SchedulerLock {
  acquire(key: string, ttlMs: number): Promise<boolean>;
}

export class MemorySchedulerLock implements SchedulerLock {
  private readonly held = new Set<string>();
  async acquire(key: string) {
    if (this.held.has(key)) return false;
    this.held.add(key);
    // Old slots never come back; keep the set small.
    if (this.held.size > 5000) for (const k of [...this.held].slice(0, 2500)) this.held.delete(k);
    return true;
  }
}

/** `SET key 1 PX ttl NX`: the first worker to ask owns the slot. */
export class RedisSchedulerLock implements SchedulerLock {
  constructor(
    private readonly redis: {
      set(key: string, value: string, px: 'PX', ttl: number, nx: 'NX'): Promise<string | null>;
    },
  ) {}
  async acquire(key: string, ttlMs: number) {
    return (await this.redis.set(`sched:${key}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
  }
}

/** A task's fixed delay after its slot starts: at most a quarter of its cadence, and two minutes. */
export function jitterMs(name: string, everyMs: number): number {
  const span = Math.min(Math.floor(everyMs / 4), 120_000);
  if (span <= 0) return 0;
  return createHash('sha1').update(name).digest().readUInt32BE(0) % span;
}

export interface SchedulerOptions {
  lock: SchedulerLock;
  logger: Pick<Logger, 'error'>;
  /** How often the one timer wakes (the shortest cadence a task can keep). */
  tickMs?: number;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** The last slot each task ran in (or was found taken by another worker). */
  private readonly lastSlot = new Map<string, number>();
  private readonly tickMs: number;

  constructor(
    private readonly tasks: readonly ScheduledTask[],
    private readonly opts: SchedulerOptions,
  ) {
    this.tickMs = opts.tickMs ?? 15_000;
    const names = new Set(tasks.map((t) => t.name));
    if (names.size !== tasks.length) throw new Error('Scheduled task names must be unique');
    for (const t of tasks)
      if (t.everyMs < this.tickMs)
        throw new Error(`Task ${t.name} is more frequent than the scheduler's tick`);
  }

  /** The one timer. Unref'd: it never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(new Date()), this.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Which tasks are due at `now` (their slot has begun, their jitter has passed, not yet run in it). */
  due(now: Date): ScheduledTask[] {
    const at = now.getTime();
    return this.tasks.filter((t) => {
      const slot = Math.floor(at / t.everyMs);
      return this.lastSlot.get(t.name) !== slot && at >= slot * t.everyMs + jitterMs(t.name, t.everyMs);
    });
  }

  /**
   * Runs every due task once, one after another. A failing task is logged by name and never stops
   * the others; a tick that is still running is not started again.
   */
  async tick(now: Date): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    const ran: string[] = [];
    try {
      for (const t of this.due(now)) {
        const slot = Math.floor(now.getTime() / t.everyMs);
        this.lastSlot.set(t.name, slot);
        try {
          // The lock outlives the slot by a minute, so a clock a little behind cannot run it again.
          if (!(await this.opts.lock.acquire(`${t.name}:${slot}`, t.everyMs + 60_000))) continue;
          await t.run(now);
          ran.push(t.name);
        } catch (err) {
          this.opts.logger.error({ err, task: t.name }, 'scheduled task failed');
        }
      }
    } finally {
      this.running = false;
    }
    return ran;
  }
}

// ── Which colleges have work due ─────────────────────────────

const DAY = 86_400_000;

/** Active colleges as the tenant cache resolves them (plan and switches applied). */
async function activeColleges(): Promise<TenantRecord[]> {
  const ids = await TenantModel.find({ kind: 'college', status: 'active' }).select('_id').lean();
  const out: TenantRecord[] = [];
  for (const t of ids) {
    const record = await findTenantById(t._id);
    if (record?.kind === 'college' && record.status === 'active') out.push(record);
  }
  return out;
}

const ids = (rows: TenantRecord[], keep: (t: TenantRecord) => boolean = () => true) =>
  new Set(rows.filter(keep).map((t) => String(t._id)));
const both = (a: ReadonlySet<string>, b: ReadonlySet<string>) => new Set([...a].filter((x) => b.has(x)));
const either = (a: ReadonlySet<string>, b: ReadonlySet<string>) => new Set([...a, ...b]);
const has = (feature: Feature) => (t: TenantRecord) => t.features[feature];
const writable = (t: TenantRecord) => !t.billing?.readOnlyAt;
const usedSince = (now: Date, days: number) =>
  AuthService.activeTenantIds(new Date(now.getTime() - days * DAY));

/**
 * The per-college timers, each narrowed to the colleges with work due (prompt 4, P5). A college
 * nobody has used, with nothing configured, gets no job from any of them:
 *
 * - billing: an open invoice, a read-only state, seats not counted for a week, or members active
 *   in the last two days (so an active college still gets its nightly seat count);
 * - digest: at least one member opted in;
 * - next step, senior buddy: members signed in during the last 30 days (and the feature on);
 * - parent digest: at least one confirmed parent;
 * - roster sync: a source configured and on, and the college not read-only (a sync writes);
 * - placement graph, copilot index: members active in the last 7 days (their inputs only change
 *   when somebody writes);
 * - network: the platform switch on and one of the college's network switches on.
 */
export const collegeTasks = {
  async billing(jobs: JobQueue, now = new Date()) {
    const only = either(await BillingService.dueTenantIds(now), await usedSince(now, 2));
    return BillingService.enqueueDaily(jobs, now, only);
  },
  async digest(jobs: JobQueue, now = new Date()) {
    return DigestService.enqueueWeekly(jobs, now, await DigestService.optedInTenantIds());
  },
  async nextStep(jobs: JobQueue, now = new Date()) {
    return NextStepService.enqueueWeekly(jobs, now, await usedSince(now, 30));
  },
  async buddy(jobs: JobQueue, now = new Date()) {
    const on = ids(await activeColleges(), has('peerMentors'));
    return PeersService.enqueueDaily(jobs, now, both(on, await usedSince(now, 30)));
  },
  async parentDigest(jobs: JobQueue, now = new Date()) {
    return ParentDigestService.enqueueMonthly(jobs, now, await ParentDigestService.activeTenantIds());
  },
  async rosterSync(jobs: JobQueue, now = new Date()) {
    const open = ids(await activeColleges(), writable);
    return RosterSyncService.enqueueDue(jobs, now, both(open, await RosterSyncService.enabledTenantIds()));
  },
  async graph(jobs: JobQueue, now = new Date()) {
    const on = ids(await activeColleges(), has('placements'));
    return GraphService.enqueueNightly(jobs, now, both(on, await usedSince(now, 7)));
  },
  async copilot(jobs: JobQueue, now = new Date()) {
    return CopilotIndexService.enqueueDaily(jobs, now, await usedSince(now, 7));
  },
  async network(jobs: JobQueue, now = new Date()) {
    if (!networkEnabled()) return 0;
    const on = ids(
      await activeColleges(),
      (t) => !!(t.network?.alumniDiscovery || t.network?.employerAccess || t.network?.credentials),
    );
    return on.size ? NetworkService.enqueueReconcile(jobs, now, on) : 0;
  },
};

export interface ScheduleDeps {
  jobs: JobQueue;
  /** The six-hourly retention sweep (files, erasure, product events, inactive accounts). */
  retention: () => Promise<unknown>;
  /** `INGESTION_ENABLED`: news and job sources, and job alerts. */
  ingestion: boolean;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** Every timed task of the worker, with its cadence. `server.ts` runs this table, nothing else. */
export function scheduledTasks({ jobs, retention, ingestion }: ScheduleDeps): ScheduledTask[] {
  const tasks: ScheduledTask[] = [
    { name: 'retention', everyMs: 6 * HOUR, run: () => retention() },
    // Weekly roadmap goal checks: queue the due ones (job ids dedupe).
    {
      name: 'roadmap-nudges',
      everyMs: 5 * MINUTE,
      run: (now) => RoadmapsService.enqueueDueNudges(jobs, now),
    },
    // Members who turned 18 (B2): one run per college that has any.
    { name: 'adulthood', everyMs: HOUR, run: (now) => GuardianService.enqueueDue(jobs, now) },
    // Billing (B10): one daily run per college (job ids dedupe per day).
    { name: 'billing', everyMs: HOUR, run: (now) => collegeTasks.billing(jobs, now) },
    // The weekly digest (prompt 1b, R8): one run per college a week, from Monday 09:00 IST.
    { name: 'digest', everyMs: HOUR, run: (now) => collegeTasks.digest(jobs, now) },
    // The weekly Next Step (prompt 2, G7): one run per college an ISO week, from Monday 19:00 IST.
    { name: 'next-step', everyMs: HOUR, run: (now) => collegeTasks.nextStep(jobs, now) },
    // Senior Buddy matching (prompt 2, G7): one run per college a day.
    { name: 'senior-buddy', everyMs: HOUR, run: (now) => collegeTasks.buddy(jobs, now) },
    // The parent digest (prompt 2, G8): one run per college a month, from the 1st (IST).
    { name: 'parent-digest', everyMs: HOUR, run: (now) => collegeTasks.parentDigest(jobs, now) },
    // The roster sync (prompt 2, G9): one run per college a day, from 02:00 IST.
    { name: 'roster-sync', everyMs: HOUR, run: (now) => collegeTasks.rosterSync(jobs, now) },
    // The Placement Graph (prompt 2, G10): one run per college a day, from 02:00 IST.
    { name: 'placement-graph', everyMs: HOUR, run: (now) => collegeTasks.graph(jobs, now) },
    // The Career Copilot's index (prompt 2, G11): one run per college a day, from 03:00 IST.
    { name: 'copilot-index', everyMs: HOUR, run: (now) => collegeTasks.copilot(jobs, now) },
    // The network's reconcile (prompt 2, G12, ADR 0014 N19): one run per college and window.
    { name: 'network-reconcile', everyMs: 15 * MINUTE, run: (now) => collegeTasks.network(jobs, now) },
  ];
  // Ingestion: queue fetches for due news and job sources, and due job alerts (job ids dedupe).
  if (ingestion)
    tasks.push({
      name: 'ingestion',
      everyMs: MINUTE,
      run: (now) =>
        Promise.all([
          ContentSourcesService.enqueueDue(jobs, now),
          JobSourcesService.enqueueDue(jobs, now),
          JobsService.enqueueDueAlerts(jobs, now),
        ]),
    });
  return tasks;
}
