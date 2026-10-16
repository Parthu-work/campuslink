import { Types } from 'mongoose';
import type { z } from 'zod';
import type { Branch, JobSourceBody, JobSourceView, jobSourceUpdateBody } from '@campuslink/shared';
import { JobSourceModel, type JobSourceDoc } from './job-source.model.js';
import { ADAPTERS, type FetchResult, type SourceConfig } from './adapters.js';
import { STARTER_BOARDS } from './starter.js';
import { isIndiaLocation } from '../jobs/normalize.js';
import type { JobsService } from '../jobs/jobs.service.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { requireTenantId, withPlatformScope } from '../../lib/context.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { Logger } from '../../lib/logger.js';
import type { safeFetch } from '../../lib/safe-fetch.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { AuthState } from '../../types.js';

export const JOB_FETCH_JOB = 'jobs.fetch';
const DAY = 86_400_000;
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

export interface JobSourcesDeps {
  fetcher: typeof safeFetch;
  jobs: JobQueue;
  logger: Logger;
  listings: JobsService;
  adzuna: { appId: string; appKey: string } | null;
}

const configOf = (s: Pick<JobSourceDoc, 'kind' | 'board' | 'query' | 'where' | 'url'>): SourceConfig => ({
  kind: s.kind as SourceConfig['kind'],
  board: s.board ?? null,
  query: s.query ?? null,
  where: s.where ?? null,
  url: s.url ?? null,
});

/** Job sources per college: ATS boards, Adzuna searches and RSS feeds, each with health. */
export class JobSourcesService {
  constructor(private readonly d: JobSourcesDeps) {}

  private async views(rows: JobSourceDoc[]): Promise<JobSourceView[]> {
    const open = await this.d.listings.openCount(rows.map((r) => r._id));
    return rows.map((s) => ({
      id: String(s._id),
      kind: s.kind as JobSourceView['kind'],
      name: s.name,
      target: s.target,
      company: s.company,
      branches: s.branches as Branch[],
      intervalMin: s.intervalMin,
      status: s.status as 'active' | 'paused',
      starterKey: s.starterKey ?? null,
      health: {
        state: !s.lastFetchedAt
          ? 'new'
          : s.lastOutcome === 'blocked'
            ? 'blocked'
            : s.consecutiveFailures > 0
              ? 'failing'
              : 'ok',
        lastFetchedAt: s.lastFetchedAt?.toISOString() ?? null,
        lastError: s.lastError ?? null,
        consecutiveFailures: s.consecutiveFailures,
        openJobs: open.get(String(s._id)) ?? 0,
        nextFetchAt: s.status === 'active' ? (s.nextFetchAt?.toISOString() ?? null) : null,
      },
    }));
  }

  /** Names and attribution lines for job cards. */
  async info(ids: string[]) {
    const rows = await JobSourceModel.find({ _id: { $in: ids } })
      .select('name kind')
      .lean<JobSourceDoc[]>();
    return new Map(
      rows.map((s) => [
        String(s._id),
        { name: s.name, attribution: ADAPTERS[s.kind as SourceConfig['kind']].attribution },
      ]),
    );
  }

  async list() {
    return this.views(await JobSourceModel.find({}).sort({ name: 1 }).lean<JobSourceDoc[]>());
  }

  private fetchOnce(
    cfg: SourceConfig,
    cache?: { etag?: string | null; lastModified?: string | null },
  ): Promise<FetchResult> {
    return ADAPTERS[cfg.kind].fetch(cfg, {
      fetcher: this.d.fetcher,
      adzuna: this.d.adzuna,
      ...(cache ? { cache } : {}),
    });
  }

  /** Test before adding: reachability, parsing and how many openings would be kept. */
  async test(body: JobSourceBody) {
    const cfg = this.configFromBody(body);
    const r = await this.fetchOnce(cfg);
    if (r.kind !== 'ok')
      return { ok: false as const, error: r.kind === 'not_modified' ? 'No content' : r.message };
    const kept =
      body.kind === 'rss' || body.kind === 'adzuna'
        ? r.jobs
        : r.jobs.filter((j) => !(body.indiaOnly ?? true) || isIndiaLocation(j.location));
    return {
      ok: true as const,
      total: r.jobs.length,
      kept: kept.length,
      sample: kept.slice(0, 3).map((j) => ({ title: j.title, location: j.location })),
    };
  }

  private configFromBody(body: JobSourceBody): SourceConfig {
    switch (body.kind) {
      case 'adzuna':
        return { kind: 'adzuna', query: body.query, where: body.where ?? null };
      case 'rss':
        return { kind: 'rss', url: body.url };
      default:
        return { kind: body.kind, board: body.board };
    }
  }

  async create(
    actor: AuthState,
    body: JobSourceBody,
    meta: RequestMetaLite,
    starterKey: string | null = null,
  ) {
    const cfg = this.configFromBody(body);
    const t = await this.test(body);
    if (!t.ok) throw badRequest(`That source can’t be used: ${t.error}`);
    try {
      const doc = await JobSourceModel.create({
        kind: body.kind,
        name: body.name,
        board: cfg.board ?? null,
        query: cfg.query ?? null,
        where: cfg.where ?? null,
        url: cfg.url ?? null,
        target: ADAPTERS[body.kind].target(cfg),
        company: body.company ?? (body.kind === 'rss' || body.kind === 'adzuna' ? '' : body.name),
        branches: body.branches,
        indiaOnly: body.indiaOnly,
        intervalMin: body.intervalMin,
        starterKey,
        createdBy: new Types.ObjectId(actor.userId),
        nextFetchAt: new Date(),
      });
      await audit.record(
        {
          action: 'job_source.added',
          actorId: actor.userId,
          targetType: 'job_source',
          targetId: String(doc._id),
          meta: { kind: body.kind },
        },
        meta,
      );
      await this.enqueue(String(doc._id), doc.nextFetchAt);
      return (await this.views([doc.toObject() as JobSourceDoc]))[0];
    } catch (e) {
      if (isDuplicate(e)) throw conflict('This source is already added');
      throw e;
    }
  }

  async starterList() {
    const rows = await JobSourceModel.find({ starterKey: { $ne: null } })
      .select('starterKey')
      .lean();
    const added = new Set(rows.map((r) => r.starterKey ?? ''));
    return STARTER_BOARDS.map((s) => ({ ...s, added: added.has(s.key) }));
  }

  async addStarter(actor: AuthState, key: string, meta: RequestMetaLite) {
    const s = STARTER_BOARDS.find((x) => x.key === key);
    if (!s) throw notFound('Starter board');
    if (!s.verifiedAt) throw conflict('This board has not passed verification yet');
    return this.create(
      actor,
      {
        kind: s.kind,
        board: s.board,
        name: s.company,
        company: s.company,
        branches: s.branches,
        indiaOnly: true,
        intervalMin: 720,
      },
      meta,
      s.key,
    );
  }

  async update(
    actor: AuthState,
    id: string,
    body: z.output<typeof jobSourceUpdateBody>,
    meta: RequestMetaLite,
  ) {
    const set: Record<string, unknown> = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    );
    if (body.status === 'active') set.nextFetchAt = new Date();
    const doc = await JobSourceModel.findOneAndUpdate(
      { _id: id },
      { $set: set },
      { returnDocument: 'after' },
    ).lean<JobSourceDoc>();
    if (!doc) throw notFound('Job source');
    await audit.record(
      {
        action: 'job_source.updated',
        actorId: actor.userId,
        targetType: 'job_source',
        targetId: id,
        meta: { status: doc.status },
      },
      meta,
    );
    return (await this.views([doc]))[0];
  }

  async remove(actor: AuthState, id: string, meta: RequestMetaLite) {
    const doc = await JobSourceModel.findOneAndDelete({ _id: id }).lean<JobSourceDoc>();
    if (!doc) throw notFound('Job source');
    await this.d.listings.removeSourceJobs(doc._id);
    await audit.record(
      {
        action: 'job_source.removed',
        actorId: actor.userId,
        targetType: 'job_source',
        targetId: id,
        meta: { kind: doc.kind },
      },
      meta,
    );
    return { deleted: true };
  }

  async fetchNow(id: string) {
    const doc = await JobSourceModel.findOneAndUpdate(
      { _id: id, status: 'active' },
      { $set: { nextFetchAt: new Date() } },
      { returnDocument: 'after' },
    ).lean<JobSourceDoc>();
    if (!doc) throw notFound('Active job source');
    await this.enqueue(id, doc.nextFetchAt);
    return { queued: true };
  }

  private async enqueue(sourceId: string, at: Date | null | undefined) {
    const when = at?.getTime() ?? Date.now();
    await this.d.jobs.enqueue(
      JOB_FETCH_JOB,
      { tenantId: String(requireTenantId()), sourceId, due: when },
      { jobId: `jsrc-${sourceId}-${when}`, delayMs: Math.max(0, when - Date.now()) },
    );
  }

  /** Scheduler tick (named platform path), like news sources. */
  static async enqueueDue(jobs: JobQueue, now = new Date()) {
    const due = await withPlatformScope('jobs:due-sources', () =>
      JobSourceModel.find({ status: 'active', nextFetchAt: { $lte: now } })
        .select('_id tenantId nextFetchAt')
        .limit(500)
        .lean<(JobSourceDoc & { tenantId: Types.ObjectId })[]>(),
    );
    for (const s of due)
      await jobs.enqueue(
        JOB_FETCH_JOB,
        { tenantId: String(s.tenantId), sourceId: String(s._id), due: s.nextFetchAt?.getTime() ?? 0 },
        { jobId: `jsrc-${String(s._id)}-${s.nextFetchAt?.getTime() ?? 0}` },
      );
    return due.length;
  }

  async runFetch(job: TenantJob): Promise<void> {
    const now = new Date();
    const src = await JobSourceModel.findOneAndUpdate(
      { _id: job.sourceId, status: 'active', nextFetchAt: { $lte: now } },
      { $set: { nextFetchAt: new Date(now.getTime() + 60 * 60_000) } },
      { returnDocument: 'before' },
    ).lean<JobSourceDoc>();
    if (!src) return;
    const r = await this.fetchOnce(configOf(src), {
      etag: src.etag ?? null,
      lastModified: src.lastModified ?? null,
    });
    const base = src.intervalMin * 60_000;
    const set: Record<string, unknown> = { lastFetchedAt: now, lastOutcome: r.kind };
    if (r.kind === 'ok' || r.kind === 'not_modified') {
      if (r.kind === 'ok') {
        await this.d.listings.ingest(src, r.jobs);
        set.etag = r.etag ?? null;
        set.lastModified = r.lastModified ?? null;
      }
      set.lastSuccessAt = now;
      set.lastError = null;
      set.consecutiveFailures = 0;
      set.nextFetchAt = new Date(now.getTime() + base);
    } else if (r.kind === 'blocked') {
      set.lastError = r.message.slice(0, 300);
      set.consecutiveFailures = src.consecutiveFailures + 1;
      set.nextFetchAt = new Date(now.getTime() + DAY);
    } else {
      const failures = src.consecutiveFailures + 1;
      set.lastError = r.message.slice(0, 300);
      set.consecutiveFailures = failures;
      set.nextFetchAt = new Date(
        now.getTime() +
          Math.max(Math.min(base * 2 ** Math.min(failures, 4), 2 * DAY), (r.retryAfterSec ?? 0) * 1000),
      );
      this.d.logger.warn(
        { source: String(src._id), kind: src.kind, outcome: r.kind },
        'job source fetch failed',
      );
    }
    await JobSourceModel.updateOne({ _id: src._id }, { $set: set });
  }
}
