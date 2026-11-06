import { Types } from 'mongoose';
import {
  AI_FEATURE_LIMITS,
  COPILOT_HANDOFFS_MAX,
  COPILOT_INDEXED_KINDS,
  COPILOT_SOURCES_MAX,
  asksForPrediction,
  parseCopilotCommand,
  type CopilotAskInput,
  type CopilotCitation,
  type CopilotCommand,
  type CopilotHandoff,
  type CopilotHandoffKind,
  type CopilotHomeView,
  type CopilotIndexedKind,
  type CopilotMessageView,
  type CopilotResult,
  type CopilotSessionDetail,
  type CopilotSessionView,
  type CopilotSourceKind,
  type CopilotStreamEvent,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { notFound } from '../../lib/errors.js';
import { modelText, plainText } from '../../lib/text.js';
import type { Logger } from '../../lib/logger.js';
import { companyKey } from '../../lib/company.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import { withTextSearch } from '../../db/search.js';
import type { AiTasksService } from '../ai-tasks/ai-tasks.service.js';
import type { AiSettingsService } from '../study/ai-settings.service.js';
import type { AiUsageService } from '../study/ai-usage.service.js';
import type { VectorIndex } from '../study/vector/store.js';
import { coverage, keywordTerm, MIN_COVERAGE, MIN_SIMILARITY } from '../study/retrieval.service.js';
import { detectLanguage } from '../study/chat/prompt.js';
import { copilotScope, type CopilotIndexService } from './copilot-index.service.js';
import { citedNumbers, copilotAnswerTask, NOT_COVERED } from './copilot-task.js';
import {
  COPILOT_KEEP_DAYS,
  CopilotChunkModel,
  CopilotMessageModel,
  CopilotSessionModel,
  type CopilotChunkDoc,
  type CopilotMessageDoc,
  type CopilotSessionDoc,
} from './copilot.model.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const DAY = 86_400_000;
const RRF_K = 60;
const purgeAt = () => new Date(Date.now() + COPILOT_KEEP_DAYS * DAY);

/** A live source: the viewer's own facts, or an alumnus's mentor card (public fields only). */
export interface LiveSource {
  kind: Extract<CopilotSourceKind, 'mentor' | 'me'>;
  id: string;
  title: string;
  text: string;
  href: string;
  /** mentor: for the "Ask …" next step. */
  mentor?: { userId: string; name: string; company: string; replyHours: number | null };
}

/** What the copilot asks other modules, always with the viewer's rights (modules talk through services). */
export interface CopilotDeps {
  logger: Logger;
  aiTasks: AiTasksService;
  ai: AiSettingsService;
  usage: AiUsageService;
  vectors: VectorIndex;
  index: CopilotIndexService;
  /** Which of these indexed sources the viewer may read right now (re-checked on every answer). */
  readable: Record<CopilotIndexedKind, (viewer: AuthState, sourceIds: string[]) => Promise<Set<string>>>;
  /** The viewer's own facts (résumé, readiness, record, eligibility); `personal` false for minors. */
  me: (viewer: AuthState, personal: boolean) => Promise<LiveSource[]>;
  /** Mentor cards: alumni at the company, or (personal only) the viewer's best matches. */
  mentors: (
    viewer: AuthState,
    company: { key: string; name: string } | null,
    personal: boolean,
  ) => Promise<LiveSource[]>;
  /** Companies of the college's Placement Graph (to recognise one named in a question). */
  companies: () => Promise<{ key: string; name: string }[]>;
  eligibleDrives: (
    viewer: AuthState,
  ) => Promise<{ id: string; company: string; companyKey: string; title: string; closesAt: string }[]>;
  officeHours: (viewer: AuthState) => Promise<{ id: string; title: string; startsAt: string }[]>;
  plan: (viewer: AuthState) => Promise<Extract<CopilotResult, { kind: 'plan' }>>;
  isMinor: (userId: string) => Promise<boolean>;
}

interface Source {
  kind: CopilotSourceKind;
  id: string;
  title: string;
  text: string;
  href: string;
  similarity: number | null;
  mentor?: LiveSource['mentor'];
}

type Send = (e: CopilotStreamEvent) => void;

/**
 * The Career Copilot (prompt 2, G11). A question is answered only from numbered sources, each
 * checked for the viewer on every read: college-wide passages found by words and by meaning
 * (`VectorIndex`, the copilot's own scopes), the viewer's own facts and mentor cards read live.
 * Predictions and questions the sources do not cover get a refusal (E2); every answer ends with up
 * to two human next steps. The answer goes through `AiTasksService.stream` (E1); without AI the
 * best sources are shown, cited. Conversations are the member's own.
 */
export class CopilotService {
  track: Track = noTrack;
  constructor(private readonly d: CopilotDeps) {}

  // ── Conversations ─────────────────────────────

  private sessionView(s: CopilotSessionDoc): CopilotSessionView {
    return {
      id: String(s._id),
      title: s.title,
      lastMessageAt: s.lastMessageAt.toISOString(),
      messageCount: s.messageCount,
    };
  }
  private messageView(m: CopilotMessageDoc): CopilotMessageView {
    return {
      id: String(m._id),
      role: m.role,
      text: m.text,
      command: m.command,
      citations: m.citations,
      handoffs: m.handoffs,
      result: m.result,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
    };
  }

  async home(viewer: AuthState): Promise<CopilotHomeView> {
    const [rows, blocked, used] = await Promise.all([
      CopilotSessionModel.find({ userId: oid(viewer.userId) })
        .sort({ lastMessageAt: -1 })
        .limit(30)
        .lean<CopilotSessionDoc[]>(),
      this.d.aiTasks.unavailable(viewer, 'copilot'),
      this.d.usage.requestsTodayFor(viewer.userId, 'copilot'),
    ]);
    const limit = AI_FEATURE_LIMITS.copilot ?? 0;
    return {
      sessions: rows.map((s) => this.sessionView(s)),
      left: blocked && blocked !== 'daily_limit' ? null : Math.max(0, limit - used),
      ai: !blocked,
    };
  }

  private async owned(viewer: AuthState, id: string): Promise<CopilotSessionDoc> {
    const s = await CopilotSessionModel.findOne({
      _id: oid(id),
      userId: oid(viewer.userId),
    }).lean<CopilotSessionDoc>();
    if (!s) throw notFound('Conversation');
    return s;
  }

  async session(viewer: AuthState, id: string): Promise<CopilotSessionDetail> {
    const s = await this.owned(viewer, id);
    const messages = await CopilotMessageModel.find({ sessionId: s._id, userId: oid(viewer.userId) })
      .sort({ _id: 1 })
      .limit(200)
      .lean<CopilotMessageDoc[]>();
    return { ...this.sessionView(s), messages: messages.map((m) => this.messageView(m)) };
  }

  async removeSession(viewer: AuthState, id: string): Promise<void> {
    const s = await this.owned(viewer, id);
    await CopilotMessageModel.deleteMany({ sessionId: s._id, userId: oid(viewer.userId) });
    await CopilotSessionModel.deleteOne({ _id: s._id });
  }

  /** A human next step was opened (`copilot_handoff`); only the member's own answers count. */
  async handoff(viewer: AuthState, messageId: string, kind: CopilotHandoffKind): Promise<void> {
    const m = await CopilotMessageModel.findOne({
      _id: oid(messageId),
      userId: oid(viewer.userId),
      role: 'assistant',
      'handoffs.kind': kind,
    })
      .select('_id')
      .lean();
    if (!m) throw notFound('Next step');
    await this.track(viewer.userId, 'copilot_handoff', { kind });
  }

  // ── Sources ─────────────────────────────

  /** A company of the graph named in the text (the longest name that appears), or null. */
  private async companyIn(text: string): Promise<{ key: string; name: string } | null> {
    const words = ` ${companyKey(text)} `;
    let best: { key: string; name: string } | null = null;
    for (const c of await this.d.companies())
      if (c.key.length >= 3 && words.includes(` ${c.key} `) && (!best || c.key.length > best.key.length))
        best = c;
    return best;
  }

  /**
   * College-wide passages for a question: by words ($text) and by meaning (the copilot's scopes in
   * `VectorIndex`), fused, then re-read from MongoDB and kept only if the viewer may read their
   * source right now (each kind asks its owning module).
   */
  async retrieve(
    viewer: AuthState,
    query: string,
    kinds: readonly CopilotIndexedKind[],
    company: { key: string } | null,
  ): Promise<Source[]> {
    if (!kinds.length) return [];
    const pool = 24;
    const filter: Record<string, unknown> = { kind: { $in: [...kinds] } };
    const term = keywordTerm(query);
    const keyword = term
      ? withTextSearch(CopilotChunkModel.find(filter), term)
          .select({ score: { $meta: 'textScore' } })
          .sort({ score: { $meta: 'textScore' } })
          .limit(pool)
          .lean<{ _id: Types.ObjectId }[]>()
          .then((r) => r.map((x) => String(x._id)))
      : Promise.resolve<string[]>([]);
    const semantic = (async () => {
      const rt = await this.d.ai.runtime();
      const emb = rt.embedding;
      if (!emb) return [];
      try {
        await this.d.index.ensureRestored(emb.signature);
        const res = await emb.provider.embed([query.slice(0, 2000)], emb.model);
        await this.d.usage.record({
          kind: 'embedding',
          feature: 'copilot',
          model: emb.signature,
          platform: emb.platform,
          userId: viewer.userId,
          inputTokens: res.tokens,
        });
        const v = res.vectors[0];
        if (!v?.length) return [];
        return await this.d.vectors.search(
          v,
          {
            subjectIds: kinds.map(copilotScope),
            model: emb.signature,
            materialTypes: kinds.map((k) => `copilot_${k}` as const),
          },
          pool,
        );
      } catch (err) {
        this.d.logger.warn(
          { err: err instanceof Error ? err.message : 'unknown' },
          'copilot search by meaning unavailable',
        );
        return [];
      }
    })();
    const [kw, sem] = await Promise.all([keyword, semantic]);
    const fused = new Map<string, { score: number; similarity: number | null }>();
    const at = (id: string) => {
      const e = fused.get(id) ?? { score: 0, similarity: null };
      fused.set(id, e);
      return e;
    };
    sem.forEach((h, i) => {
      const e = at(h.id);
      e.score += 1 / (RRF_K + i + 1);
      e.similarity = h.score;
    });
    kw.forEach((id, i) => {
      at(id).score += 1 / (RRF_K + i + 1);
    });
    // The company named in the question: its own passages first.
    const own = company
      ? await CopilotChunkModel.find({ ...filter, companyKey: company.key })
          .select('_id')
          .limit(6)
          .lean<{ _id: Types.ObjectId }[]>()
      : [];
    for (const o of own) at(String(o._id)).score += 1;
    const ranked = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, pool);
    if (!ranked.length) return [];
    const rows = await CopilotChunkModel.find({ ...filter, _id: { $in: ranked.map(([id]) => oid(id)) } })
      .select('kind sourceId title text href')
      .lean<CopilotChunkDoc[]>();
    const byId = new Map(rows.map((r) => [String(r._id), r]));
    // Access, per kind, by the module that owns the source.
    const allowed = new Map<CopilotIndexedKind, Set<string>>();
    for (const kind of kinds) {
      const ids = [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.sourceId))];
      allowed.set(kind, ids.length ? await this.d.readable[kind](viewer, ids) : new Set());
    }
    const out: Source[] = [];
    for (const [id, f] of ranked) {
      const r = byId.get(id);
      if (!r || !allowed.get(r.kind)?.has(r.sourceId)) continue;
      out.push({ kind: r.kind, id, title: r.title, text: r.text, href: r.href, similarity: f.similarity });
    }
    return out;
  }

  // ── Asking ─────────────────────────────

  /**
   * Checks and stores the question, then returns the run that streams the answer. Errors before
   * the stream (validation, a session that is not the member's) are ordinary JSON errors.
   */
  async prepare(
    viewer: AuthState,
    body: CopilotAskInput,
  ): Promise<(send: Send, signal?: AbortSignal) => Promise<void>> {
    const question = plainText(body.question).slice(0, 600);
    const session = body.sessionId
      ? await this.owned(viewer, body.sessionId)
      : ((
          await CopilotSessionModel.create({
            userId: oid(viewer.userId),
            title: question.slice(0, 80),
            lastMessageAt: new Date(),
            purgeAt: purgeAt(),
          })
        ).toObject() as unknown as CopilotSessionDoc);
    const parsed = parseCopilotCommand(question);
    const userMsg = await CopilotMessageModel.create({
      sessionId: session._id,
      userId: oid(viewer.userId),
      role: 'user',
      text: question,
      command: parsed?.command ?? null,
      status: 'done',
      purgeAt: purgeAt(),
    });
    const answer = await CopilotMessageModel.create({
      sessionId: session._id,
      userId: oid(viewer.userId),
      role: 'assistant',
      text: '',
      command: parsed?.command ?? null,
      status: 'streaming',
      purgeAt: purgeAt(),
    });
    await this.track(viewer.userId, 'copilot_question', parsed ? { command: parsed.command } : {});
    return async (send, signal) => {
      send({
        type: 'start',
        sessionId: String(session._id),
        question: this.messageView(userMsg.toObject() as unknown as CopilotMessageDoc),
        messageId: String(answer._id),
      });
      let out: {
        text: string;
        citations: CopilotCitation[];
        handoffs: CopilotHandoff[];
        result: CopilotResult | null;
      };
      try {
        out = await this.answer(viewer, question, parsed, send, signal);
      } catch (err) {
        await CopilotMessageModel.updateOne({ _id: answer._id }, { $set: { status: 'failed' } });
        throw err;
      }
      const saved = await CopilotMessageModel.findOneAndUpdate(
        { _id: answer._id },
        {
          $set: {
            text: modelText(out.text).slice(0, 12_000),
            citations: out.citations,
            handoffs: out.handoffs,
            result: out.result,
            status: 'done',
          },
        },
        { returnDocument: 'after' },
      ).lean<CopilotMessageDoc>();
      await CopilotSessionModel.updateOne(
        { _id: session._id },
        { $set: { lastMessageAt: new Date(), purgeAt: purgeAt() }, $inc: { messageCount: 2 } },
      );
      if (saved) send({ type: 'done', message: this.messageView(saved) });
    };
  }

  private async answer(
    viewer: AuthState,
    question: string,
    parsed: { command: CopilotCommand; arg: string } | null,
    send: Send,
    signal?: AbortSignal,
  ): Promise<{
    text: string;
    citations: CopilotCitation[];
    handoffs: CopilotHandoff[];
    result: CopilotResult | null;
  }> {
    const minor = await this.d.isMinor(viewer.userId);
    const personal = !minor;
    const none = { text: '', citations: [] as CopilotCitation[] };
    const company = await this.companyIn(parsed?.arg || question);

    // Commands that are links or lists: no AI, no sources.
    if (parsed && parsed.command !== 'prep') {
      const handoffs = await this.handoffs(viewer, company, personal, []);
      if (parsed.command === 'eligible') {
        const drives = await this.d.eligibleDrives(viewer);
        return {
          ...none,
          handoffs,
          result: {
            kind: 'drives' as const,
            drives: drives.map((x) => ({
              id: x.id,
              company: x.company,
              title: x.title,
              closesAt: x.closesAt,
            })),
          },
        };
      }
      if (parsed.command === 'plan') return { ...none, handoffs, result: await this.d.plan(viewer) };
      const href =
        parsed.command === 'mock'
          ? `/interviews${company ? `?company=${encodeURIComponent(company.name)}` : ''}`
          : `/resume${parsed.arg ? `?target=${encodeURIComponent(parsed.arg)}` : ''}`;
      return {
        ...none,
        handoffs,
        result: { kind: 'link' as const, command: parsed.command, href, company: company?.name ?? null },
      };
    }

    const ask =
      parsed?.command === 'prep' ? `How do I prepare for ${company?.name ?? parsed.arg}?` : question;
    // E2: no predictions or guarantees, whatever the sources say.
    if (asksForPrediction(ask)) {
      return {
        ...none,
        handoffs: await this.handoffs(viewer, company, personal, []),
        result: { kind: 'refusal' as const, reason: 'prediction' as const },
      };
    }
    const kinds = COPILOT_INDEXED_KINDS.filter((k) =>
      k === 'drive'
        ? viewer.permissions.has('placements:view')
        : k === 'roadmap'
          ? viewer.permissions.has('roadmaps:read')
          : viewer.permissions.has('companies:view'),
    );
    const [indexed, mentors, me] = await Promise.all([
      this.retrieve(viewer, ask, kinds, company),
      this.d.mentors(viewer, company, personal).catch(() => [] as LiveSource[]),
      this.d.me(viewer, personal).catch(() => [] as LiveSource[]),
    ]);
    const live: Source[] = [...me, ...mentors].map((s) => ({ ...s, similarity: null }));
    const sources = [...indexed.slice(0, COPILOT_SOURCES_MAX - Math.min(live.length, 3)), ...live].slice(
      0,
      COPILOT_SOURCES_MAX,
    );
    const handoffs = await this.handoffs(viewer, company, personal, sources);
    const citations: CopilotCitation[] = sources.map((s, i) => ({
      n: i + 1,
      kind: s.kind,
      title: s.title,
      href: s.href,
      snippet: s.text.replace(/\s+/g, ' ').slice(0, 180),
    }));
    // Not covered: nothing found, or what was found does not cover the question.
    const sims = indexed.map((s) => s.similarity).filter((x): x is number => x !== null);
    const confident =
      !!sources.length &&
      ((sims.length > 0 && Math.max(...sims) >= MIN_SIMILARITY) ||
        coverage(
          ask,
          sources.slice(0, 4).map((s) => `${s.title}\n${s.text}`),
        ) >= MIN_COVERAGE ||
        !!company);
    if (!confident)
      return {
        ...none,
        handoffs,
        result: { kind: 'refusal' as const, reason: 'not_covered' as const },
      };
    send({ type: 'sources', citations });
    const input = {
      question: ask,
      language: detectLanguage(question),
      sources: sources.map((s) => ({ title: s.title, text: s.text })),
    };
    const r = await this.d.aiTasks.stream(
      viewer,
      copilotAnswerTask,
      input,
      (delta) => send({ type: 'delta', text: delta }),
      signal,
    );
    if (!r.ok)
      // No AI right now (not set up, budget, today's limit, an outage): the sources themselves.
      return {
        text: sources
          .slice(0, 3)
          .map((s, i) => `- ${s.text.replace(/\s+/g, ' ').slice(0, 220)} [${i + 1}]`)
          .join('\n'),
        citations,
        handoffs,
        result: { kind: 'sources_only' as const },
      };
    const cited = citedNumbers(r.text, sources.length);
    // E2: an answer must cite its sources; otherwise it is not one.
    if (r.text.trim() === NOT_COVERED || !cited.length)
      return { ...none, handoffs, result: { kind: 'refusal' as const, reason: 'not_covered' as const } };
    return {
      text: r.text,
      citations: citations.filter((c) => cited.includes(c.n)),
      handoffs,
      result:
        parsed?.command === 'prep' && company
          ? {
              kind: 'link' as const,
              command: 'prep' as const,
              href: `/companies/${encodeURIComponent(company.key)}`,
              company: company.name,
            }
          : null,
    };
  }

  /**
   * Up to two human next steps: an alumnus to ask (at the company in question when there is one),
   * then the soonest drive the member can register for (that company's first), else office hours.
   */
  private async handoffs(
    viewer: AuthState,
    company: { key: string; name: string } | null,
    personal: boolean,
    sources: Source[],
  ): Promise<CopilotHandoff[]> {
    const out: CopilotHandoff[] = [];
    const mentor =
      sources.find((s) => s.mentor)?.mentor ??
      (viewer.permissions.has('mentorship:request')
        ? (await this.d.mentors(viewer, company, personal).catch(() => [] as LiveSource[]))[0]?.mentor
        : undefined);
    if (mentor)
      out.push({
        kind: 'ask_alumnus',
        href: `/mentors/${mentor.userId}`,
        name: mentor.name,
        detail: mentor.company,
        replyHours: mentor.replyHours,
      });
    if (viewer.permissions.has('placements:view')) {
      const drives = await this.d.eligibleDrives(viewer).catch(() => []);
      const drive = drives.find((x) => company && x.companyKey === company.key) ?? drives[0];
      if (drive)
        out.push({
          kind: 'drive',
          href: `/placements/${drive.id}`,
          name: drive.company,
          detail: drive.title,
          at: drive.closesAt,
        });
    }
    if (out.length < COPILOT_HANDOFFS_MAX) {
      const oh = (await this.d.officeHours(viewer).catch(() => []))[0];
      if (oh)
        out.push({
          kind: 'office_hours',
          href: `/events/${oh.id}`,
          name: oh.title,
          detail: '',
          at: oh.startsAt,
        });
    }
    return out.slice(0, COPILOT_HANDOFFS_MAX);
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    const [sessions, messages] = await Promise.all([
      CopilotSessionModel.find({ userId: oid(userId) })
        .select('title lastMessageAt messageCount')
        .lean(),
      CopilotMessageModel.find({ userId: oid(userId) })
        .select('sessionId role text command citations handoffs result createdAt')
        .lean(),
    ]);
    return { copilotConversations: sessions, copilotMessages: messages };
  }

  async eraseFor(userId: string) {
    await CopilotMessageModel.deleteMany({ userId: oid(userId) });
    await CopilotSessionModel.deleteMany({ userId: oid(userId) });
  }
}
