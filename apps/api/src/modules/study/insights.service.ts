import { Types } from 'mongoose';
import {
  DEFAULT_EMBEDDING_MODEL,
  SMALL_CELL,
  suppress,
  type AiPrices,
  type AiUsageModelRow,
  type AiUsageView,
  type ChatFeedbackReason,
  type StudyInsightsView,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { ChatMessageModel, UnansweredQuestionModel, type UnansweredQuestionDoc } from './chat.model.js';
import { contentWords } from './ai/tokens.js';
import {
  monthStart,
  nextMonth,
  usageDay,
  type AiUsageService,
  type UsageTotals,
} from './ai-usage.service.js';
import type { AiSettingsService } from './ai-settings.service.js';
import type { IndexingService } from './indexing.service.js';
import type { MaterialsService } from './materials.service.js';
import type { SubjectsService } from './subjects.service.js';

const DAY_MS = 86_400_000;
/** At most this many unanswered questions are read for the content-gap words. */
const GAP_SAMPLE = 2000;
const TOP = 10;

export interface InsightsDeps {
  subjects: SubjectsService;
  materials: MaterialsService;
  ai: AiSettingsService;
  usage: AiUsageService;
  indexing: IndexingService;
}

const firstDay = (days: number) => usageDay(new Date(Date.now() - (days - 1) * DAY_MS));
const rate = (up: number, down: number) =>
  up + down >= SMALL_CELL ? Math.round((up / (up + down)) * 100) / 100 : null;

/** The cost of some usage at the admin's prices, or null when a needed price is missing. */
export function costOf(
  row: Pick<UsageTotals, 'model' | 'kind' | 'inputTokens' | 'outputTokens'>,
  p: AiPrices,
) {
  // The built-in demo costs nothing.
  if (row.model.startsWith('mock:')) return 0;
  const per = (tokens: number, price: number | null) =>
    price === null ? null : (tokens * price) / 1_000_000;
  if (row.kind === 'embedding') return per(row.inputTokens, p.embedding);
  if (row.kind === 'chat' || row.kind === 'rerank') {
    const i = per(row.inputTokens, p.chatInput);
    const o = per(row.outputTokens, p.chatOutput);
    return i === null || o === null ? null : i + o;
  }
  // Transcription is priced per minute, not per token: no estimate.
  return null;
}

/**
 * Aggregates only (spec §9-10, CLAUDE.md analytics rule): faculty insights for one subject and the
 * admin AI dashboard. Every count of members or of what they did goes through `suppress()`; no
 * question text, conversation or member is returned. Token totals are the college's, never a
 * member's, and content counts (materials, passages) are about the library, not about people.
 */
export class StudyInsightsService {
  constructor(private readonly d: InsightsDeps) {}

  // ── Faculty insights ─────────────────────────────
  async subject(viewer: AuthState, id: string, days: number): Promise<StudyInsightsView> {
    const s = await this.d.subjects.analysable(viewer, id);
    const sid = s._id;
    const since = new Date(Date.now() - days * DAY_MS);
    const match = { role: 'assistant', superseded: false, subjectIds: sid, createdAt: { $gte: since } };
    const tree = await this.d.subjects.syllabus(viewer, id);
    const topicTitle = new Map<string, { title: string; unitId: string; unitTitle: string }>();
    for (const u of tree.units)
      for (const t of u.topics) topicTitle.set(t.id, { title: t.title, unitId: u.id, unitTitle: u.title });

    const [totals, topics, units, cited, reasons, views] = await Promise.all([
      ChatMessageModel.aggregate<{
        questions: number;
        students: number;
        answered: number;
        notCovered: number;
        up: number;
        down: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: null,
            questions: { $sum: 1 },
            users: { $addToSet: '$userId' },
            answered: { $sum: { $cond: ['$grounded', 1, 0] } },
            notCovered: { $sum: { $cond: [{ $eq: ['$result.kind', 'not_covered'] }, 1, 0] } },
            up: { $sum: { $cond: [{ $eq: ['$feedback.rating', 'up'] }, 1, 0] } },
            down: { $sum: { $cond: [{ $eq: ['$feedback.rating', 'down'] }, 1, 0] } },
          },
        },
        {
          $project: {
            _id: 0,
            students: { $size: '$users' },
            questions: 1,
            answered: 1,
            notCovered: 1,
            up: 1,
            down: 1,
          },
        },
      ]),
      ChatMessageModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: match },
        { $unwind: '$topicIds' },
        { $group: { _id: '$topicIds', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 200 },
      ]),
      ChatMessageModel.aggregate<{ _id: Types.ObjectId; n: number; students: number }>([
        { $match: match },
        { $unwind: '$unitIds' },
        { $group: { _id: '$unitIds', n: { $sum: 1 }, users: { $addToSet: '$userId' } } },
        { $project: { n: 1, students: { $size: '$users' } } },
      ]),
      // Answers that cited each material (a material cited twice in one answer counts once).
      ChatMessageModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: match },
        { $unwind: '$citations' },
        { $match: { 'citations.subjectId': sid } },
        { $group: { _id: { m: '$_id', material: '$citations.materialId' } } },
        { $group: { _id: '$_id.material', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 50 },
      ]),
      ChatMessageModel.aggregate<{ _id: ChatFeedbackReason | null; n: number }>([
        { $match: { ...match, 'feedback.rating': 'down' } },
        { $group: { _id: '$feedback.reason', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      this.d.materials.viewCounts(sid, firstDay(days)),
    ]);
    const t = totals[0] ?? { questions: 0, students: 0, answered: 0, notCovered: 0, up: 0, down: 0 };

    // Most used material: cited in answers, or opened.
    const usedIds = [...new Set([...cited.map((c) => String(c._id)), ...views.keys()])];
    const titles = await this.d.materials.titles(usedIds);
    const citedBy = new Map(cited.map((c) => [String(c._id), c.n]));
    // Views per unit: the material's unit, or the unit of its first tagged topic.
    const unitViews = new Map<string, number>();
    for (const [m, n] of views) {
      const info = titles.get(m);
      const unit = info?.unitId ?? topicTitle.get(info?.topicIds[0] ?? '')?.unitId;
      if (unit) unitViews.set(unit, (unitViews.get(unit) ?? 0) + n);
    }
    const materials = usedIds
      .filter((m) => titles.has(m))
      .map((m) => ({ id: m, cited: citedBy.get(m) ?? 0, views: views.get(m) ?? 0 }))
      .sort((a, b) => b.cited + b.views - (a.cited + a.views))
      .slice(0, TOP)
      .map((m) => {
        const info = titles.get(m.id) as {
          title: string;
          type: StudyInsightsView['materials'][number]['type'];
        };
        return {
          id: m.id,
          title: info.title,
          type: info.type,
          cited: suppress(m.cited),
          views: suppress(m.views),
        };
      });

    const unitRows = new Map(units.map((u) => [String(u._id), u]));
    return {
      subjectId: String(sid),
      days,
      generatedAt: new Date().toISOString(),
      questions: suppress(t.questions),
      students: suppress(t.students),
      answered: suppress(t.answered),
      notCovered: suppress(t.notCovered),
      feedback: {
        up: suppress(t.up),
        down: suppress(t.down),
        helpfulRate: rate(t.up, t.down),
        reasons: reasons
          .filter((r): r is { _id: ChatFeedbackReason; n: number } => !!r._id)
          .map((r) => ({ reason: r._id, count: suppress(r.n) })),
      },
      topics: topics
        .filter((x) => topicTitle.has(String(x._id)))
        .slice(0, TOP)
        .map((x) => {
          const info = topicTitle.get(String(x._id));
          return {
            topicId: String(x._id),
            title: info?.title ?? '',
            unitTitle: info?.unitTitle ?? '',
            questions: suppress(x.n),
          };
        }),
      gaps: await this.gaps(sid, since, topicTitle),
      materials,
      units: tree.units.map((u) => ({
        unitId: u.id,
        title: u.title,
        questions: suppress(unitRows.get(u.id)?.n ?? 0),
        students: suppress(unitRows.get(u.id)?.students ?? 0),
        views: suppress(unitViews.get(u.id) ?? 0),
      })),
    };
  }

  /**
   * Content gaps: syllabus topics that questions the material did not cover were near, and, for
   * questions near no topic, the words at least SMALL_CELL different students asked about (so no
   * single student's question can be read back). Never the questions themselves.
   */
  private async gaps(
    sid: Types.ObjectId,
    since: Date,
    topicTitle: Map<string, { title: string; unitId: string; unitTitle: string }>,
  ): Promise<StudyInsightsView['gaps']> {
    const topicIds = [...topicTitle.keys()].map((x) => new Types.ObjectId(x));
    const byTopic = await UnansweredQuestionModel.aggregate<{
      _id: Types.ObjectId;
      n: number;
      students: number;
    }>([
      { $match: { createdAt: { $gte: since }, $or: [{ subjectId: sid }, { topicIds: { $in: topicIds } }] } },
      { $unwind: '$topicIds' },
      { $match: { topicIds: { $in: topicIds } } },
      { $group: { _id: '$topicIds', n: { $sum: 1 }, users: { $addToSet: '$userId' } } },
      { $project: { n: 1, students: { $size: '$users' } } },
      { $sort: { n: -1 } },
      { $limit: TOP },
    ]);
    const out: StudyInsightsView['gaps'] = byTopic.map((g) => {
      const info = topicTitle.get(String(g._id));
      return {
        topicId: String(g._id),
        unitId: info?.unitId ?? null,
        title: info?.title ?? '',
        questions: suppress(g.n),
        students: suppress(g.students),
      };
    });

    const loose = await UnansweredQuestionModel.find({
      subjectId: sid,
      createdAt: { $gte: since },
      topicIds: { $size: 0 },
    })
      .sort({ createdAt: -1 })
      .limit(GAP_SAMPLE)
      .select('userId text')
      .lean<Pick<UnansweredQuestionDoc, 'userId' | 'text'>[]>();
    // Counted by stem ("grammars" and "grammar" together), shown in the form asked most often.
    const words = new Map<string, { n: number; users: Set<string>; forms: Map<string, number> }>();
    for (const q of loose) {
      const seen = new Set<string>();
      for (const raw of q.text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []) {
        const key = contentWords(raw)[0];
        if (!key || raw.length < 4 || /^\d+$/.test(raw)) continue;
        const e = words.get(key) ?? { n: 0, users: new Set<string>(), forms: new Map<string, number>() };
        e.forms.set(raw, (e.forms.get(raw) ?? 0) + 1);
        if (!seen.has(key)) {
          seen.add(key);
          e.n++;
          e.users.add(String(q.userId));
        }
        words.set(key, e);
      }
    }
    const common = [...words.values()]
      .filter((e) => e.users.size >= SMALL_CELL)
      .sort((a, b) => b.users.size - a.users.size)
      .slice(0, TOP - Math.min(out.length, TOP / 2));
    for (const e of common) {
      const [title = ''] = [...e.forms.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
      out.push({
        topicId: null,
        unitId: null,
        title,
        questions: suppress(e.n),
        students: suppress(e.users.size),
      });
    }
    return out;
  }

  // ── Admin AI dashboard ─────────────────────────────
  async dashboard(days: number): Promise<AiUsageView> {
    const rt = await this.d.ai.runtime();
    const s = rt.settings;
    const from = firstDay(days);
    const month = monthStart();
    const since = new Date(Date.now() - days * DAY_MS);
    const [period, monthRows, used, answers, processing, index, briefs] = await Promise.all([
      this.d.usage.totalsSince(from),
      this.d.usage.totalsSince(month),
      this.d.usage.monthTokens(),
      ChatMessageModel.aggregate<{ total: number; failed: number; refused: number; notCovered: number }>([
        { $match: { role: 'assistant', superseded: false, createdAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            refused: { $sum: { $cond: [{ $eq: ['$status', 'refused'] }, 1, 0] } },
            notCovered: { $sum: { $cond: [{ $eq: ['$result.kind', 'not_covered'] }, 1, 0] } },
          },
        },
      ]),
      this.d.materials.processing(),
      this.d.indexing.progress(),
      this.d.subjects.briefs(),
    ]);

    const series = new Map<string, AiUsageView['series'][number] & { n: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const day = usageDay(new Date(Date.now() - i * DAY_MS));
      series.set(day, { day, chat: 0, embedding: 0, other: 0, requests: 0, n: 0 });
    }
    const byModel = new Map<string, UsageTotals>();
    for (const r of period) {
      const d = series.get(r.day);
      const tokens = r.inputTokens + r.outputTokens;
      if (d) {
        if (r.kind === 'chat') d.chat += tokens;
        else if (r.kind === 'embedding') d.embedding += tokens;
        else d.other += tokens;
        d.n += r.requests;
      }
      const key = `${r.kind}|${r.model}`;
      const m = byModel.get(key) ?? { ...r, requests: 0, inputTokens: 0, outputTokens: 0 };
      m.requests += r.requests;
      m.inputTokens += r.inputTokens;
      m.outputTokens += r.outputTokens;
      byModel.set(key, m);
    }
    const models: AiUsageModelRow[] = [...byModel.values()]
      .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
      .map((m) => ({
        model: m.model,
        kind: m.kind,
        requests: suppress(m.requests),
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cost: costOf(m, s.prices),
      }));
    const total = (rows: { cost: number | null }[]) =>
      rows.some((r) => r.cost !== null) ? rows.reduce((n, r) => n + (r.cost ?? 0), 0) : null;
    const monthCosts = monthRows.map((r) => ({ cost: costOf(r, s.prices) }));
    const a = answers[0] ?? { total: 0, failed: 0, refused: 0, notCovered: 0 };
    const paused = this.d.ai.answersPausedUntil(rt);

    const signature = s.embeddingProvider
      ? `${s.embeddingProvider}:${s.embeddingModel || DEFAULT_EMBEDDING_MODEL[s.embeddingProvider]}`
      : null;
    const chunks = await this.d.indexing.coverage(signature);
    const coverage = briefs
      .filter((b) => b.status !== 'archived' || processing.bySubject.has(b.id))
      .map((b) => {
        const m = processing.bySubject.get(b.id);
        const c = chunks.get(b.id);
        return {
          subjectId: b.id,
          name: b.name,
          code: b.code,
          materials: m?.materials ?? 0,
          indexed: m?.indexed ?? 0,
          processing: m?.processing ?? 0,
          failed: m?.failed ?? 0,
          passages: c?.passages ?? 0,
          embedded: c?.embedded ?? 0,
        };
      });

    const limit = s.monthlyTokenBudget;
    return {
      days,
      series: [...series.values()].map(({ n, ...d }) => ({ ...d, requests: suppress(n) })),
      month: {
        month: month.slice(0, 7),
        used,
        budget: limit,
        percent: limit > 0 ? Math.min(999, Math.round((used / limit) * 100)) : null,
        exhausted: limit > 0 && used >= limit,
        resetsAt: nextMonth().toISOString(),
      },
      models,
      cost: {
        currency: s.prices.currency,
        period: total(models),
        month: total(monthCosts),
        priced: s.prices.chatInput !== null || s.prices.chatOutput !== null || s.prices.embedding !== null,
      },
      answers: {
        total: suppress(a.total),
        failed: suppress(a.failed),
        refused: suppress(a.refused),
        notCovered: suppress(a.notCovered),
      },
      lastError:
        s.health.lastError && s.health.lastErrorAt
          ? { message: s.health.lastError, at: s.health.lastErrorAt.toISOString() }
          : null,
      breaker: { open: !!paused, until: paused?.toISOString() ?? null },
      queue: {
        processing: processing.processing,
        failed: processing.failed,
        oldestWaitingMin: processing.oldestWaiting
          ? Math.max(0, Math.round((Date.now() - processing.oldestWaiting.getTime()) / 60_000))
          : null,
        embeddingsPending: signature
          ? [...chunks.values()].reduce((n, c) => n + c.passages - c.embedded, 0)
          : 0,
        embeddingsRunning: index.running,
      },
      coverage,
    };
  }
}
