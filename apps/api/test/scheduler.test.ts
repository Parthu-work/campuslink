import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { makeTenant, makeUser, testApp, type TestTenant } from './helpers.js';
import { runInTenant, withPlatformScope } from '../src/lib/context.js';
import type { EnqueueOptions, JobQueue, TenantJob } from '../src/lib/jobs.js';
import {
  collegeTasks,
  jitterMs,
  MemorySchedulerLock,
  RedisSchedulerLock,
  scheduledTasks,
  Scheduler,
  type ScheduledTask,
} from '../src/lib/scheduler.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { clearTenantCache } from '../src/modules/tenants/tenant.cache.js';
import { SessionModel } from '../src/modules/auth/session.model.js';
import { NotificationPrefsModel } from '../src/modules/notifications/notification.model.js';
import { ParentDigestModel } from '../src/modules/notifications/parent-digest.service.js';
import { RosterSyncModel } from '../src/modules/imports/roster-sync.service.js';
import { InvoiceModel } from '../src/modules/billing/billing.model.js';
import { AiUsageModel } from '../src/modules/study/ai-usage.model.js';
import { ChannelMessageModel } from '../src/modules/notifications/channels/channel.model.js';

/** Prompt 4, P5: one scheduler, idle colleges produce no work, and an idle product costs nothing. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const silent = { error: () => undefined };
// A Thursday afternoon in India: every weekly, daily and monthly task is past its start hour.
const T0 = Date.parse('2026-11-12T12:00:00Z');

/** Walks a scheduler through simulated time, one tick every 15 seconds. */
async function simulate(s: Scheduler, from: number, forMs: number, stepMs = 15_000) {
  for (let at = from; at < from + forMs; at += stepMs) await s.tick(new Date(at));
}

describe('the scheduler', () => {
  const counter = (
    name: string,
    everyMs: number,
    runs: number[] = [],
  ): ScheduledTask & { runs: number[] } => ({
    name,
    everyMs,
    runs,
    run: async (now) => void runs.push(now.getTime()),
  });

  it('runs each task once per slot, after its own jitter', async () => {
    const a = counter('a', MINUTE);
    const b = counter('b', HOUR);
    const s = new Scheduler([a, b], { lock: new MemorySchedulerLock(), logger: silent });
    const start = Math.floor(T0 / HOUR) * HOUR;
    await simulate(s, start, 3 * HOUR);
    expect(a.runs).toHaveLength(180);
    expect(b.runs).toHaveLength(3);
    // Never before the slot's start plus the task's jitter; never twice in a slot.
    for (const at of b.runs) expect(at % HOUR).toBeGreaterThanOrEqual(jitterMs('b', HOUR));
    expect(new Set(b.runs.map((at) => Math.floor(at / HOUR))).size).toBe(3);
  });

  it('spreads tasks: the jitter is fixed per task, under a quarter of the cadence and two minutes', () => {
    expect(jitterMs('billing', HOUR)).toBe(jitterMs('billing', HOUR));
    const names = ['billing', 'digest', 'next-step', 'senior-buddy', 'parent-digest', 'roster-sync'];
    const offsets = names.map((n) => jitterMs(n, HOUR));
    expect(new Set(offsets).size).toBeGreaterThan(3);
    for (const o of offsets) expect(o).toBeLessThan(120_000);
    expect(jitterMs('ingestion', MINUTE)).toBeLessThan(15_000);
  });

  it('two workers sharing the lock run a task once per slot between them', async () => {
    const runs: number[] = [];
    const lock = new MemorySchedulerLock();
    const one = new Scheduler([counter('t', HOUR, runs)], { lock, logger: silent });
    const two = new Scheduler([counter('t', HOUR, runs)], { lock, logger: silent });
    const start = Math.floor(T0 / HOUR) * HOUR;
    for (let at = start; at < start + 4 * HOUR; at += 15_000) {
      await Promise.all([one.tick(new Date(at)), two.tick(new Date(at))]);
    }
    expect(runs).toHaveLength(4);
  });

  it('a restart inside a slot does not run the task again (the lock is per task and slot)', async () => {
    const runs: number[] = [];
    const lock = new MemorySchedulerLock();
    const start = Math.floor(T0 / HOUR) * HOUR;
    await simulate(new Scheduler([counter('t', HOUR, runs)], { lock, logger: silent }), start, 10 * MINUTE);
    await simulate(
      new Scheduler([counter('t', HOUR, runs)], { lock, logger: silent }),
      start + 10 * MINUTE,
      10 * MINUTE,
    );
    expect(runs).toHaveLength(1);
  });

  it('a failing task is logged by name and does not stop the others or its own next run', async () => {
    const logged: unknown[] = [];
    const ok = counter('ok', MINUTE);
    let calls = 0;
    const bad: ScheduledTask = {
      name: 'bad',
      everyMs: MINUTE,
      run: async () => {
        calls += 1;
        throw new Error('boom');
      },
    };
    const s = new Scheduler([bad, ok], {
      lock: new MemorySchedulerLock(),
      logger: { error: (o: unknown) => void logged.push(o) },
    });
    await simulate(s, Math.floor(T0 / HOUR) * HOUR, 5 * MINUTE);
    expect(calls).toBe(5);
    expect(ok.runs).toHaveLength(5);
    expect(logged).toHaveLength(5);
    expect(logged[0]).toMatchObject({ task: 'bad' });
  });

  it('refuses duplicate names and a task faster than its tick', () => {
    const opts = { lock: new MemorySchedulerLock(), logger: silent };
    expect(() => new Scheduler([counter('x', MINUTE), counter('x', HOUR)], opts)).toThrow(/unique/);
    expect(() => new Scheduler([counter('x', 1000)], opts)).toThrow(/more frequent/);
  });

  it('the Redis lock is SET NX with an expiry, under its own prefix', async () => {
    const calls: unknown[][] = [];
    const held = new Set<string>();
    const lock = new RedisSchedulerLock({
      set: async (...args: [string, string, 'PX', number, 'NX']) => {
        calls.push(args);
        if (held.has(args[0])) return null;
        held.add(args[0]);
        return 'OK';
      },
    });
    expect(await lock.acquire('billing:42', 3_660_000)).toBe(true);
    expect(await lock.acquire('billing:42', 3_660_000)).toBe(false);
    expect(calls[0]).toEqual(['sched:billing:42', '1', 'PX', 3_660_000, 'NX']);
  });
});

describe('the worker’s table of tasks', () => {
  const none = async () => undefined;
  const queue = { enqueue: none, register: () => undefined, cancel: none, close: none } as JobQueue;
  const table = scheduledTasks({ jobs: queue, retention: none, ingestion: true });
  const CADENCE: Record<string, number> = {
    ingestion: MINUTE,
    'roadmap-nudges': 5 * MINUTE,
    'network-reconcile': 15 * MINUTE,
    adulthood: HOUR,
    billing: HOUR,
    digest: HOUR,
    'next-step': HOUR,
    'senior-buddy': HOUR,
    'parent-digest': HOUR,
    'roster-sync': HOUR,
    'placement-graph': HOUR,
    'copilot-index': HOUR,
    retention: 6 * HOUR,
  };

  it('holds every timer the worker had, and nothing else', () => {
    expect(table.map((t) => t.name).sort()).toEqual(Object.keys(CADENCE).sort());
    expect(
      scheduledTasks({ jobs: queue, retention: none, ingestion: false }).map((t) => t.name),
    ).not.toContain('ingestion');
  });

  it.each(Object.entries(CADENCE))('%s still runs at its cadence', async (name, everyMs) => {
    const task = table.find((t) => t.name === name);
    expect(task?.everyMs).toBe(everyMs);
    // The same table, with each task's work replaced by a counter: 12 hours of simulated time.
    let runs = 0;
    const s = new Scheduler([{ name, everyMs, run: async () => void (runs += 1) }], {
      lock: new MemorySchedulerLock(),
      logger: silent,
    });
    await simulate(s, Math.floor(T0 / (6 * HOUR)) * 6 * HOUR, 12 * HOUR);
    expect(runs).toBe((12 * HOUR) / everyMs);
  });
});

// ── Idle colleges ─────────────────────────────

const ctx = testApp();
/** Records what a task queued, per college, without running it. */
function recorder() {
  const jobs: { name: string; tenantId: string }[] = [];
  const queue: JobQueue = {
    register: () => undefined,
    enqueue: async (name: string, data: TenantJob) => void jobs.push({ name, tenantId: data.tenantId }),
    cancel: async () => undefined,
    close: async () => undefined,
  };
  return { jobs, queue, for: (t: TestTenant) => jobs.filter((j) => j.tenantId === String(t._id)) };
}

let idle: TestTenant, busy: TestTenant, suspended: TestTenant;
const now = new Date(T0);

beforeAll(async () => {
  idle = await makeTenant('sch-idle');
  busy = await makeTenant('sch-busy');
  suspended = await makeTenant('sch-off');
  await TenantModel.updateOne({ _id: suspended._id }, { $set: { status: 'suspended' } });
  // The idle college has members, but nobody has used it for two months and nothing is configured.
  // Its seats were counted yesterday (so billing has nothing to do either).
  await makeUser(ctx, idle, { roles: ['STUDENT'] });
  await makeUser(ctx, idle, { roles: ['COLLEGE_ADMIN'], mfa: true });
  await runInTenant(idle._id, () =>
    SessionModel.updateMany({}, { $set: { lastUsedAt: new Date(T0 - 60 * 24 * HOUR) } }),
  );
  await TenantModel.updateOne(
    { _id: idle._id },
    { $set: { 'billing.seatsCountedAt': new Date(T0 - 20 * HOUR), 'billing.seatsUsed': 1 } },
  );
  // The busy college: a member signed in today, one opted into the digest, a parent confirmed, a
  // roster source is on, an invoice is waiting, and a network switch is on.
  const student = await makeUser(ctx, busy, { roles: ['STUDENT'] });
  await runInTenant(busy._id, async () => {
    await SessionModel.updateMany({}, { $set: { lastUsedAt: new Date(T0 - HOUR) } });
    await NotificationPrefsModel.create({ userId: student.id, weeklyDigest: true });
    await ParentDigestModel.create({
      userId: student.id,
      phoneEnc: 'x',
      phoneLast4: '0000',
      status: 'active',
    });
    await RosterSyncModel.create({
      frequency: 'daily',
      source: { kind: 'gsheet', url: 'https://sheets.example/roster' },
      label: 'Roster (test)',
      mapping: {},
      createdBy: new Types.ObjectId(),
    });
  });
  await TenantModel.updateOne({ _id: busy._id }, { $set: { 'network.alumniDiscovery': true } });
  clearTenantCache();
});

describe('a college with nothing to do gets no job (prompt 4, P5)', () => {
  const cases: [keyof typeof collegeTasks, Date][] = [
    ['billing', now],
    ['digest', now],
    ['nextStep', now],
    ['buddy', now],
    ['parentDigest', now],
    ['rosterSync', now],
    ['graph', now],
    ['copilot', now],
    ['network', now],
  ];
  it.each(cases)(
    '%s: the busy college is queued; the idle and the suspended one are not',
    async (task, at) => {
      const r = recorder();
      await collegeTasks[task](r.queue, at);
      expect(r.for(busy), 'busy').toHaveLength(1);
      expect(r.for(idle), 'idle').toHaveLength(0);
      expect(r.for(suspended), 'suspended').toHaveLength(0);
    },
  );

  it('billing wakes for an open invoice, a read-only college, or seats not counted for a week', async () => {
    const t = await makeTenant('sch-bill');
    const queued = async () => {
      const r = recorder();
      await collegeTasks.billing(r.queue, now);
      return r.for(t).length;
    };
    // Never counted: one run.
    expect(await queued()).toBe(1);
    await TenantModel.updateOne({ _id: t._id }, { $set: { 'billing.seatsCountedAt': new Date(T0 - HOUR) } });
    expect(await queued()).toBe(0);
    await TenantModel.updateOne(
      { _id: t._id },
      { $set: { 'billing.seatsCountedAt': new Date(T0 - 8 * 24 * HOUR) } },
    );
    expect(await queued()).toBe(1);
    await TenantModel.updateOne(
      { _id: t._id },
      { $set: { 'billing.seatsCountedAt': new Date(T0 - HOUR), 'billing.readOnlyAt': new Date(T0) } },
    );
    expect(await queued()).toBe(1);
    await TenantModel.updateOne({ _id: t._id }, { $set: { 'billing.readOnlyAt': null } });
    expect(await queued()).toBe(0);
    await withPlatformScope('test:scheduler', () =>
      InvoiceModel.collection.insertOne({ tenantId: t._id, status: 'issued' }),
    );
    expect(await queued()).toBe(1);
    await withPlatformScope('test:scheduler', () => InvoiceModel.collection.deleteMany({ tenantId: t._id }));
  });

  it('the roster sync skips a read-only college (a sync writes)', async () => {
    await TenantModel.updateOne({ _id: busy._id }, { $set: { 'billing.readOnlyAt': new Date(T0) } });
    clearTenantCache();
    const r = recorder();
    await collegeTasks.rosterSync(r.queue, now);
    expect(r.for(busy)).toHaveLength(0);
    await TenantModel.updateOne({ _id: busy._id }, { $set: { 'billing.readOnlyAt': null } });
    clearTenantCache();
  });

  it('a switched-off feature queues nothing for that college', async () => {
    await TenantModel.updateOne(
      { _id: busy._id },
      { $set: { 'features.peerMentors': false, 'features.placements': false } },
    );
    clearTenantCache();
    const r = recorder();
    await collegeTasks.buddy(r.queue, now);
    await collegeTasks.graph(r.queue, now);
    expect(r.for(busy)).toHaveLength(0);
    await TenantModel.updateOne(
      { _id: busy._id },
      { $set: { 'features.peerMentors': true, 'features.placements': true } },
    );
    clearTenantCache();
  });
});

describe('48 idle hours cost nothing (prompt 4, P5)', () => {
  it('no AI usage, no channel message and no outbound call, and almost no jobs', async () => {
    // Its own app: every outbound call (SSRF-safe fetcher or plain fetch) is counted.
    const outbound: string[] = [];
    const idleCtx = testApp({
      fetcher: (async (url: string) => {
        outbound.push(url);
        throw new Error('outbound call during the idle test');
      }) as never,
      fetchImpl: (async (url: unknown) => {
        outbound.push(String(url));
        throw new Error('outbound call during the idle test');
      }) as never,
    });
    // Only idle colleges in this run: the busy one goes quiet too (nobody for two months, nothing on).
    await runInTenant(busy._id, async () => {
      await SessionModel.updateMany({}, { $set: { lastUsedAt: new Date(T0 - 60 * 24 * HOUR) } });
      await NotificationPrefsModel.updateMany({}, { $set: { weeklyDigest: false } });
      await ParentDigestModel.updateMany({}, { $set: { status: 'pending' } });
      await RosterSyncModel.updateMany({}, { $set: { enabled: false } });
    });
    await TenantModel.updateMany(
      { kind: 'college' },
      {
        $set: {
          'network.alumniDiscovery': false,
          'billing.seatsCountedAt': new Date(T0 - HOUR),
          'billing.readOnlyAt': null,
        },
      },
    );
    clearTenantCache();

    // The real queue (jobs run inline), deduplicated by job id as BullMQ does.
    const ran: string[] = [];
    const seen = new Set<string>();
    const inline = idleCtx.queue;
    const jobs: JobQueue = {
      register: (n, h) => inline.register(n, h),
      cancel: (n, id) => inline.cancel(n, id),
      close: () => inline.close(),
      enqueue: async (name: string, data: TenantJob, opts?: EnqueueOptions) => {
        if (opts?.jobId) {
          if (seen.has(`${name}:${opts.jobId}`)) return;
          seen.add(`${name}:${opts.jobId}`);
        }
        ran.push(name);
        await inline.enqueue(name, data, opts);
      },
    };
    let sweeps = 0;
    const s = new Scheduler(
      scheduledTasks({ jobs, retention: async () => void (sweeps += 1), ingestion: true }),
      {
        lock: new MemorySchedulerLock(),
        logger: { error: (o: unknown) => void ran.push(`ERROR ${JSON.stringify(o)}`) },
      },
    );
    // 48 hours, one tick every 30 seconds (the minute task still runs every minute).
    await simulate(s, T0, 48 * HOUR, 30_000);

    const count = <T>(fn: () => Promise<T>) => withPlatformScope('test:scheduler-idle', fn);
    expect(await count(() => AiUsageModel.countDocuments({}))).toBe(0);
    expect(await count(() => ChannelMessageModel.countDocuments({}))).toBe(0);
    expect(outbound).toEqual([]);
    expect(idleCtx.sms.outbox.entries).toHaveLength(0);
    expect(idleCtx.whatsapp.outbox.entries).toHaveLength(0);
    expect(idleCtx.mailer.outbox).toHaveLength(0);
    // The six-hourly sweep kept its cadence; no task failed; no college got a job in two days.
    expect(sweeps).toBe(8);
    expect(ran.filter((n) => n.startsWith('ERROR'))).toEqual([]);
    expect(ran).toEqual([]);
  }, 120_000);
});
