import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  QUIZ_SIZE,
  type AnswerMode,
  type ChatCitation,
  type ChatMessageStatus,
  type ChatMessageView,
  type ChatResult,
  type ChatSessionDetail,
  type ChatSessionView,
  type ChatStreamEvent,
  type ChatVideo,
  type FlashcardDeckView,
  type MaterialType,
  type QuizQuestion,
  type ServerCommand,
  type chatAskBody,
  type chatFeedbackBody,
  type deckBody,
} from '@campuslink/shared';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { modelText, plainText } from '../../lib/text.js';
import type { Award } from '../../lib/awards.js';
import type { Logger } from '../../lib/logger.js';
import {
  ChatMessageModel,
  ChatSessionModel,
  FlashcardDeckModel,
  UnansweredQuestionModel,
  type ChatMessageDoc,
  type ChatSessionDoc,
  type FlashcardDeckDoc,
} from './chat.model.js';
import { MaterialPageModel, VideoSegmentModel } from './material.model.js';
import { ProviderError, type ChatTurn, type GenerateResult } from './ai/provider.js';
import { contentWords } from './ai/tokens.js';
import {
  buildMessages,
  citedNumbers,
  detectLanguage,
  redactPersonal,
  standaloneQuery,
  systemPrompt,
  type PromptSource,
  type PromptTask,
} from './chat/prompt.js';
import { snippet } from './materials.service.js';
import type { AiRuntime, AiSettingsService } from './ai-settings.service.js';
import type { AiUsageService } from './ai-usage.service.js';
import type { MaterialsService } from './materials.service.js';
import type { RetrievalService, RetrievedPassage } from './retrieval.service.js';
import type { SubjectsService } from './subjects.service.js';
import type { AuthState } from '../../types.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
/** The phrase the system prompt asks for when the sources do not cover a question. */
const NOT_COVERED = /does not cover this/i;
const VIDEO_TYPES: MaterialType[] = ['video_file', 'video_link', 'audio'];
const NOTE_TYPES: MaterialType[] = ['pdf', 'doc', 'slides', 'notes', 'image'];
const PAGE_SIZE = 30;

export type ChatSink = (e: ChatStreamEvent) => void;
/** A prepared question: validated and authorised; running it streams the answer. */
export type ChatRun = (sink: ChatSink, signal: AbortSignal) => Promise<void>;
type AskBody = z.output<typeof chatAskBody>;

export interface ChatDeps {
  subjects: SubjectsService;
  ai: AiSettingsService;
  retrieval: RetrievalService;
  materials: MaterialsService;
  usage: AiUsageService;
  award: Award;
  logger?: Pick<Logger, 'warn'>;
}

interface Turn {
  viewer: AuthState;
  question: string;
  command: ServerCommand | null;
  mode: AnswerMode;
  subjectId: string | null;
  difficulty: AskBody['difficulty'];
  count: number;
  selection: { passage: RetrievedPassage } | null;
  history: ChatTurn[];
  previous: string | null;
  rt: AiRuntime;
  sink: ChatSink;
  signal: AbortSignal;
}

interface Outcome {
  text: string;
  citations: ChatCitation[];
  result: ChatResult | null;
  status: ChatMessageStatus;
  grounded: boolean;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number };
  /** What the question was about, for the faculty's aggregate insights (ids only). */
  about: About;
}
interface About {
  subjectIds: string[];
  unitIds: string[];
  topicIds: string[];
}
const NOWHERE: About = { subjectIds: [], unitIds: [], topicIds: [] };
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
/** The subjects, units and topics of the passages (or materials) an answer drew on. */
const aboutOf = (
  items: { subjectId: string; unitId: string | null; topicIds: string[] }[],
  scope: string | null = null,
): About => ({
  subjectIds: uniq([scope, ...items.map((p) => p.subjectId)]),
  unitIds: uniq(items.map((p) => p.unitId)),
  topicIds: uniq(items.flatMap((p) => p.topicIds)),
});

const whereOf = (p: Pick<RetrievedPassage, 'page' | 'startSec'>) =>
  p.page
    ? `page ${p.page}`
    : p.startSec !== null
      ? `${Math.floor(p.startSec / 60)}:${String(Math.floor(p.startSec % 60)).padStart(2, '0')}`
      : '';

const citation = (p: RetrievedPassage, n: number, q: string): ChatCitation => ({
  n,
  chunkId: p.chunkId,
  materialId: p.materialId,
  subjectId: p.subjectId,
  title: p.title,
  type: p.type,
  page: p.page,
  startSec: p.startSec,
  snippet: snippet(p.text, q),
});

/**
 * The study assistant (spec §6). Every question is answered only from passages the member may
 * read (RetrievalService applies the readable-subject filter and re-reads each passage), inside
 * delimited sources, with citations to the page or moment. Without an answer model, retrieval
 * still answers with the matching passages; a question the material does not cover is said so
 * plainly and logged (without personal details) for the faculty's content gaps. Conversations are
 * private to the member and expire with the college's retention setting.
 */
export class ChatService {
  constructor(private readonly d: ChatDeps) {}

  // ── Asking ─────────────────────────────
  async prepare(viewer: AuthState, body: AskBody): Promise<ChatRun> {
    const session = body.sessionId ? await this.ownSession(viewer, body.sessionId) : null;
    let question = body.question;
    let command: ServerCommand | null = body.command ?? null;
    let regenerate: { old: ChatMessageDoc; asked: ChatMessageDoc } | null = null;
    if (body.regenerate) {
      if (!session) throw badRequest('Answering again needs its conversation');
      const old = await ChatMessageModel.findOne({
        _id: oid(body.regenerate),
        sessionId: session._id,
        role: 'assistant',
      }).lean<ChatMessageDoc>();
      const asked =
        old &&
        (await ChatMessageModel.findOne({
          sessionId: session._id,
          role: 'user',
          createdAt: { $lte: old.createdAt },
        })
          .sort({ createdAt: -1 })
          .lean<ChatMessageDoc>());
      if (!old || !asked) throw notFound('Message');
      regenerate = { old, asked };
      command = (asked.command as ServerCommand | null) ?? null;
      question = asked.arg || asked.text;
    }
    const subjectId = body.subjectId ?? null;
    if (subjectId) await this.d.subjects.readable(viewer, subjectId);
    const selection = body.context ? await this.selection(viewer, body.context) : null;
    if (command && command !== 'videos' && command !== 'notes' && !question.trim())
      throw badRequest('Add a topic after the command');

    return async (sink, signal) => {
      const started = Date.now();
      const rt = await this.dailyLimit(viewer, await this.d.ai.runtime());
      const now = new Date();
      const days = rt.settings.chatRetentionDays;
      const expireAt = days > 0 ? new Date(now.getTime() + days * 86_400_000) : null;
      let sessionId: Types.ObjectId;
      if (!session)
        sessionId = (
          await ChatSessionModel.create({
            userId: oid(viewer.userId),
            subjectId: subjectId ? oid(subjectId) : null,
            title: plainText(command ? `/${command} ${question}` : question).slice(0, 80) || '…',
            mode: body.mode,
            lastMessageAt: now,
            expireAt,
          })
        )._id;
      else {
        sessionId = session._id;
        await ChatSessionModel.updateOne(
          { _id: sessionId },
          {
            $set: {
              subjectId: subjectId ? oid(subjectId) : null,
              mode: body.mode,
              lastMessageAt: now,
              expireAt,
            },
          },
        );
        await ChatMessageModel.updateMany({ sessionId }, { $set: { expireAt } });
      }
      const earlier = await ChatMessageModel.find({ sessionId, superseded: false })
        .sort({ createdAt: -1 })
        .limit(6)
        .lean<ChatMessageDoc[]>();
      const asked =
        regenerate?.asked ??
        ((
          await ChatMessageModel.create({
            sessionId,
            userId: oid(viewer.userId),
            role: 'user',
            text: plainText(command ? `/${command} ${question}`.trim() : question),
            command,
            arg: command ? plainText(question) : '',
            mode: body.mode,
            expireAt,
          })
        ).toObject() as unknown as ChatMessageDoc);
      if (regenerate)
        await ChatMessageModel.updateOne({ _id: regenerate.old._id }, { $set: { superseded: true } });
      const messageId = new Types.ObjectId();
      sink({
        type: 'start',
        sessionId: String(sessionId),
        question: this.view(asked),
        messageId: String(messageId),
      });

      const history: ChatTurn[] = earlier
        .filter((m) => String(m._id) !== String(asked._id) && !m.command && m.text)
        .reverse()
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text }));
      const turn: Turn = {
        viewer,
        question,
        command,
        mode: body.mode,
        subjectId,
        difficulty: body.difficulty,
        count: body.count ?? QUIZ_SIZE.default,
        selection,
        history: history.slice(-6),
        previous:
          [...earlier].find((m) => m.role === 'user' && String(m._id) !== String(asked._id))?.text ?? null,
        rt,
        sink,
        signal,
      };
      let out: Outcome;
      try {
        out =
          command === 'videos'
            ? await this.videos(turn)
            : command === 'notes'
              ? await this.notes(turn)
              : command === 'quiz' || command === 'flashcards'
                ? await this.structured(turn, command)
                : await this.written(turn);
      } catch (e) {
        if (!(e instanceof ProviderError) && !signal.aborted) throw e;
        out = await this.fallback(turn, e);
      }
      const about = { ...out.about, subjectIds: uniq([subjectId, ...out.about.subjectIds]) };
      const saved = await ChatMessageModel.create({
        _id: messageId,
        sessionId,
        userId: oid(viewer.userId),
        role: 'assistant',
        text: modelText(out.text),
        command,
        arg: command ? plainText(question) : '',
        mode: body.mode,
        citations: out.citations.map((c) => ({
          ...c,
          chunkId: c.chunkId ? oid(c.chunkId) : null,
          materialId: oid(c.materialId),
          subjectId: oid(c.subjectId),
        })),
        result: out.result,
        status: out.status,
        grounded: out.grounded,
        subjectIds: about.subjectIds.slice(0, 20).map(oid),
        unitIds: about.unitIds.slice(0, 20).map(oid),
        topicIds: about.topicIds.slice(0, 40).map(oid),
        model: out.model,
        inputTokens: out.usage.inputTokens,
        outputTokens: out.usage.outputTokens,
        latencyMs: Date.now() - started,
        expireAt,
      });
      await ChatSessionModel.updateOne({ _id: sessionId }, { $inc: { messageCount: regenerate ? 1 : 2 } });
      sink({ type: 'done', message: this.view(saved.toObject() as unknown as ChatMessageDoc) });
    };
  }

  /** "Ask about this": the selected words (or the page, or the moment) of a material the member may read. */
  private async selection(viewer: AuthState, ctx: NonNullable<AskBody['context']>) {
    const [m] = await this.d.materials.summaries(viewer, [ctx.materialId]);
    if (!m) throw notFound('Material');
    let text = ctx.text.trim();
    if (!text && ctx.page)
      text =
        (
          await MaterialPageModel.findOne({ materialId: oid(m.id), page: ctx.page })
            .select('text')
            .lean<{ text: string }>()
        )?.text.slice(0, 1500) ?? '';
    if (!text && ctx.startSec !== null)
      text = (
        await VideoSegmentModel.find({
          materialId: oid(m.id),
          start: { $gte: ctx.startSec - 30, $lte: ctx.startSec + 60 },
        })
          .sort({ start: 1 })
          .select('text')
          .lean<{ text: string }[]>()
      )
        .map((s) => s.text)
        .join(' ')
        .slice(0, 1500);
    if (!text) return null;
    const passage: RetrievedPassage = {
      chunkId: '',
      materialId: m.id,
      subjectId: m.subjectId,
      title: m.title,
      type: m.type,
      page: ctx.page,
      startSec: ctx.startSec,
      endSec: null,
      heading: '',
      text,
      unitId: m.unitId,
      topicIds: m.topicIds,
      score: 1,
      match: 'keyword',
      similarity: null,
    };
    return { passage };
  }

  /** Passages for a question: the selection first (when asking about a page), then retrieval. */
  private async passages(
    t: Turn,
    query: string,
    extra: { unitId?: string; materialTypes?: MaterialType[] } = {},
  ) {
    const r = await this.d.retrieval.retrieve(t.viewer, {
      query,
      subjectId: t.subjectId ?? undefined,
      limit: t.rt.settings.maxChunks,
      ...extra,
    });
    if (!t.selection) return r;
    const sel = t.selection.passage;
    return {
      ...r,
      confident: true,
      passages: [
        sel,
        ...r.passages.filter((p) => !(p.materialId === sel.materialId && p.page === sel.page)),
      ].slice(0, t.rt.settings.maxChunks),
    };
  }

  /** Answers and the written commands (summary, explain, important), streamed. */
  private async written(t: Turn): Promise<Outcome> {
    const task: PromptTask =
      t.command === 'summary'
        ? { kind: 'summary' }
        : t.command === 'explain'
          ? { kind: 'explain', difficulty: t.difficulty ?? 'medium' }
          : t.command === 'important'
            ? { kind: 'important' }
            : { kind: 'answer' };
    let query = t.command ? t.question : standaloneQuery(t.question, t.previous);
    let unitId: string | undefined;
    let ask = t.question;
    if (t.command === 'important') {
      const unit = await this.findUnit(t.viewer, t.subjectId, t.question);
      if (unit) {
        unitId = unit.id;
        query = [unit.title, ...unit.topics.map((x) => x.title)].join(' ');
        ask = `Unit: ${unit.title}. Topics: ${unit.topics.map((x) => x.title).join(', ')}.`;
      }
    }
    if (t.command && t.rt.chat === null) return this.aiOff(t);
    const r = await this.passages(t, query, unitId ? { unitId } : {});
    if (!r.passages.length || !r.confident) return this.notCovered(t, query);
    if (!t.rt.chat) return this.passagesOnly(t, r.passages, query);
    const sources: PromptSource[] = r.passages.map((p, i) => ({
      n: i + 1,
      title: p.title,
      where: whereOf(p),
      text: p.text,
    }));
    t.sink({ type: 'sources', citations: r.passages.map((p, i) => citation(p, i + 1, query)) });
    const res = await this.generate(t, task, sources, ask, true);
    if (res.stopReason === 'refusal') {
      t.sink({ type: 'replace', text: '' });
      return { ...this.empty(), status: 'refused', usage: res, about: aboutOf(r.passages.slice(0, 3)) };
    }
    if (NOT_COVERED.test(res.text) && !citedNumbers(res.text, sources.length).length) {
      const nc = await this.notCovered(t, query);
      return { ...nc, model: this.modelOf(t), usage: res };
    }
    const cited = citedNumbers(res.text, sources.length);
    const used = cited.map((n) => r.passages[n - 1] as RetrievedPassage);
    return {
      text: res.text,
      citations: cited.map((n) => citation(r.passages[n - 1] as RetrievedPassage, n, query)),
      result: null,
      status: t.signal.aborted ? 'stopped' : 'complete',
      grounded: cited.length > 0,
      model: this.modelOf(t),
      usage: res,
      about: aboutOf(used.length ? used : r.passages.slice(0, 3)),
    };
  }

  /** `/quiz` and `/flashcards`: JSON from the model, checked and cited, from the material only. */
  private async structured(t: Turn, kind: 'quiz' | 'flashcards'): Promise<Outcome> {
    if (!t.rt.chat) return this.aiOff(t);
    const r = await this.passages(t, t.question);
    if (!r.passages.length || !r.confident) return this.notCovered(t, t.question);
    const sources: PromptSource[] = r.passages.map((p, i) => ({
      n: i + 1,
      title: p.title,
      where: whereOf(p),
      text: p.text,
    }));
    const res = await this.generate(t, { kind, count: t.count }, sources, t.question, false);
    const parsed = parseJson(res.text);
    const cite = (n: unknown) => (typeof n === 'number' && n >= 1 && n <= sources.length ? n : null);
    const clip = (s: unknown, max: number) => plainText(typeof s === 'string' ? s : '').slice(0, max);
    let result: ChatResult | null = null;
    if (kind === 'quiz') {
      const questions: QuizQuestion[] = [];
      for (const q of asArray(parsed?.questions).slice(0, t.count)) {
        const o = q as Record<string, unknown>;
        const options = asArray(o.options)
          .map((x) => clip(x, 200))
          .filter(Boolean)
          .slice(0, 6);
        const answer = typeof o.answer === 'number' ? o.answer : -1;
        if (
          o.type === 'mcq' &&
          options.length >= 2 &&
          answer >= 0 &&
          answer < options.length &&
          clip(o.q, 500)
        )
          questions.push({
            kind: 'mcq',
            q: clip(o.q, 500),
            options,
            answer,
            explain: clip(o.explain, 800),
            cite: cite(o.cite),
          });
        else if (o.type === 'short' && clip(o.q, 500) && clip(o.answer, 300))
          questions.push({
            kind: 'short',
            q: clip(o.q, 500),
            answer: clip(o.answer, 300),
            explain: clip(o.explain, 800),
            cite: cite(o.cite),
          });
      }
      if (questions.length) result = { kind: 'quiz', topic: t.question, questions, score: null };
    } else {
      const cards = asArray(parsed?.cards)
        .slice(0, t.count)
        .map((c) => c as Record<string, unknown>)
        .map((c) => ({ front: clip(c.front, 300), back: clip(c.back, 800), cite: cite(c.cite) }))
        .filter((c) => c.front && c.back);
      if (cards.length) result = { kind: 'flashcards', topic: t.question, cards };
    }
    if (!result)
      return {
        ...this.empty(),
        status: 'failed',
        model: this.modelOf(t),
        usage: res,
        about: aboutOf(r.passages.slice(0, 3)),
      };
    const used = new Set<number>();
    if (result.kind === 'quiz') for (const q of result.questions) if (q.cite) used.add(q.cite);
    if (result.kind === 'flashcards') for (const c of result.cards) if (c.cite) used.add(c.cite);
    const cited = [...used].sort((a, b) => a - b);
    return {
      text: '',
      citations: cited.map((n) => citation(r.passages[n - 1] as RetrievedPassage, n, t.question)),
      result,
      status: 'complete',
      grounded: true,
      model: this.modelOf(t),
      usage: res,
      about: aboutOf(cited.length ? cited.map((n) => r.passages[n - 1] as RetrievedPassage) : r.passages),
    };
  }

  /**
   * `/videos <topic>` (works without any AI provider): every video the member may watch that covers
   * the topic, "Exact topic" first (tagged to a matching syllabus topic), with the best moments as
   * deep links, plus optional links from the web when the college turned them on.
   */
  private async videos(t: Turn): Promise<Outcome> {
    const topic = t.question.trim();
    const r = await this.d.retrieval.retrieve(t.viewer, {
      query: topic || 'video',
      subjectId: t.subjectId ?? undefined,
      materialTypes: VIDEO_TYPES,
      limit: 30,
      minSimilarity: 0.3,
    });
    const groups = new Map<string, { score: number; moments: { startSec: number; text: string }[] }>();
    for (const p of r.passages) {
      const g = groups.get(p.materialId) ?? { score: 0, moments: [] };
      g.score = Math.max(g.score, p.score);
      if (p.startSec !== null && g.moments.length < 3)
        g.moments.push({ startSec: p.startSec, text: snippet(p.text, topic).slice(0, 160) });
      groups.set(p.materialId, g);
    }
    const ids = [...groups.entries()].sort((a, b) => b[1].score - a[1].score).map(([id]) => id);
    const cards = await this.d.materials.summaries(t.viewer, ids);
    const topicIds = new Set((await this.matchTopics(t.viewer, t.subjectId, topic)).map((x) => x.id));
    const videos: (ChatVideo & { exact: boolean })[] = cards.map((m) => ({
      material: m,
      moments: (groups.get(m.id)?.moments ?? []).sort((a, b) => a.startSec - b.startSec),
      exact: m.topicIds.some((id) => topicIds.has(id)),
    }));
    const web = topic ? await this.d.ai.webVideos(topic) : null;
    const strip = ({ exact: _exact, ...v }: ChatVideo & { exact: boolean }) => v;
    return {
      ...this.empty(),
      result: {
        kind: 'videos',
        topic,
        exact: videos.filter((v) => v.exact).map(strip),
        related: videos.filter((v) => !v.exact).map(strip),
        web,
        nearby: videos.length ? [] : await this.nearby(t.viewer, t.subjectId, topic),
      },
      grounded: videos.length > 0,
      about: aboutOf(cards.slice(0, 5)),
    };
  }

  /** `/notes <topic>`: the notes, slides and PDFs for a topic, with the pages that cover it. */
  private async notes(t: Turn): Promise<Outcome> {
    const topic = t.question.trim();
    const r = await this.d.retrieval.retrieve(t.viewer, {
      query: topic || 'notes',
      subjectId: t.subjectId ?? undefined,
      materialTypes: NOTE_TYPES,
      limit: 30,
      minSimilarity: 0.3,
    });
    const pages = new Map<string, Set<number>>();
    for (const p of r.passages) {
      const s = pages.get(p.materialId) ?? new Set<number>();
      if (p.page) s.add(p.page);
      pages.set(p.materialId, s);
    }
    const cards = await this.d.materials.summaries(t.viewer, [...pages.keys()]);
    return {
      ...this.empty(),
      result: {
        kind: 'notes',
        topic,
        items: cards.map((m) => ({
          material: m,
          pages: [...(pages.get(m.id) ?? [])].sort((a, b) => a - b).slice(0, 12),
        })),
        nearby: cards.length ? [] : await this.nearby(t.viewer, t.subjectId, topic),
      },
      grounded: cards.length > 0,
      about: aboutOf(cards.slice(0, 5)),
    };
  }

  private async generate(
    t: Turn,
    task: PromptTask,
    sources: PromptSource[],
    question: string,
    stream: boolean,
  ) {
    const chat = t.rt.chat;
    if (!chat) throw new ProviderError('unavailable', 'No answer model');
    const messages = buildMessages({ history: task.kind === 'answer' ? t.history : [], sources, question });
    const req = {
      model: chat.model,
      system: systemPrompt(task, t.mode, detectLanguage(question)),
      messages,
      maxTokens:
        task.kind === 'quiz' || task.kind === 'flashcards'
          ? Math.max(1500, t.rt.settings.maxAnswerTokens)
          : t.rt.settings.maxAnswerTokens,
      temperature: t.rt.settings.temperature ?? null,
    };
    let shown = '';
    let res: GenerateResult;
    try {
      res = await chat.provider.generate(req, {
        signal: t.signal,
        ...(stream
          ? {
              onText: (delta: string) => {
                shown += delta;
                t.sink({ type: 'delta', text: delta });
              },
            }
          : {}),
      });
    } catch (e) {
      // Stopped by the member: keep what was written so far.
      if (t.signal.aborted)
        return { text: shown, inputTokens: 0, outputTokens: 0, stopReason: 'other' as const };
      if (e instanceof ProviderError && e.kind === 'auth' && !chat.platform)
        await this.d.ai.keyRejected('chat', e.message);
      throw e;
    }
    await this.d.usage.record({
      kind: 'chat',
      model: this.modelOf(t) ?? chat.model,
      userId: t.viewer.userId,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    });
    return res;
  }

  /** A provider failure (or a stop before any text): the matching passages instead, never a crash. */
  private async fallback(t: Turn, e: unknown): Promise<Outcome> {
    if (t.signal.aborted) return { ...this.empty(), status: 'stopped' };
    this.d.logger?.warn({ err: e instanceof Error ? e.message : 'unknown' }, 'study chat: provider failed');
    if (e instanceof ProviderError) await this.d.ai.recordFailure(e.message);
    t.sink({ type: 'replace', text: '' });
    const r = await this.passages(t, t.question).catch(() => null);
    const out = r?.passages.length ? await this.passagesOnly(t, r.passages, t.question) : this.empty();
    return { ...out, status: 'failed' };
  }

  /**
   * The per-member daily limit (spec §7): past it, this member's questions get the passages and
   * the generative commands say why, until the next UTC day. Search and /videos keep working.
   */
  private async dailyLimit(viewer: AuthState, rt: AiRuntime): Promise<AiRuntime> {
    if (!rt.chat) return rt;
    const used = await this.d.usage.requestsToday(viewer.userId, 'chat');
    if (used < rt.settings.dailyMessagesPerUser) return rt;
    return { ...rt, chat: null, status: { ...rt.status, answers: false, reason: 'daily_limit' } };
  }

  private empty(): Outcome {
    return {
      text: '',
      citations: [],
      result: null,
      status: 'complete',
      grounded: false,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      about: NOWHERE,
    };
  }

  private modelOf(t: Turn): string | null {
    return t.rt.chat ? `${t.rt.chat.provider.id}:${t.rt.chat.model}` : null;
  }

  /** Generative commands without an answer model: a friendly "not enabled" state (spec §6). */
  private aiOff(t: Turn): Outcome {
    return { ...this.empty(), result: { kind: 'passages', reason: t.rt.status.reason ?? 'not_configured' } };
  }

  /** No answer model: the best passages, quoted with their sources (spec §8). */
  private async passagesOnly(t: Turn, passages: RetrievedPassage[], query: string): Promise<Outcome> {
    const top = passages.slice(0, 3);
    const citations = top.map((p, i) => citation(p, i + 1, query));
    t.sink({ type: 'sources', citations });
    return {
      ...this.empty(),
      citations,
      result: { kind: 'passages', reason: t.rt.status.reason },
      grounded: true,
      about: aboutOf(top),
    };
  }

  /** The material does not cover it: say so, suggest nearby topics, and log the gap (no personal details). */
  private async notCovered(t: Turn, query: string): Promise<Outcome> {
    const topics = await this.matchTopics(t.viewer, t.subjectId, query);
    await UnansweredQuestionModel.create({
      subjectId: t.subjectId ? oid(t.subjectId) : null,
      userId: oid(t.viewer.userId),
      text: plainText(redactPersonal(t.question)).slice(0, 300),
      language: detectLanguage(t.question),
      topicIds: topics.slice(0, 3).map((x) => oid(x.id)),
    });
    return {
      ...this.empty(),
      result: { kind: 'not_covered', nearby: await this.nearby(t.viewer, t.subjectId, query) },
      about: aboutOf(topics.slice(0, 3).map((x) => ({ ...x, topicIds: [x.id] }))),
    };
  }

  /** Syllabus topics of the scope, best word match first. */
  private async matchTopics(viewer: AuthState, subjectId: string | null, query: string) {
    const ids = subjectId
      ? [subjectId]
      : (await this.d.subjects.readableIds(viewer)).map(String).slice(0, 20);
    const want = new Set(contentWords(query));
    const scored: { id: string; title: string; subjectId: string; unitId: string; score: number }[] = [];
    for (const id of ids) {
      for (const tp of await this.d.subjects.topicsOf(oid(id))) {
        const words = contentWords([tp.title, ...tp.keywords].join(' '));
        const hit = words.filter((w) => want.has(w)).length;
        if (hit)
          scored.push({
            id: tp.id,
            title: tp.title,
            subjectId: id,
            unitId: tp.unitId,
            score: hit / Math.max(words.length, 1),
          });
      }
    }
    return scored.sort((a, b) => b.score - a.score);
  }

  private async nearby(viewer: AuthState, subjectId: string | null, query: string): Promise<string[]> {
    const matched = (await this.matchTopics(viewer, subjectId, query)).map((x) => x.title);
    if (matched.length) return [...new Set(matched)].slice(0, 5);
    if (!subjectId) return [];
    return (await this.d.subjects.topicsOf(oid(subjectId))).slice(0, 5).map((x) => x.title);
  }

  /** `/important <unit>`: the unit whose title best matches, in the scope. */
  private async findUnit(viewer: AuthState, subjectId: string | null, name: string) {
    const ids = subjectId
      ? [subjectId]
      : (await this.d.subjects.readableIds(viewer)).map(String).slice(0, 20);
    const want = new Set(contentWords(name));
    const n = /\b(\d{1,2})\b/.exec(name)?.[1];
    let best: { id: string; title: string; topics: { id: string; title: string }[]; score: number } | null =
      null;
    for (const id of ids) {
      const tree = await this.d.subjects.syllabus(viewer, id);
      tree.units.forEach((u, i) => {
        const words = contentWords(u.title);
        let score = words.filter((w) => want.has(w)).length / Math.max(words.length, 1);
        if (n && Number(n) === i + 1) score += 1;
        if (score > 0 && (!best || score > best.score))
          best = {
            id: u.id,
            title: u.title,
            topics: u.topics.map((x) => ({ id: x.id, title: x.title })),
            score,
          };
      });
    }
    return best as { id: string; title: string; topics: { id: string; title: string }[] } | null;
  }

  // ── Conversations ─────────────────────────────
  private async ownSession(viewer: AuthState, id: string): Promise<ChatSessionDoc> {
    const s = await ChatSessionModel.findOne({
      _id: oid(id),
      userId: oid(viewer.userId),
    }).lean<ChatSessionDoc>();
    if (!s) throw notFound('Conversation');
    return s;
  }

  async sessions(
    viewer: AuthState,
    cursor?: string,
  ): Promise<{ items: ChatSessionView[]; nextCursor: string | null }> {
    const filter: Record<string, unknown> = { userId: oid(viewer.userId) };
    if (cursor) {
      const at = await ChatSessionModel.findOne({ _id: oid(cursor), userId: oid(viewer.userId) })
        .select('lastMessageAt')
        .lean<{ lastMessageAt: Date }>();
      if (at) filter.lastMessageAt = { $lt: at.lastMessageAt };
    }
    const rows = await ChatSessionModel.find(filter)
      .sort({ lastMessageAt: -1 })
      .limit(PAGE_SIZE + 1)
      .lean<ChatSessionDoc[]>();
    const items = rows.slice(0, PAGE_SIZE).map((s) => this.sessionView(s));
    return { items, nextCursor: rows.length > PAGE_SIZE ? (items.at(-1)?.id ?? null) : null };
  }

  async session(viewer: AuthState, id: string): Promise<ChatSessionDetail> {
    const s = await this.ownSession(viewer, id);
    const messages = await ChatMessageModel.find({ sessionId: s._id, superseded: false })
      .sort({ createdAt: 1 })
      .lean<ChatMessageDoc[]>();
    return { ...this.sessionView(s), messages: messages.map((m) => this.view(m)) };
  }

  async removeSession(viewer: AuthState, id: string) {
    const s = await this.ownSession(viewer, id);
    await ChatMessageModel.deleteMany({ sessionId: s._id });
    await ChatSessionModel.deleteOne({ _id: s._id });
  }

  /** Students can delete their whole chat history (spec §9). */
  async clear(viewer: AuthState) {
    await ChatMessageModel.deleteMany({ userId: oid(viewer.userId) });
    await ChatSessionModel.deleteMany({ userId: oid(viewer.userId) });
  }

  private async ownAnswer(viewer: AuthState, id: string): Promise<ChatMessageDoc> {
    const m = await ChatMessageModel.findOne({
      _id: oid(id),
      userId: oid(viewer.userId),
      role: 'assistant',
    }).lean<ChatMessageDoc>();
    if (!m) throw notFound('Message');
    return m;
  }

  async feedback(
    viewer: AuthState,
    id: string,
    body: z.output<typeof chatFeedbackBody>,
  ): Promise<ChatMessageView> {
    const m = await this.ownAnswer(viewer, id);
    await ChatMessageModel.updateOne(
      { _id: m._id },
      { $set: { feedback: { rating: body.rating, reason: body.rating === 'down' ? body.reason : null } } },
    );
    return this.view({
      ...m,
      feedback: { rating: body.rating, reason: body.rating === 'down' ? body.reason : null },
    });
  }

  /** Scores a finished quiz once (it is a progress signal: points through the award callback). */
  async submitQuiz(viewer: AuthState, id: string, answers: (number | string)[]): Promise<ChatMessageView> {
    const m = await this.ownAnswer(viewer, id);
    const result = m.result as ChatResult | null;
    if (result?.kind !== 'quiz') throw badRequest('That answer is not a quiz');
    if (result.score) throw conflict('This quiz is already finished');
    if (answers.length !== result.questions.length) throw badRequest('Answer every question');
    let correct = 0;
    result.questions.forEach((q, i) => {
      const a = answers[i];
      if (q.kind === 'mcq' ? a === q.answer : typeof a === 'string' && sameAnswer(a, q.answer)) correct++;
    });
    const score = { correct, total: result.questions.length, answers, at: new Date().toISOString() };
    const w = await ChatMessageModel.updateOne(
      { _id: m._id, 'result.score': null },
      { $set: { 'result.score': score } },
    );
    if (!w.modifiedCount) throw conflict('This quiz is already finished');
    await this.d.award(viewer.userId, 'study_quiz', String(m._id));
    return this.view({ ...m, result: { ...result, score } });
  }

  // ── Flashcard decks ─────────────────────────────
  async createDeck(viewer: AuthState, body: z.output<typeof deckBody>): Promise<FlashcardDeckView> {
    const m = await this.ownAnswer(viewer, body.messageId);
    const result = m.result as ChatResult | null;
    if (result?.kind !== 'flashcards') throw badRequest('That answer has no flashcards');
    const session = await ChatSessionModel.findOne({ _id: m.sessionId })
      .select('subjectId')
      .lean<ChatSessionDoc>();
    const deck = await FlashcardDeckModel.create({
      userId: oid(viewer.userId),
      subjectId: session?.subjectId ?? null,
      title: plainText(body.title),
      cards: result.cards.map((c) => ({ front: c.front, back: c.back })),
      sourceMessageId: m._id,
    });
    return deckView(deck.toObject() as unknown as FlashcardDeckDoc);
  }

  async decks(viewer: AuthState): Promise<FlashcardDeckView[]> {
    const rows = await FlashcardDeckModel.find({ userId: oid(viewer.userId) })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<FlashcardDeckDoc[]>();
    return rows.map(deckView);
  }

  async deck(viewer: AuthState, id: string): Promise<FlashcardDeckView> {
    const d = await FlashcardDeckModel.findOne({
      _id: oid(id),
      userId: oid(viewer.userId),
    }).lean<FlashcardDeckDoc>();
    if (!d) throw notFound('Deck');
    return deckView(d);
  }

  async removeDeck(viewer: AuthState, id: string) {
    const r = await FlashcardDeckModel.deleteOne({ _id: oid(id), userId: oid(viewer.userId) });
    if (!r.deletedCount) throw notFound('Deck');
  }

  // ── Views ─────────────────────────────
  private sessionView(s: ChatSessionDoc): ChatSessionView {
    return {
      id: String(s._id),
      title: s.title,
      subjectId: s.subjectId ? String(s.subjectId) : null,
      mode: s.mode as AnswerMode,
      lastMessageAt: s.lastMessageAt.toISOString(),
      messageCount: s.messageCount ?? 0,
    };
  }

  private view(m: ChatMessageDoc): ChatMessageView {
    return {
      id: String(m._id),
      role: m.role as 'user' | 'assistant',
      text: m.text ?? '',
      command: (m.command as ServerCommand | null) ?? null,
      citations: (m.citations ?? []).map((c) => ({
        n: c.n ?? 0,
        chunkId: c.chunkId ? String(c.chunkId) : '',
        materialId: String(c.materialId),
        subjectId: String(c.subjectId),
        title: c.title ?? '',
        type: (c.type ?? 'pdf') as MaterialType,
        page: c.page ?? null,
        startSec: c.startSec ?? null,
        snippet: c.snippet ?? '',
      })),
      result: (m.result as ChatResult | null) ?? null,
      status: (m.status ?? 'complete') as ChatMessageStatus,
      grounded: !!m.grounded,
      mode: (m.mode ?? 'simple') as AnswerMode,
      feedback: (m.feedback?.rating as 'up' | 'down' | null) ?? null,
      createdAt: (m.createdAt ?? new Date()).toISOString(),
    };
  }

  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const u = oid(userId);
    const sessions = await ChatSessionModel.find({ userId: u })
      .sort({ lastMessageAt: -1 })
      .lean<ChatSessionDoc[]>();
    const messages = await ChatMessageModel.find({ userId: u, superseded: false })
      .sort({ createdAt: 1 })
      .select('sessionId role text command createdAt')
      .lean<ChatMessageDoc[]>();
    const decks = await FlashcardDeckModel.find({ userId: u }).lean<FlashcardDeckDoc[]>();
    return {
      conversations: sessions.map((s) => ({
        title: s.title,
        lastMessageAt: s.lastMessageAt,
        messages: messages
          .filter((m) => String(m.sessionId) === String(s._id))
          .map((m) => ({ role: m.role, text: m.text, command: m.command, at: m.createdAt })),
      })),
      decks: decks.map((d) => ({ title: d.title, cards: d.cards })),
      unansweredQuestions: await UnansweredQuestionModel.countDocuments({ userId: u }),
    };
  }

  /** Chats, decks and the member's logged gaps are personal: all deleted. */
  async eraseFor(userId: string) {
    const u = oid(userId);
    await ChatMessageModel.deleteMany({ userId: u });
    await ChatSessionModel.deleteMany({ userId: u });
    await FlashcardDeckModel.deleteMany({ userId: u });
    await UnansweredQuestionModel.deleteMany({ userId: u });
  }
}

function deckView(d: FlashcardDeckDoc): FlashcardDeckView {
  return {
    id: String(d._id),
    title: d.title,
    subjectId: d.subjectId ? String(d.subjectId) : null,
    cards: (d.cards ?? []).map((c) => ({ front: c.front ?? '', back: c.back ?? '' })),
    createdAt: d.createdAt.toISOString(),
  };
}

const asArray = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** The first JSON object in a model's reply (models sometimes wrap it in a code fence). */
export function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A short answer counts when it has most of the expected answer's content words. */
export function sameAnswer(given: string, expected: string): boolean {
  const want = [...new Set(contentWords(expected))];
  if (!want.length) return given.trim().toLowerCase() === expected.trim().toLowerCase();
  const have = new Set(contentWords(given));
  return want.filter((w) => have.has(w)).length / want.length >= 0.6;
}
