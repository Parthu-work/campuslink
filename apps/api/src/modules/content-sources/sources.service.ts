import { Types } from 'mongoose';
import type { z } from 'zod';
import type { Branch, ItemView, SourceView, Topic, sourceBody, sourceUpdateBody } from '@campuslink/shared';
import { ContentItemModel, ContentSourceModel, type ItemDoc, type SourceDoc } from './source.model.js';
import { STARTER_SOURCES } from './starter.js';
import { fetchFeed, type FetchOutcome } from './fetch.js';
import { canonicalUrl, contentHash, urlHash } from './canonical.js';
import { judge } from './quality.js';
import { autoTags } from './tagging.js';
import type { ParsedFeed } from './rss.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { requireTenantId, withPlatformScope } from '../../lib/context.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { Logger } from '../../lib/logger.js';
import type { safeFetch } from '../../lib/safe-fetch.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { Removal } from '../moderation/moderation.service.js';
import type { AuthState } from '../../types.js';

export const FETCH_JOB = 'content.fetch';
const DAY = 86_400_000;
const ITEM_TTL = 90 * DAY;
const MIN_INTERVAL_MIN = 30;
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

export interface SourcesDeps {
  fetcher: typeof safeFetch;
  jobs: JobQueue;
  logger: Logger;
  /** Removes follows of a deleted source (feed module). */
  onRemoved?: (sourceId: string) => Promise<void>;
  followerCounts?: (sourceIds: string[]) => Promise<Map<string, number>>;
}

export class ContentSourcesService {
  constructor(private readonly d: SourcesDeps) {}

  // ── Admin ─────────────────────────────
  private async views(rows: SourceDoc[]): Promise<SourceView[]> {
    const since = new Date(Date.now() - 7 * DAY);
    const ids = rows.map((r) => r._id);
    const counts = await ContentItemModel.aggregate<{ _id: { s: Types.ObjectId; st: string }; n: number }>([
      { $match: { sourceId: { $in: ids }, createdAt: { $gte: since } } },
      { $group: { _id: { s: '$sourceId', st: '$status' }, n: { $sum: 1 } } },
    ]);
    const followers = (await this.d.followerCounts?.(ids.map(String))) ?? new Map<string, number>();
    const count = (id: Types.ObjectId, st: string) =>
      counts.find((c) => String(c._id.s) === String(id) && c._id.st === st)?.n ?? 0;
    return rows.map((s) => ({
      id: String(s._id),
      name: s.name,
      url: s.url,
      host: s.host,
      topics: s.topics as Topic[],
      branches: s.branches as Branch[],
      intervalMin: s.intervalMin,
      status: s.status as 'active' | 'paused',
      health: {
        state: !s.lastFetchedAt
          ? 'new'
          : s.lastOutcome === 'blocked'
            ? 'blocked'
            : s.consecutiveFailures > 0
              ? 'failing'
              : 'ok',
        lastFetchedAt: s.lastFetchedAt?.toISOString() ?? null,
        lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
        lastError: s.lastError ?? null,
        consecutiveFailures: s.consecutiveFailures,
        itemsLast7d: count(s._id, 'published'),
        heldLast7d: count(s._id, 'held'),
        nextFetchAt: s.status === 'active' ? (s.nextFetchAt?.toISOString() ?? null) : null,
      },
      followers: followers.get(String(s._id)) ?? 0,
    }));
  }

  async adminList() {
    return this.views(await ContentSourceModel.find({}).sort({ name: 1 }).lean<SourceDoc[]>());
  }

  /** Test fetch before adding: robots, reachability and parsing, with a short preview. */
  async test(url: string) {
    const r = await fetchFeed(url, this.d.fetcher);
    if (r.kind !== 'ok')
      return { ok: false as const, error: r.kind === 'not_modified' ? 'No content' : r.message };
    return {
      ok: true as const,
      title: r.feed.title,
      format: r.feed.format,
      items: r.feed.items.slice(0, 3).map((i) => ({ title: i.title, url: i.url })),
    };
  }

  async create(
    actor: AuthState,
    body: z.output<typeof sourceBody>,
    meta: RequestMetaLite,
    starterKey: string | null = null,
  ) {
    const t = await this.test(body.url);
    if (!t.ok) throw badRequest(`That feed can’t be used: ${t.error}`);
    try {
      const doc = await ContentSourceModel.create({
        name: body.name,
        url: body.url,
        host: new URL(body.url).hostname.replace(/^www\./, ''),
        starterKey,
        topics: body.topics,
        branches: body.branches,
        intervalMin: Math.max(MIN_INTERVAL_MIN, body.intervalMin),
        createdBy: new Types.ObjectId(actor.userId),
        nextFetchAt: new Date(),
      });
      await audit.record(
        {
          action: 'source.added',
          actorId: actor.userId,
          targetType: 'source',
          targetId: String(doc._id),
          meta: { host: doc.host },
        },
        meta,
      );
      await this.enqueue(String(doc._id), doc.nextFetchAt);
      return (await this.views([doc.toObject() as SourceDoc]))[0];
    } catch (e) {
      if (isDuplicate(e)) throw conflict('This feed is already added');
      throw e;
    }
  }

  starters(existing: Set<string>) {
    return STARTER_SOURCES.map((s) => ({ ...s, added: existing.has(s.key) }));
  }

  async starterList() {
    const rows = await ContentSourceModel.find({ starterKey: { $ne: null } })
      .select('starterKey')
      .lean();
    return this.starters(new Set(rows.map((r) => r.starterKey ?? '')));
  }

  async addStarter(actor: AuthState, key: string, meta: RequestMetaLite) {
    const s = STARTER_SOURCES.find((x) => x.key === key);
    if (!s) throw notFound('Starter source');
    if (!s.verifiedAt) throw conflict('This starter feed has not passed verification yet');
    return this.create(
      actor,
      { name: s.name, url: s.url, topics: s.topics, branches: s.branches, intervalMin: s.intervalMin },
      meta,
      s.key,
    );
  }

  async update(actor: AuthState, id: string, body: z.output<typeof sourceUpdateBody>, meta: RequestMetaLite) {
    const set: Record<string, unknown> = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    );
    if (set.intervalMin) set.intervalMin = Math.max(MIN_INTERVAL_MIN, Number(set.intervalMin));
    if (body.status === 'active') set.nextFetchAt = new Date();
    const doc = await ContentSourceModel.findOneAndUpdate(
      { _id: id },
      { $set: set },
      { returnDocument: 'after' },
    ).lean<SourceDoc>();
    if (!doc) throw notFound('Source');
    await audit.record(
      {
        action: 'source.updated',
        actorId: actor.userId,
        targetType: 'source',
        targetId: id,
        meta: { status: doc.status },
      },
      meta,
    );
    return (await this.views([doc]))[0];
  }

  async remove(actor: AuthState, id: string, meta: RequestMetaLite) {
    const doc = await ContentSourceModel.findOneAndDelete({ _id: id }).lean<SourceDoc>();
    if (!doc) throw notFound('Source');
    await ContentItemModel.deleteMany({ sourceId: doc._id });
    await this.d.onRemoved?.(id);
    await audit.record(
      {
        action: 'source.removed',
        actorId: actor.userId,
        targetType: 'source',
        targetId: id,
        meta: { host: doc.host },
      },
      meta,
    );
    return { deleted: true };
  }

  async fetchNow(id: string) {
    const doc = await ContentSourceModel.findOneAndUpdate(
      { _id: id, status: 'active' },
      { $set: { nextFetchAt: new Date() } },
      { returnDocument: 'after' },
    ).lean<SourceDoc>();
    if (!doc) throw notFound('Active source');
    await this.enqueue(id, doc.nextFetchAt);
    return { queued: true };
  }

  // ── Scheduling & ingestion ─────────────────────────────
  private async enqueue(sourceId: string, at: Date | null | undefined) {
    const when = at?.getTime() ?? Date.now();
    await this.d.jobs.enqueue(
      FETCH_JOB,
      { tenantId: String(requireTenantId()), sourceId, due: when },
      { jobId: `src-${sourceId}-${when}`, delayMs: Math.max(0, when - Date.now()) },
    );
  }

  /**
   * Scheduler tick (named platform path): finds due sources in every college and queues one fetch
   * each. The job id includes the due time, so several API instances never fetch twice.
   */
  static async enqueueDue(jobs: JobQueue, now = new Date()) {
    const due = await withPlatformScope('content:due-sources', () =>
      ContentSourceModel.find({ status: 'active', nextFetchAt: { $lte: now } })
        .select('_id tenantId nextFetchAt')
        .limit(500)
        .lean<(SourceDoc & { tenantId: Types.ObjectId })[]>(),
    );
    for (const s of due)
      await jobs.enqueue(
        FETCH_JOB,
        { tenantId: String(s.tenantId), sourceId: String(s._id), due: s.nextFetchAt?.getTime() ?? 0 },
        { jobId: `src-${String(s._id)}-${s.nextFetchAt?.getTime() ?? 0}` },
      );
    return due.length;
  }

  /** Job handler: claim the source (moves nextFetchAt forward atomically), fetch, ingest, record health. */
  async runFetch(job: TenantJob): Promise<void> {
    const now = new Date();
    const src = await ContentSourceModel.findOneAndUpdate(
      { _id: job.sourceId, status: 'active', nextFetchAt: { $lte: now } },
      { $set: { nextFetchAt: new Date(now.getTime() + MIN_INTERVAL_MIN * 60_000) } },
      { returnDocument: 'before' },
    ).lean<SourceDoc>();
    if (!src) return; // paused, removed, or another worker has it
    const outcome = await fetchFeed(src.url, this.d.fetcher, {
      etag: src.etag ?? null,
      lastModified: src.lastModified ?? null,
    });
    await this.applyOutcome(src, outcome, now);
  }

  private async applyOutcome(src: SourceDoc, outcome: FetchOutcome, now: Date) {
    const base = src.intervalMin * 60_000;
    const set: Record<string, unknown> = { lastFetchedAt: now, lastOutcome: outcome.kind };
    if (outcome.kind === 'ok' || outcome.kind === 'not_modified') {
      if (outcome.kind === 'ok') {
        await this.ingest(src, outcome.feed);
        set.etag = outcome.etag;
        set.lastModified = outcome.lastModified;
      }
      set.lastSuccessAt = now;
      set.lastError = null;
      set.consecutiveFailures = 0;
      set.nextFetchAt = new Date(now.getTime() + Math.max(base, (outcome.maxAgeSec ?? 0) * 1000));
    } else if (outcome.kind === 'blocked') {
      set.lastError = outcome.message;
      set.consecutiveFailures = src.consecutiveFailures + 1;
      set.nextFetchAt = new Date(now.getTime() + DAY);
    } else {
      const failures = src.consecutiveFailures + 1;
      set.lastError = outcome.message.slice(0, 300);
      set.consecutiveFailures = failures;
      const backoff = Math.min(base * 2 ** Math.min(failures, 6), DAY);
      set.nextFetchAt = new Date(now.getTime() + Math.max(backoff, (outcome.retryAfterSec ?? 0) * 1000));
    }
    await ContentSourceModel.updateOne({ _id: src._id }, { $set: set });
    if (outcome.kind !== 'ok' && outcome.kind !== 'not_modified')
      this.d.logger.warn(
        { source: String(src._id), host: src.host, outcome: outcome.kind },
        'feed fetch did not succeed',
      );
  }

  /** Normalise, de-duplicate (canonical URL and content hash), filter and tag new items. */
  async ingest(src: SourceDoc, feed: ParsedFeed) {
    let added = 0;
    const weekAgo = new Date(Date.now() - 7 * DAY);
    for (const it of feed.items.slice(0, 50)) {
      let canonical: string;
      try {
        canonical = canonicalUrl(it.url);
      } catch {
        continue;
      }
      const uh = urlHash(canonical);
      const ch = contentHash(it.title, it.snippet);
      if (await ContentItemModel.exists({ contentHash: ch, publishedAt: { $gte: weekAgo } })) continue;
      const verdict = judge({ title: it.title, snippet: it.snippet });
      if (verdict.status === 'rejected') continue;
      const tags = autoTags(`${it.title} ${it.snippet} ${it.categories.join(' ')}`, {
        topics: src.topics as Topic[],
        branches: src.branches as Branch[],
      });
      try {
        await ContentItemModel.create({
          sourceId: src._id,
          title: it.title,
          snippet: it.snippet,
          url: canonical,
          host: new URL(canonical).hostname.replace(/^www\./, ''),
          urlHash: uh,
          contentHash: ch,
          publishedAt: it.publishedAt,
          topics: tags.topics,
          branches: tags.branches,
          status: verdict.status,
          quality: verdict.reasons,
          expiresAt: new Date(Math.max(it.publishedAt.getTime(), Date.now()) + ITEM_TTL),
        });
        added++;
      } catch (e) {
        if (!isDuplicate(e)) throw e;
      }
    }
    return added;
  }

  // ── Reading ─────────────────────────────
  async recentItems(opts: {
    since: Date;
    until: Date;
    limit: number;
    sourceIds?: string[];
    topics?: string[];
  }) {
    const or: Record<string, unknown>[] = [];
    if (opts.sourceIds?.length)
      or.push({ sourceId: { $in: opts.sourceIds.map((s) => new Types.ObjectId(s)) } });
    if (opts.topics?.length) or.push({ topics: { $in: opts.topics } });
    return ContentItemModel.find({
      status: 'published',
      publishedAt: { $gte: opts.since, $lte: opts.until },
      ...(or.length ? { $or: or } : {}),
    })
      .sort({ publishedAt: -1 })
      .limit(opts.limit)
      .lean<ItemDoc[]>();
  }

  async itemViews(rows: ItemDoc[]): Promise<ItemView[]> {
    const sources = await ContentSourceModel.find({
      _id: { $in: [...new Set(rows.map((r) => String(r.sourceId)))] },
    })
      .select('name')
      .lean<SourceDoc[]>();
    const names = new Map(sources.map((s) => [String(s._id), s.name]));
    return rows.map((i) => ({
      id: String(i._id),
      title: i.title,
      snippet: i.snippet,
      url: i.url,
      host: i.host,
      source: { id: String(i.sourceId), name: names.get(String(i.sourceId)) ?? i.host },
      topics: i.topics as Topic[],
      publishedAt: i.publishedAt.toISOString(),
    }));
  }

  async itemsByIds(ids: string[]) {
    return ContentItemModel.find({ _id: { $in: ids }, status: 'published' }).lean<ItemDoc[]>();
  }

  /** Sources members can follow. */
  async publicList() {
    const rows = await ContentSourceModel.find({ status: 'active' })
      .sort({ name: 1 })
      .select('name host topics')
      .lean<SourceDoc[]>();
    return rows.map((s) => ({ id: String(s._id), name: s.name, host: s.host, topics: s.topics as Topic[] }));
  }

  async exists(id: string) {
    return !!(await ContentSourceModel.exists({ _id: id }));
  }

  // ── Moderation of automated items ─────────────────────────────
  async heldItems(cursor?: string) {
    const rows = await ContentItemModel.find({
      status: 'held',
      ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(31)
      .lean<ItemDoc[]>();
    const page = rows.slice(0, 30);
    const views = await this.itemViews(page);
    return {
      items: views.map((v, i) => ({ ...v, quality: page[i]?.quality ?? [] })),
      nextCursor: rows.length > 30 ? String(page.at(-1)?._id) : null,
    };
  }

  async heldCount() {
    return ContentItemModel.countDocuments({ status: 'held' });
  }

  async decideHeld(id: string, decision: 'publish' | 'reject') {
    const r = await ContentItemModel.updateOne(
      { _id: id, status: 'held' },
      { $set: { status: decision === 'publish' ? 'published' : 'rejected' } },
    );
    if (!r.modifiedCount) throw notFound('Held item');
    return { status: decision === 'publish' ? 'published' : 'rejected' };
  }

  readonly itemHandler = {
    load: async (id: string) => {
      const i = await ContentItemModel.findById(id).lean<ItemDoc>();
      return i
        ? { authorId: '', status: i.status, snapshot: `${i.title}\n${i.snippet}\n${i.url}`, context: {} }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await ContentItemModel.updateOne(
          { _id: id, status: removal ? 'published' : 'removed' },
          { $set: { status: removal ? 'removed' : 'published', removal } },
        )
      ).modifiedCount > 0,
  };
}
