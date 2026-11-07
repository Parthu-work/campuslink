import { createHash } from 'node:crypto';
import type { Types } from 'mongoose';
import {
  COPILOT_INDEXED_KINDS,
  COPILOT_INDEX_HOUR_IST,
  graphDay,
  type CopilotIndexedKind,
} from '@campuslink/shared';
import { requireTenantId } from '../../lib/context.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { Logger } from '../../lib/logger.js';
import { TenantModel } from '../tenants/tenant.model.js';
import type { AiSettingsService } from '../study/ai-settings.service.js';
import type { AiUsageService } from '../study/ai-usage.service.js';
import type { VectorIndex } from '../study/vector/store.js';
import { fromBytes, toBytes } from '../study/indexing.service.js';
import { CopilotChunkModel, type CopilotChunkDoc } from './copilot.model.js';

export const COPILOT_INDEX_JOB = 'copilot.index';
const IST_MS = 5.5 * 3600_000;
const PART_CHARS = 1200;
const EMBED_BATCH = 32;

/** One source as the owning module returns it (text only; no member data). */
export interface CopilotSourceText {
  sourceId: string;
  companyKey: string | null;
  title: string;
  text: string;
  href: string;
}

/** Every source comes from the module that owns it (modules talk through services). */
export interface CopilotIndexDeps {
  logger: Logger;
  ai: AiSettingsService;
  usage: AiUsageService;
  vectors: VectorIndex;
  sources: Record<CopilotIndexedKind, () => Promise<CopilotSourceText[]>>;
}

/**
 * The scope id of one kind of copilot source in the college in context: the vector store's
 * required subject filter, so a copilot search sees only copilot vectors of the kinds asked for,
 * and only this college's (the store still takes the tenant from the context).
 */
export function copilotScope(kind: CopilotIndexedKind): string {
  return createHash('sha256')
    .update(`copilot:${String(requireTenantId())}:${kind}`)
    .digest('hex')
    .slice(0, 24);
}

/** Splits a source into parts of at most PART_CHARS on line breaks (a long line is cut). */
export function parts(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const raw of text.split('\n')) {
    const line = raw.slice(0, PART_CHARS);
    if (cur && cur.length + line.length + 1 > PART_CHARS) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur.trim()) out.push(cur);
  return out.length ? out : [''];
}

/**
 * The Career Copilot's index (prompt 2, G11). From 03:00 India time, one job per college and day
 * (after the Placement Graph's run) turns the college-wide sources into passages, keeps unchanged
 * ones as they are, embeds new or changed ones with the college's embedding model (usage recorded
 * under the `copilot` feature) and keeps the vector store in step. Without an embedding model the
 * passages are still searched by their words.
 */
export class CopilotIndexService {
  /** Colleges whose vectors this process re-sent to the store since it started. */
  private readonly restored = new Set<string>();

  constructor(private readonly d: CopilotIndexDeps) {}

  static async enqueueDaily(jobs: JobQueue, now = new Date()): Promise<number> {
    if (new Date(now.getTime() + IST_MS).getUTCHours() < COPILOT_INDEX_HOUR_IST) return 0;
    const day = graphDay(now);
    const tenants = await TenantModel.find({ kind: 'college', status: 'active' }).select('_id').lean();
    for (const t of tenants)
      await jobs.enqueue(
        COPILOT_INDEX_JOB,
        { tenantId: String(t._id), day },
        { jobId: `copilot-${String(t._id)}-${day}` },
      );
    return tenants.length;
  }

  /** The daily run for the college in context. Idempotent. */
  async run(job: Partial<TenantJob> = {}): Promise<{ passages: number; embedded: number }> {
    const day = typeof job.day === 'string' ? job.day : graphDay();
    const seen = new Set<string>();
    for (const kind of COPILOT_INDEXED_KINDS) {
      const rows = await this.d.sources[kind]().catch((err: unknown) => {
        this.d.logger.warn({ err, kind }, 'copilot source failed; kept as it was');
        return null;
      });
      if (!rows) {
        // A failing source keeps yesterday's passages rather than losing them.
        for (const c of await CopilotChunkModel.find({ kind }).select('key').lean<{ key: string }[]>())
          seen.add(c.key);
        continue;
      }
      for (const s of rows)
        for (const [i, text] of parts(s.text).entries()) {
          const key = `${kind}:${s.sourceId}:${i}`;
          seen.add(key);
          const hash = createHash('sha1').update(`${s.title}\n${text}\n${s.href}`).digest('hex');
          const cur = await CopilotChunkModel.findOne({ key }).select('hash').lean<{ hash: string }>();
          if (cur?.hash === hash) {
            await CopilotChunkModel.updateOne({ key }, { $set: { day } });
            continue;
          }
          await CopilotChunkModel.updateOne(
            { key },
            {
              $set: {
                key,
                kind,
                sourceId: s.sourceId,
                companyKey: s.companyKey,
                title: s.title.slice(0, 200),
                text: text.slice(0, 4000),
                href: s.href,
                hash,
                vector: null,
                embeddingModel: null,
                day,
              },
            },
            { upsert: true },
          );
        }
    }
    // Sources that went away: their passages and vectors go too.
    const gone = await CopilotChunkModel.find({ key: { $nin: [...seen] } })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();
    for (const g of gone) await this.d.vectors.deleteMaterial(String(g._id));
    await CopilotChunkModel.deleteMany({ _id: { $in: gone.map((g) => g._id) } });
    const embedded = await this.embed();
    return { passages: seen.size, embedded };
  }

  /** Embeds passages without a vector of the current model (in batches, within the budget). */
  private async embed(): Promise<number> {
    const rt = await this.d.ai.runtime();
    const emb = rt.embedding;
    if (!emb) return 0;
    let done = 0;
    for (;;) {
      if (await this.d.ai.budgetExhausted()) break;
      const batch = await CopilotChunkModel.find({ embeddingModel: { $ne: emb.signature } })
        .select('kind title text')
        .limit(EMBED_BATCH)
        .lean<CopilotChunkDoc[]>();
      if (!batch.length) break;
      let res: { vectors: number[][]; tokens: number };
      try {
        res = await emb.provider.embed(
          batch.map((c) => `${c.title}\n${c.text}`.slice(0, 4000)),
          emb.model,
        );
      } catch (err) {
        this.d.logger.warn(
          { err: err instanceof Error ? err.message : 'unknown' },
          'copilot embedding failed',
        );
        break;
      }
      await this.d.usage.record({
        kind: 'embedding',
        feature: 'copilot',
        model: emb.signature,
        platform: emb.platform,
        userId: null,
        inputTokens: res.tokens,
      });
      const points = batch.flatMap((c, i) => {
        const v = res.vectors[i];
        return v?.length ? [{ c, v }] : [];
      });
      await this.d.vectors.upsert(
        points.map(({ c, v }) => ({
          id: String(c._id),
          vector: v,
          payload: {
            subjectId: copilotScope(c.kind),
            materialId: String(c._id),
            materialType: `copilot_${c.kind}` as const,
            unitId: null,
            topicIds: [],
            visibility: 'published' as const,
            model: emb.signature,
          },
        })),
      );
      for (const { c, v } of points)
        await CopilotChunkModel.updateOne(
          { _id: c._id },
          { $set: { vector: toBytes(v), embeddingModel: emb.signature } },
        );
      done += points.length;
      if (points.length < batch.length) break;
    }
    return done;
  }

  /**
   * Re-sends this college's stored copilot vectors to the store once per process (an in-memory
   * store starts empty after a restart; the vectors themselves are kept on the passages).
   */
  async ensureRestored(model: string): Promise<void> {
    const key = `${String(requireTenantId())}:${model}`;
    if (this.restored.has(key)) return;
    this.restored.add(key);
    let after: Types.ObjectId | null = null;
    for (;;) {
      const rows: (CopilotChunkDoc & { vector: Buffer | null })[] = await CopilotChunkModel.find({
        embeddingModel: model,
        ...(after ? { _id: { $gt: after } } : {}),
      })
        .select('+vector kind')
        .sort({ _id: 1 })
        .limit(200)
        .lean();
      if (!rows.length) return;
      await this.d.vectors.upsert(
        rows.flatMap((c) => {
          const vector = fromBytes(c.vector);
          return vector.length
            ? [
                {
                  id: String(c._id),
                  vector,
                  payload: {
                    subjectId: copilotScope(c.kind),
                    materialId: String(c._id),
                    materialType: `copilot_${c.kind}` as const,
                    unitId: null,
                    topicIds: [],
                    visibility: 'published' as const,
                    model,
                  },
                },
              ]
            : [];
        }),
      );
      after = rows[rows.length - 1]?._id ?? null;
      if (rows.length < 200) return;
    }
  }

  // The index holds college-wide content only; members' data never enters it (no privacy hooks).
}
