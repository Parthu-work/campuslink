import { Types } from 'mongoose';
import type { AiIndexView, MaterialType, MaterialVisibility } from '@campuslink/shared';
import { requireTenantId } from '../../lib/context.js';
import { conflict } from '../../lib/errors.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { Logger } from '../../lib/logger.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { AiSettingsModel, type AiSettingsDoc } from './ai-settings.model.js';
import {
  ContentChunkModel,
  MaterialModel,
  type ContentChunkDoc,
  type MaterialDoc,
} from './material.model.js';
import { ProviderError, type EmbedResult } from './ai/provider.js';
import type { ActiveEmbedding, AiRuntime, AiSettingsService } from './ai-settings.service.js';
import { nextMonth, type AiUsageService } from './ai-usage.service.js';
import type { SubjectsService } from './subjects.service.js';
import { cosine, type VectorIndex, type VectorPoint } from './vector/store.js';
import type { AuthState } from '../../types.js';

export const EMBED_JOB = 'study.embed';
/** Passages per embedding request (every provider accepts this many). */
export const EMBED_BATCH = 64;
/** A back-fill run works this long, then hands over to a fresh job. */
const SLICE_MS = 2 * 60_000;
const LEASE_MS = 5 * 60_000;
/** After a provider or vector-store outage, try again this much later. */
export const RETRY_LATER_MS = 10 * 60_000;
/** A passage is also tagged to the syllabus topic its meaning is closest to, above this. */
export const TOPIC_SIMILARITY = 0.5;
const RESTORE_BATCH = 256;

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

/** Vectors are stored as float32 bytes on the passage. */
export const toBytes = (v: number[]) => Buffer.from(Float32Array.from(v).buffer);
export function fromBytes(b: unknown): number[] {
  const bytes =
    b instanceof Uint8Array
      ? b
      : (b as { buffer?: unknown } | null)?.buffer instanceof Uint8Array
        ? (b as { buffer: Uint8Array }).buffer
        : null;
  if (!bytes || bytes.byteLength % 4) return [];
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return Array.from(new Float32Array(copy.buffer));
}

/** What is embedded for a passage: the material's title and the heading give it context. */
export const embedText = (title: string, heading: string, text: string) =>
  [title, heading, text].filter((x) => x.trim()).join('\n');

type ChunkRow = Pick<
  ContentChunkDoc,
  'subjectId' | 'materialId' | 'unitId' | 'topicIds' | 'visibility' | 'text' | 'heading'
> & { _id: Types.ObjectId };

/**
 * The college's passages that have a vector, as points for a vector store (current tenant).
 * The in-memory store loads a college with it after a restart; `restore` rebuilds a lost index.
 */
export async function storedVectors(
  opts: { model?: string; after?: Types.ObjectId | null; limit?: number } = {},
): Promise<VectorPoint[]> {
  const tenantId = String(requireTenantId());
  const q = ContentChunkModel.find({
    embeddingStatus: 'embedded',
    ...(opts.model ? { embeddingModel: opts.model } : {}),
    ...(opts.after ? { _id: { $gt: opts.after } } : {}),
  })
    .select('+vector subjectId materialId unitId topicIds visibility embeddingModel')
    .sort({ _id: 1 });
  if (opts.limit) q.limit(opts.limit);
  const rows = await q.lean<(ContentChunkDoc & { _id: Types.ObjectId })[]>();
  const types = await materialTypes(rows.map((r) => r.materialId));
  return rows
    .map((r) => ({
      id: String(r._id),
      vector: fromBytes(r.vector),
      payload: {
        tenantId,
        subjectId: String(r.subjectId),
        materialId: String(r.materialId),
        materialType: types.get(String(r.materialId)) ?? 'pdf',
        unitId: r.unitId ? String(r.unitId) : null,
        topicIds: (r.topicIds ?? []).map(String),
        visibility: r.visibility as MaterialVisibility,
        model: r.embeddingModel ?? '',
      },
    }))
    .filter((p) => p.vector.length && p.payload.model);
}

async function materialTypes(ids: Types.ObjectId[]): Promise<Map<string, MaterialType>> {
  const rows = await MaterialModel.find({ _id: { $in: [...new Set(ids.map(String))].map(oid) } })
    .select('type')
    .lean<Pick<MaterialDoc, '_id' | 'type'>[]>();
  return new Map(rows.map((m) => [String(m._id), m.type as MaterialType]));
}

export interface IndexingDeps {
  ai: AiSettingsService;
  subjects: SubjectsService;
  vectors: VectorIndex;
  usage: AiUsageService;
  queue: JobQueue;
  logger?: Pick<Logger, 'warn'>;
}

/**
 * Embeddings and the vector index (spec §4.6–4.7, §7 back-fill): embeds new passages as material is
 * processed, back-fills everything the moment a working embedding provider appears, re-indexes when
 * the model changes (vectors of two models are never compared), keeps the index's visibility in step
 * with the material, and rebuilds a lost index from the stored vectors without calling the provider.
 * Nothing here ever fails a material: without vectors it stays keyword-searchable.
 */
export class IndexingService {
  private readonly topicCache = new Map<string, { id: string; vector: number[] }[]>();
  /** Waits between provider retries (tests replace it). */
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  constructor(private readonly d: IndexingDeps) {}

  /** Pipeline hook: replaces a material's vectors with ones for its current passages. */
  async embedMaterial(materialId: Types.ObjectId) {
    try {
      await this.d.vectors.deleteMaterial(String(materialId));
      const rt = await this.d.ai.runtime();
      if (!rt.embedding) return await this.afterBudget(rt);
      const most = Math.ceil((await ContentChunkModel.countDocuments({ materialId })) / EMBED_BATCH) + 1;
      for (let i = 0; i < most; i++) {
        if (!(await this.embedBatch(rt.embedding, { materialId }))) break;
        // The month's budget ran out part-way: the rest waits for the back-fill next month.
        if (await this.d.ai.budgetExhausted()) return await this.scheduleBackfill(untilNextMonth());
      }
    } catch (e) {
      await this.failed(e);
    }
  }

  /** Queues a back-fill for the current college (deduplicated within a few seconds). */
  async scheduleBackfill(delayMs = 0, rebuild = false) {
    const tenantId = String(requireTenantId());
    const slot = Math.floor((Date.now() + delayMs) / 15_000);
    await this.d.queue.enqueue(
      EMBED_JOB,
      { tenantId, rebuild },
      { jobId: `embed-${tenantId}-${rebuild ? 'r' : 'b'}-${slot}`, ...(delayMs > 0 ? { delayMs } : {}) },
    );
  }

  /** The back-fill job: one run per college at a time (a lease), in slices. */
  async runBackfill(data: TenantJob) {
    const owner = new Types.ObjectId().toHexString();
    if (!(await this.lease(owner))) {
      await this.scheduleBackfill(60_000, data.rebuild === true);
      return;
    }
    let more = false;
    try {
      const rt = await this.d.ai.runtime();
      if (!rt.embedding) return await this.afterBudget(rt);
      const emb = rt.embedding;
      await this.d.vectors.deleteOtherModels(emb.signature);
      await this.restore(emb.signature, data.rebuild === true);
      const started = Date.now();
      while (await this.embedBatch(emb, {})) {
        if (await this.d.ai.budgetExhausted()) {
          await this.scheduleBackfill(untilNextMonth());
          break;
        }
        if (Date.now() - started > SLICE_MS) {
          more = true;
          break;
        }
        await AiSettingsModel.updateOne(
          { 'indexing.owner': owner },
          { $set: { 'indexing.until': new Date(Date.now() + LEASE_MS) } },
        );
      }
      await AiSettingsModel.updateOne(
        {},
        { $set: { 'indexing.lastRunAt': new Date(), 'indexing.lastError': null } },
      );
    } catch (e) {
      await this.failed(e);
    } finally {
      await AiSettingsModel.updateOne(
        { 'indexing.owner': owner },
        { $set: { 'indexing.owner': null, 'indexing.until': null } },
      );
    }
    if (more) await this.scheduleBackfill();
  }

  /** Embedding stopped because the month's budget is used: resume when the next month starts. */
  private async afterBudget(rt: AiRuntime) {
    if (rt.budget.exhausted) await this.scheduleBackfill(untilNextMonth());
  }

  /** Admin: rebuild the index from the stored vectors, then embed whatever is missing. */
  async reindex(viewer: AuthState, meta: RequestMetaLite): Promise<AiIndexView> {
    const rt = await this.d.ai.runtime();
    if (!rt.embedding) throw conflict('Semantic search is not set up: choose an embedding provider first');
    await audit.record(
      {
        action: 'ai.reindex_started',
        actorId: viewer.userId,
        targetType: 'ai_settings',
        meta: { model: rt.embedding.signature },
      },
      meta,
    );
    await this.scheduleBackfill(0, true);
    return this.progress();
  }

  async progress(): Promise<AiIndexView> {
    const rt = await this.d.ai.runtime();
    const sig = rt.embedding?.signature ?? null;
    const [total, embedded, failed, s] = await Promise.all([
      ContentChunkModel.countDocuments({}),
      sig ? ContentChunkModel.countDocuments({ embeddingStatus: 'embedded', embeddingModel: sig }) : 0,
      sig ? ContentChunkModel.countDocuments({ embeddingStatus: 'failed', embeddingModel: sig }) : 0,
      AiSettingsModel.findOne().select('indexing').lean<Pick<AiSettingsDoc, 'indexing'>>(),
    ]);
    const until = s?.indexing?.until;
    return {
      semantic: !!sig,
      model: sig,
      store: this.d.vectors.store.id,
      total,
      embedded,
      failed,
      pending: Math.max(0, total - embedded - failed),
      running: !!until && until > new Date(),
      lastRunAt: s?.indexing?.lastRunAt?.toISOString() ?? null,
      lastError: s?.indexing?.lastError ?? null,
    };
  }

  /** Passages, and passages with a vector of model `signature`, per subject (Admin › AI assistant). */
  async coverage(signature: string | null): Promise<Map<string, { passages: number; embedded: number }>> {
    const rows = await ContentChunkModel.aggregate<{
      _id: Types.ObjectId;
      passages: number;
      embedded: number;
    }>([
      {
        $group: {
          _id: '$subjectId',
          passages: { $sum: 1 },
          embedded: {
            $sum: {
              $cond: [
                {
                  $and: [{ $eq: ['$embeddingStatus', 'embedded'] }, { $eq: ['$embeddingModel', signature] }],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    return new Map(rows.map(({ _id, ...r }) => [String(_id), r]));
  }

  /** Material hook: published, sent back or taken down. The search also re-checks, so a failure here is only logged. */
  async materialVisibility(materialId: Types.ObjectId, visibility: MaterialVisibility) {
    await this.d.vectors.setVisibility(String(materialId), visibility).catch((e: unknown) => this.warn(e));
  }

  /** Material hook: deleted (its passages are already gone, so a stale vector can never be returned). */
  async materialRemoved(materialId: Types.ObjectId) {
    await this.d.vectors.deleteMaterial(String(materialId)).catch((e: unknown) => this.warn(e));
  }

  // ── Internals ─────────────────────────────
  private warn(e: unknown) {
    this.d.logger?.warn({ err: e instanceof Error ? e.message : 'unknown' }, 'vector index update failed');
  }

  private async lease(owner: string): Promise<boolean> {
    const now = new Date();
    try {
      const r = await AiSettingsModel.updateOne(
        { $or: [{ 'indexing.until': null }, { 'indexing.until': { $lt: now } }] },
        { $set: { 'indexing.owner': owner, 'indexing.until': new Date(now.getTime() + LEASE_MS) } },
        { upsert: true },
      );
      return r.modifiedCount + r.upsertedCount === 1;
    } catch {
      // The college's settings exist and another run holds the lease (the upsert hit the unique key).
      return false;
    }
  }

  /** Re-sends stored vectors to the store when it has fewer than we do (or when asked to). */
  private async restore(model: string, force: boolean) {
    const stored = await ContentChunkModel.countDocuments({
      embeddingStatus: 'embedded',
      embeddingModel: model,
    });
    if (!stored || (!force && (await this.d.vectors.count(model)) >= stored)) return;
    let after: Types.ObjectId | null = null;
    for (;;) {
      const points = await storedVectors({ model, after, limit: RESTORE_BATCH });
      if (!points.length) return;
      await this.d.vectors.upsert(points);
      after = oid(points[points.length - 1]?.id ?? '');
      if (points.length < RESTORE_BATCH) return;
    }
  }

  private async withRetry(fn: () => Promise<EmbedResult>): Promise<EmbedResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof ProviderError) || !e.retryable || attempt >= 3) throw e;
        await this.sleep(e.retryAfterMs ?? 1000 * 2 ** attempt);
      }
    }
  }

  /** Embeds up to one batch of passages without a vector of this model; returns how many it handled. */
  private async embedBatch(emb: ActiveEmbedding, filter: Record<string, unknown>): Promise<number> {
    const rows = await ContentChunkModel.find({
      ...filter,
      $nor: [{ embeddingStatus: { $in: ['embedded', 'failed'] }, embeddingModel: emb.signature }],
    })
      .sort({ _id: 1 })
      .limit(EMBED_BATCH)
      .select('_id subjectId materialId unitId topicIds visibility text heading')
      .lean<ChunkRow[]>();
    if (!rows.length) return 0;
    const mats = new Map(
      (
        await MaterialModel.find({
          _id: { $in: [...new Set(rows.map((r) => String(r.materialId)))].map(oid) },
        })
          .select('title type')
          .lean<Pick<MaterialDoc, '_id' | 'title' | 'type'>[]>()
      ).map((m) => [String(m._id), m]),
    );
    const vectors = await this.embedAll(
      emb,
      rows.map((r) => embedText(mats.get(String(r.materialId))?.title ?? '', r.heading ?? '', r.text)),
    );
    // Passages the provider will never accept (too long, unreadable) stay keyword-only.
    const refused = rows.filter((_, i) => !vectors[i]).map((r) => r._id);
    if (refused.length)
      await ContentChunkModel.updateMany(
        { _id: { $in: refused } },
        { $set: { embeddingStatus: 'failed', embeddingModel: emb.signature } },
      );

    const topics = await this.topicVectors(emb, [...new Set(rows.map((r) => String(r.subjectId)))]);
    const now = new Date();
    const points: Parameters<VectorIndex['upsert']>[0] = [];
    for (const [i, r] of rows.entries()) {
      const vector = vectors[i];
      if (!vector) continue;
      const tags = (r.topicIds ?? []).map(String);
      const best = closest(vector, topics.get(String(r.subjectId)) ?? []);
      if (best && !tags.includes(best)) tags.push(best);
      const w = await ContentChunkModel.updateOne(
        { _id: r._id },
        {
          $set: {
            vector: toBytes(vector),
            embeddingStatus: 'embedded',
            embeddingModel: emb.signature,
            embeddedAt: now,
            topicIds: tags.map(oid),
          },
        },
      );
      // Re-chunked meanwhile: the passage is gone, so its vector must not be indexed.
      if (!w.matchedCount) continue;
      points.push({
        id: String(r._id),
        vector,
        payload: {
          subjectId: String(r.subjectId),
          materialId: String(r.materialId),
          materialType: (mats.get(String(r.materialId))?.type ?? 'pdf') as MaterialType,
          unitId: r.unitId ? String(r.unitId) : null,
          topicIds: tags,
          visibility: r.visibility as MaterialVisibility,
          model: emb.signature,
        },
      });
    }
    await this.d.vectors.upsert(points);
    // A review or takedown may have landed while we embedded: bring those vectors in line.
    const current = await MaterialModel.find({ _id: { $in: [...mats.keys()].map(oid) } })
      .select('visibility')
      .lean<Pick<MaterialDoc, '_id' | 'visibility'>[]>();
    for (const m of current)
      if (points.some((p) => p.payload.materialId === String(m._id) && p.payload.visibility !== m.visibility))
        await this.d.vectors.setVisibility(String(m._id), m.visibility as MaterialVisibility);
    return rows.length;
  }

  /**
   * Embeds texts, one vector (or null when refused) per text. A batch the provider rejects is split
   * until the passage it objects to is found, after a one-word probe proves the model itself works
   * (a wrong model name must stop the run, not mark every passage refused).
   */
  private async embedAll(
    emb: ActiveEmbedding,
    texts: string[],
    probed = false,
  ): Promise<(number[] | null)[]> {
    try {
      const res = await this.withRetry(() => emb.provider.embed(texts, emb.model));
      await this.d.usage.record({
        kind: 'embedding',
        model: emb.signature,
        platform: emb.platform,
        userId: null,
        inputTokens: res.tokens,
      });
      const dims = res.vectors[0]?.length ?? 0;
      if (res.vectors.length !== texts.length || !dims) return texts.map(() => null);
      return res.vectors.map((v) => (v.length === dims && v.every(Number.isFinite) ? v : null));
    } catch (e) {
      if (!(e instanceof ProviderError) || e.kind !== 'bad_request') throw e;
      if (!probed) await this.withRetry(() => emb.provider.embed(['probe'], emb.model));
      if (texts.length === 1) return [null];
      const mid = Math.ceil(texts.length / 2);
      return [
        ...(await this.embedAll(emb, texts.slice(0, mid), true)),
        ...(await this.embedAll(emb, texts.slice(mid), true)),
      ];
    }
  }

  /** Each subject's topics as vectors (title and keywords), cached per model and syllabus. */
  private async topicVectors(emb: ActiveEmbedding, subjectIds: string[]) {
    const out = new Map<string, { id: string; vector: number[] }[]>();
    for (const sid of subjectIds) {
      const topics = await this.d.subjects.topicsOf(oid(sid));
      if (!topics.length) continue;
      const texts = topics.map((t) => [t.title, ...t.keywords].join('. '));
      const key = `${String(requireTenantId())}|${sid}|${emb.signature}|${topics.map((t) => t.id).join(',')}|${texts.join('|')}`;
      let vecs = this.topicCache.get(key);
      if (!vecs) {
        const res = await this.withRetry(() => emb.provider.embed(texts, emb.model));
        await this.d.usage.record({
          kind: 'embedding',
          model: emb.signature,
          platform: emb.platform,
          userId: null,
          inputTokens: res.tokens,
        });
        vecs = topics.map((t, i) => ({ id: t.id, vector: res.vectors[i] ?? [] }));
        if (this.topicCache.size > 200) this.topicCache.clear();
        this.topicCache.set(key, vecs);
      }
      out.set(sid, vecs);
    }
    return out;
  }

  private async failed(e: unknown) {
    const message =
      e instanceof ProviderError
        ? e.message
        : 'The vector store did not answer; semantic search will catch up';
    await AiSettingsModel.updateOne({}, { $set: { 'indexing.lastError': message.slice(0, 300) } });
    if (e instanceof ProviderError && e.kind === 'auth') {
      await this.d.ai.keyRejected('embedding', e.message);
      return;
    }
    this.warn(e);
    await this.scheduleBackfill(RETRY_LATER_MS);
  }
}

/** Milliseconds until a minute after the next month starts (UTC), when the budget is fresh. */
const untilNextMonth = () => nextMonth().getTime() - Date.now() + 60_000;

/** The topic whose vector is closest to the passage's, when close enough. */
function closest(vector: number[], topics: { id: string; vector: number[] }[]): string | null {
  let best: string | null = null;
  let score = TOPIC_SIMILARITY;
  for (const t of topics) {
    const s = cosine(vector, t.vector);
    if (s >= score) {
      score = s;
      best = t.id;
    }
  }
  return best;
}
