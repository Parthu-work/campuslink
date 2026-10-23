import { Types } from 'mongoose';
import type { MaterialType, StudySearchHit } from '@campuslink/shared';
import { notFound } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { withTextSearch } from '../../db/search.js';
import {
  ContentChunkModel,
  MaterialModel,
  type ContentChunkDoc,
  type MaterialDoc,
} from './material.model.js';
import { ProviderError } from './ai/provider.js';
import { contentWords } from './ai/tokens.js';
import { LlmReranker } from './ai/rerank.js';
import type { AiSettingsService } from './ai-settings.service.js';
import type { AiUsageService } from './ai-usage.service.js';
import type { SubjectsService } from './subjects.service.js';
import type { VectorHit, VectorIndex } from './vector/store.js';
import { snippet } from './materials.service.js';
import type { AuthState } from '../../types.js';

/** The keyword half's time limit when search by meaning can answer instead (MongoDB maxTimeMS). */
export const KEYWORD_BUDGET_MS = 200;
/** Reciprocal rank fusion constant (the usual 60: rank matters, raw scores do not). */
const RRF_K = 60;
/** Below this cosine similarity, and below the word coverage, retrieval is "not confident". */
export const MIN_SIMILARITY = 0.3;
/** Share of the question's content words found in the top passages that counts as covered. */
export const MIN_COVERAGE = 0.6;

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

export interface RetrieveInput {
  query: string;
  /** One subject (it must be readable, else 404); omitted: every subject the member reads. */
  subjectId?: string | undefined;
  unitId?: string | undefined;
  topicId?: string | undefined;
  materialTypes?: MaterialType[] | undefined;
  limit?: number | undefined;
  /**
   * Drop passages found only by meaning below this similarity (the search box: nearest neighbours
   * are always "somewhere", but unrelated ones are noise there). Chat keeps them and gates on
   * `confident` instead.
   */
  minSimilarity?: number | undefined;
}
export interface RetrievedPassage {
  chunkId: string;
  materialId: string;
  subjectId: string;
  title: string;
  type: MaterialType;
  page: number | null;
  startSec: number | null;
  endSec: number | null;
  heading: string;
  text: string;
  /** Syllabus tags of the passage (for the faculty's aggregate insights). */
  unitId: string | null;
  topicIds: string[];
  /** Fused rank score. */
  score: number;
  match: 'semantic' | 'keyword' | 'both';
  /** Cosine similarity when it was found by meaning. */
  similarity: number | null;
}
export interface Retrieval {
  passages: RetrievedPassage[];
  /** `keyword` when no embedding provider is ready (or it failed just now). */
  mode: 'hybrid' | 'keyword';
  similarity: number | null;
  coverage: number;
  /** Whether the material covers the question well enough to answer from it (spec §5). */
  confident: boolean;
}

export interface RetrievalDeps {
  subjects: SubjectsService;
  ai: AiSettingsService;
  vectors: VectorIndex;
  usage: AiUsageService;
  /** `llm` re-orders the fused passages with the college's chat model (`AI_RERANKER`). */
  reranker: 'none' | 'llm';
  logger?: Pick<Logger, 'warn'>;
}

/** The question's words for `$text`: letters and digits only (no operators), at most 100 characters. */
export function keywordTerm(query: string): string {
  let out = '';
  for (const w of new Set(query.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])) {
    if (w.length < 2) continue;
    if (out.length + w.length + 1 > 100) break;
    out = out ? `${out} ${w}` : w;
  }
  return out;
}

/** Share of the question's content words that appear in the texts (0 when it has none). */
export function coverage(query: string, texts: string[]): number {
  const want = [...new Set(contentWords(query))];
  if (!want.length) return 0;
  const have = new Set(contentWords(texts.join('\n')));
  return want.filter((w) => have.has(w)).length / want.length;
}

/**
 * Hybrid retrieval (spec §5): passages found by meaning (the vector index) and by their words (the
 * text index), merged with reciprocal rank fusion and optionally re-ranked. Only published material
 * in subjects the member reads is ever considered, and every passage is re-read from MongoDB with
 * those rules before it is returned, so a stale vector cannot leak anything. Without an embedding
 * provider (or when it fails) the same call is keyword-only.
 */
export class RetrievalService {
  constructor(private readonly d: RetrievalDeps) {}

  async retrieve(viewer: AuthState, input: RetrieveInput): Promise<Retrieval> {
    const readable = (await this.d.subjects.readableIds(viewer)).map(String);
    const scope = input.subjectId ? readable.filter((s) => s === input.subjectId) : readable;
    if (input.subjectId && !scope.length) throw notFound('Subject');
    const none: Retrieval = {
      passages: [],
      mode: 'keyword',
      similarity: null,
      coverage: 0,
      confident: false,
    };
    if (!scope.length) return none;
    const limit = Math.min(Math.max(input.limit ?? 8, 1), 30);
    const pool = Math.max(limit * 3, 24);
    const materialIds = input.materialTypes
      ? (
          await MaterialModel.find({
            subjectId: { $in: scope.map(oid) },
            type: { $in: input.materialTypes },
            visibility: 'published',
          })
            .select('_id')
            .lean<{ _id: Types.ObjectId }[]>()
        ).map((m) => String(m._id))
      : undefined;
    if (materialIds && !materialIds.length) return none;
    const filter: Record<string, unknown> = {
      subjectId: { $in: scope.map(oid) },
      visibility: 'published',
      ...(input.unitId ? { unitId: oid(input.unitId) } : {}),
      ...(input.topicId ? { topicIds: oid(input.topicId) } : {}),
      ...(materialIds ? { materialId: { $in: materialIds.map(oid) } } : {}),
    };

    const rt = await this.d.ai.runtime();
    const term = keywordTerm(input.query);
    // Words and meaning are searched at the same time; either may come back empty. With meaning
    // available, the word half has a time limit: a question whose words are in nearly every passage
    // (which MongoDB must then score one by one) falls back to the meaning results.
    const keywordQuery = () => {
      if (!term) return Promise.resolve<string[]>([]);
      const q = withTextSearch(ContentChunkModel.find(filter), term)
        .select({ score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(pool);
      if (rt.embedding) q.maxTimeMS(KEYWORD_BUDGET_MS);
      return q
        .lean<{ _id: Types.ObjectId }[]>()
        .then((rows) => rows.map((r) => String(r._id)))
        .catch((e: unknown) => {
          if ((e as { code?: number }).code !== 50 || !rt.embedding) throw e;
          this.d.logger?.warn('study search: keyword half over its time limit, meaning results only');
          return [];
        });
    };
    const keywordSearch = keywordQuery();
    const semanticSearch = async (): Promise<VectorHit[] | null> => {
      if (!rt.embedding) return null;
      try {
        const res = await rt.embedding.provider.embed([input.query.slice(0, 2000)], rt.embedding.model);
        await this.d.usage.record({
          kind: 'embedding',
          model: rt.embedding.signature,
          userId: viewer.userId,
          inputTokens: res.tokens,
        });
        const v = res.vectors[0];
        if (!v?.length) return null;
        return await this.d.vectors.search(
          v,
          {
            subjectIds: scope,
            model: rt.embedding.signature,
            unitId: input.unitId,
            topicId: input.topicId,
            materialIds,
            materialTypes: input.materialTypes,
          },
          pool,
        );
      } catch (e) {
        // Keyword-only for this question; a refused key is shown to the admin.
        if (e instanceof ProviderError && e.kind === 'auth')
          await this.d.ai.keyRejected('embedding', e.message);
        this.d.logger?.warn(
          { err: e instanceof Error ? e.message : 'unknown' },
          'semantic search unavailable',
        );
        return null;
      }
    };
    const [keyword, hits] = await Promise.all([keywordSearch, semanticSearch()]);
    const semantic: VectorHit[] = hits ?? [];
    const mode: Retrieval['mode'] = hits ? 'hybrid' : 'keyword';

    const fused = new Map<string, { score: number; similarity: number | null; vec: boolean; kw: boolean }>();
    const entry = (id: string) => {
      const have = fused.get(id) ?? { score: 0, similarity: null, vec: false, kw: false };
      fused.set(id, have);
      return have;
    };
    semantic.forEach((h, i) => {
      const e = entry(h.id);
      e.score += 1 / (RRF_K + i + 1);
      e.similarity = h.score;
      e.vec = true;
    });
    keyword.forEach((id, i) => {
      const e = entry(id);
      e.score += 1 / (RRF_K + i + 1);
      e.kw = true;
    });
    const ranked = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, pool);
    if (!ranked.length) return { ...none, mode };

    const rows = await ContentChunkModel.find({ ...filter, _id: { $in: ranked.map(([id]) => oid(id)) } })
      .select('subjectId materialId text heading page startSec endSec unitId topicIds')
      .lean<(ContentChunkDoc & { _id: Types.ObjectId })[]>();
    const byId = new Map(rows.map((r) => [String(r._id), r]));
    const mats = new Map(
      (
        await MaterialModel.find({
          _id: { $in: [...new Set(rows.map((r) => String(r.materialId)))].map(oid) },
          visibility: 'published',
        })
          .select('title type')
          .lean<Pick<MaterialDoc, '_id' | 'title' | 'type'>[]>()
      ).map((m) => [String(m._id), m]),
    );
    let passages: RetrievedPassage[] = [];
    for (const [id, f] of ranked) {
      const r = byId.get(id);
      const m = r && mats.get(String(r.materialId));
      if (!r || !m) continue;
      if (!f.kw && input.minSimilarity !== undefined && (f.similarity ?? 0) < input.minSimilarity) continue;
      passages.push({
        chunkId: id,
        materialId: String(r.materialId),
        subjectId: String(r.subjectId),
        title: m.title,
        type: m.type as MaterialType,
        page: r.page ?? null,
        startSec: r.startSec ?? null,
        endSec: r.endSec ?? null,
        heading: r.heading ?? '',
        text: r.text,
        unitId: r.unitId ? String(r.unitId) : null,
        topicIds: (r.topicIds ?? []).map(String),
        score: f.score,
        match: f.vec && f.kw ? 'both' : f.vec ? 'semantic' : 'keyword',
        similarity: f.similarity,
      });
    }

    if (this.d.reranker === 'llm' && rt.chat && passages.length > 1) {
      const head = passages.slice(0, limit * 2);
      const r = await new LlmReranker(rt.chat.provider, rt.chat.model).rerank(
        input.query,
        head.map((p) => ({ id: p.chunkId, text: p.text })),
      );
      if (r.tokens)
        await this.d.usage.record({
          kind: 'rerank',
          model: `${rt.chat.provider.id}:${rt.chat.model}`,
          userId: viewer.userId,
          inputTokens: r.tokens,
        });
      const at = new Map(r.ids.map((id, i) => [id, i]));
      passages = [
        ...head.sort((a, b) => (at.get(a.chunkId) ?? 0) - (at.get(b.chunkId) ?? 0)),
        ...passages.slice(head.length),
      ];
    }

    passages = passages.slice(0, limit);
    const sims = passages.map((p) => p.similarity).filter((s): s is number => s !== null);
    const similarity = sims.length ? Math.max(...sims) : null;
    const cover = coverage(
      input.query,
      passages.slice(0, 3).map((p) => `${p.title}\n${p.heading}\n${p.text}`),
    );
    return {
      passages,
      mode,
      similarity,
      coverage: cover,
      confident:
        passages.length > 0 &&
        ((similarity !== null && similarity >= MIN_SIMILARITY) || cover >= MIN_COVERAGE),
    };
  }

  /** The search box: hybrid retrieval as snippets that open the right page or moment. */
  async search(
    viewer: AuthState,
    q: {
      q: string;
      subjectId?: string | undefined;
      unitId?: string | undefined;
      topicId?: string | undefined;
    },
  ): Promise<StudySearchHit[]> {
    const r = await this.retrieve(viewer, {
      query: q.q,
      subjectId: q.subjectId,
      unitId: q.unitId,
      topicId: q.topicId,
      limit: 20,
      minSimilarity: MIN_SIMILARITY,
    });
    return r.passages.map((p) => ({
      chunkId: p.chunkId,
      materialId: p.materialId,
      subjectId: p.subjectId,
      title: p.title,
      type: p.type,
      page: p.page,
      startSec: p.startSec,
      snippet: snippet(p.text, q.q),
      match: p.match,
    }));
  }
}
