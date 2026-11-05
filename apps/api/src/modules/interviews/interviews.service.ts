import { randomInt } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  INTERVIEW_FOLLOW_UPS_MAX,
  INTERVIEW_SESSIONS_PER_DAY,
  RUBRIC_DIMENSIONS,
  type Branch,
  type InterviewDifficulty,
  type InterviewHistoryView,
  type InterviewListItem,
  type InterviewQuestionView,
  type InterviewView,
  type RubricDimension,
  type RubricScores,
  type interviewAnswerBody,
  type interviewCreateBody,
  type interviewQuestionBody,
  type interviewQuestionDecisionBody,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { badRequest, conflict, notFound, tooMany } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { Logger } from '../../lib/logger.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import type { AiTasksService } from '../ai-tasks/ai-tasks.service.js';
import type { AiSettingsService } from '../study/ai-settings.service.js';
import type { AiUsageService } from '../study/ai-usage.service.js';
import type { MediaTools } from '../study/media/tools.js';
import { OpenAiTranscriber, type TranscriptionProvider } from '../study/media/transcribe.js';
import type { FilesService } from '../files/files.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import {
  InterviewModel,
  InterviewQuestionModel,
  type InterviewDoc,
  type InterviewQuestionDoc,
  type InterviewTurnDoc,
} from './interview.model.js';
import { STARTER_QUESTIONS, type StarterQuestion } from './starter-questions.js';
import { answerTask, averages, driveQuestionsTask, ruleSummary, summaryTask } from './interview-tasks.js';

export const INTERVIEW_TRANSCRIBE_JOB = 'interviews.transcribe';

export interface InterviewsDeps {
  ai: AiTasksService;
  aiSettings: AiSettingsService;
  usage: AiUsageService;
  files: FilesService;
  jobs: JobQueue;
  media: MediaTools;
  /** The platform's Whisper service (WHISPER_URL), tried first (E3). */
  whisper: TranscriptionProvider | null;
  profiles: ProfilesService;
  logger: Logger;
  /** A drive the viewer can see: its company, title and role text (null otherwise). */
  drive: (
    viewer: AuthState,
    driveId: string,
  ) => Promise<{ company: string; title: string; text: string } | null>;
  /** The viewer is the alumnus a mock-interview request shared this report with (open or accepted). */
  isMockMentor: (viewer: AuthState, interviewId: string) => Promise<boolean>;
}

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const utcDayStart = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s"“”'‘’.,!?।]+/g, ' ')
    .trim();
const DIFFICULTY_ORDER: Record<InterviewDifficulty, number> = { easy: 0, medium: 1, hard: 2 };

interface Candidate {
  ref: string;
  track: 'hr' | 'technical';
  difficulty: InterviewDifficulty;
  topic: string;
  text: string;
  rubric: string;
}

/** Fisher-Yates with a cryptographic source (question order is not guessable from a seed). */
function shuffled<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Nearest difficulty first, then random: a session at "hard" still gets questions if few are hard. */
function pick(cands: Candidate[], want: InterviewDifficulty, n: number, avoid: Set<string>): Candidate[] {
  const ranked = shuffled(cands).sort(
    (a, b) =>
      Number(avoid.has(a.ref)) - Number(avoid.has(b.ref)) ||
      Math.abs(DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[want]) -
        Math.abs(DIFFICULTY_ORDER[b.difficulty] - DIFFICULTY_ORDER[want]),
  );
  return ranked.slice(0, n);
}

/**
 * AI mock interviews (prompt 2, G3). A session draws 5 to 8 questions from the starter set and the
 * college's approved bank (a drive's role adds AI-written questions, which wait for faculty review
 * before they join the bank). Each answer, typed or recorded, is scored on the rubric with quotes
 * from the answer itself, may earn one follow-up, and the session ends with a summary. Recordings
 * are transcribed in the worker and deleted straight after (E3). No pass or fail, ever.
 */
export class InterviewsService {
  track: Track = noTrack;

  constructor(private readonly d: InterviewsDeps) {}

  // ── Views ─────────────────────────────

  private view(s: InterviewDoc, mine: boolean, ownerName: string): InterviewView {
    const current = s.turns.findIndex(
      (t) => t.status === 'open' || t.status === 'voice_failed' || t.status === 'transcribing',
    );
    return {
      id: String(s._id),
      track: s.track,
      branch: s.branch,
      drive: s.driveId
        ? { id: String(s.driveId), company: s.driveCompany ?? '', title: s.driveTitle ?? '' }
        : null,
      difficulty: s.difficulty,
      language: s.language,
      mode: s.mode,
      status: s.status,
      turns: s.turns.map((t, index) => ({
        index,
        kind: t.kind,
        text: t.text,
        topic: t.topic,
        status: t.status,
        answer: t.answer,
        answeredBy: t.answeredBy,
        scores: t.scores,
        evidence: t.evidence ?? {},
        tip: t.tip,
      })),
      current: s.status === 'in_progress' && current >= 0 ? current : null,
      planned: s.planned,
      summary: s.summary,
      unscored: s.turns.filter((t) => t.status === 'answered' && !t.scores).length,
      createdAt: s.createdAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
      mine,
      owner: { id: String(s.userId), name: ownerName },
    };
  }

  private listItem(s: InterviewDoc): InterviewListItem {
    return {
      id: String(s._id),
      track: s.track,
      company: s.driveCompany,
      difficulty: s.difficulty,
      status: s.status,
      averages: s.summary?.averages ?? null,
      createdAt: s.createdAt.toISOString(),
    };
  }

  /** Voice works when a transcription service is reachable for this college (else text only). */
  async voiceAvailable(): Promise<boolean> {
    return !!(await this.transcriber());
  }

  private async transcriber(): Promise<TranscriptionProvider | null> {
    if (this.d.whisper) return this.d.whisper;
    const rt = await this.d.aiSettings.runtime();
    if (!rt.settings.features.transcription) return null;
    const conn = this.d.aiSettings.openAiConnection(rt);
    return conn ? new OpenAiTranscriber(conn) : null;
  }

  async history(viewer: AuthState): Promise<InterviewHistoryView> {
    const rows = await InterviewModel.find({ userId: oid(viewer.userId) })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean<InterviewDoc[]>();
    const started = await InterviewModel.countDocuments({
      userId: oid(viewer.userId),
      createdAt: { $gte: utcDayStart() },
    });
    return {
      sessions: rows.map((r) => this.listItem(r)),
      trend: rows
        .filter((r) => r.status === 'completed' && r.summary)
        .slice(0, 12)
        .reverse()
        .map((r) => ({
          at: (r.completedAt ?? r.createdAt).toISOString(),
          averages: r.summary?.averages ?? averages([]),
        })),
      today: { started, limit: INTERVIEW_SESSIONS_PER_DAY },
      voiceAvailable: await this.voiceAvailable(),
    };
  }

  /** The owner's session, or one shared with the viewer for a human mock; anything else is not found. */
  async get(viewer: AuthState, id: string): Promise<InterviewView> {
    const s = await InterviewModel.findById(id).lean<InterviewDoc>();
    if (!s) throw notFound('Interview');
    const mine = String(s.userId) === viewer.userId;
    if (!mine && !(await this.d.isMockMentor(viewer, id))) throw notFound('Interview');
    const owner = (await this.d.profiles.refsFor([s.userId])).get(String(s.userId));
    return this.view(s, mine, owner?.name ?? '');
  }

  private async owned(viewer: AuthState, id: string): Promise<InterviewDoc> {
    const s = await InterviewModel.findOne({ _id: id, userId: oid(viewer.userId) }).lean<InterviewDoc>();
    if (!s) throw notFound('Interview');
    return s;
  }

  async owns(userId: string, id: string): Promise<boolean> {
    return !!(await InterviewModel.exists({ _id: id, userId: oid(userId), status: 'completed' }));
  }

  /**
   * Readiness (prompt 2, G5): each member's completed practice sessions since a date, newest first,
   * with their rubric averages (null where no answer was scored).
   */
  async completedFor(
    userIds: string[],
    since: Date,
  ): Promise<Map<string, { at: Date; averages: RubricScores | null }[]>> {
    const rows = await InterviewModel.find({
      userId: { $in: userIds.map(oid) },
      status: 'completed',
      completedAt: { $gte: since },
    })
      .select('userId completedAt summary')
      .sort({ completedAt: -1 })
      .limit(50_000)
      .lean<Pick<InterviewDoc, 'userId' | 'completedAt' | 'summary'>[]>();
    const out = new Map<string, { at: Date; averages: RubricScores | null }[]>();
    for (const r of rows) {
      const list = out.get(String(r.userId)) ?? [];
      list.push({ at: r.completedAt ?? new Date(0), averages: r.summary?.averages ?? null });
      out.set(String(r.userId), list);
    }
    return out;
  }

  // ── Starting ─────────────────────────────

  private async bank(track: 'hr' | 'technical', branch: Branch | null): Promise<Candidate[]> {
    const starters = STARTER_QUESTIONS.filter(
      (q) =>
        q.track === track &&
        (track === 'hr' || !q.branches.length || (!!branch && q.branches.includes(branch))),
    );
    const own = await InterviewQuestionModel.find({
      status: 'approved',
      track,
      ...(track === 'technical' ? { branch: { $in: [branch, null] } } : {}),
    })
      .limit(300)
      .lean<InterviewQuestionDoc[]>();
    return [
      ...starters.map((q) => ({
        ref: `starter:${q.id}`,
        track: q.track,
        difficulty: q.difficulty,
        topic: q.topic,
        text: q.text.en,
        rubric: q.rubric,
        starter: q,
      })),
      ...own.map((q) => ({
        ref: `bank:${String(q._id)}`,
        track: q.track,
        difficulty: q.difficulty,
        topic: q.topic,
        text: q.text,
        rubric: q.rubric,
      })),
    ];
  }

  /** The question in the session's language when the starter set has it, else as written. */
  private textFor(c: Candidate & { starter?: StarterQuestion }, language: InterviewDoc['language']): string {
    if (!c.starter || language === 'en' || language === 'mixed') return c.text;
    return c.starter.text[language] ?? c.text;
  }

  async create(viewer: AuthState, body: z.output<typeof interviewCreateBody>): Promise<InterviewView> {
    const started = await InterviewModel.countDocuments({
      userId: oid(viewer.userId),
      createdAt: { $gte: utcDayStart() },
    });
    if (started >= INTERVIEW_SESSIONS_PER_DAY)
      throw tooMany(
        `You can start ${INTERVIEW_SESSIONS_PER_DAY} practice interviews a day. Try again tomorrow.`,
      );
    const cohort = (await this.d.profiles.cohortOf([viewer.userId])).get(viewer.userId);
    const branch = (body.branch ?? cohort?.branch ?? null) as Branch | null;
    let drive: { company: string; title: string; text: string } | null = null;
    if (body.driveId) {
      drive = await this.d.drive(viewer, body.driveId);
      if (!drive) throw notFound('Drive');
    }

    // Questions the member saw in their last three sessions come last.
    const recent = await InterviewModel.find({ userId: oid(viewer.userId) })
      .sort({ createdAt: -1 })
      .limit(3)
      .select('turns.ref')
      .lean<InterviewDoc[]>();
    const avoid = new Set(recent.flatMap((r) => r.turns.map((t) => t.ref)));
    const hr = await this.bank('hr', null);
    const tech = await this.bank('technical', branch);
    const intro = hr.find((c) => c.ref === 'starter:hr-1');
    const n = body.questions;
    let chosen: Candidate[];
    if (body.track === 'hr') {
      chosen = [
        ...(intro ? [intro] : []),
        ...pick(
          hr.filter((c) => c !== intro),
          body.difficulty,
          n - 1,
          avoid,
        ),
      ];
    } else if (body.track === 'technical') {
      chosen = [...(intro ? [intro] : []), ...pick(tech, body.difficulty, n - 1, avoid)];
    } else {
      // A drive: the introduction, up to two questions written for its role, then technical and HR.
      const generated: Candidate[] = [];
      if (drive) {
        const g = await this.d.ai.run(viewer, driveQuestionsTask, {
          company: drive.company,
          role: drive.text.slice(0, 4000),
          count: 2,
        });
        if (g.ok)
          for (const q of g.output.questions.slice(0, 2)) {
            // Into the bank as pending: faculty review before anyone else is asked it.
            const saved = await InterviewQuestionModel.create({
              track: 'technical',
              branch,
              difficulty: body.difficulty,
              topic: q.topic,
              text: q.text,
              rubric: q.rubric,
              source: 'ai_generated',
              status: 'pending',
            });
            generated.push({
              ref: `bank:${String(saved._id)}`,
              track: 'technical',
              difficulty: body.difficulty,
              topic: q.topic,
              text: q.text,
              rubric: q.rubric,
            });
          }
      }
      const rest = n - 1 - generated.length;
      const techN = Math.ceil(rest / 2);
      chosen = [
        ...(intro ? [intro] : []),
        ...generated,
        ...pick(tech, body.difficulty, techN, avoid),
        ...pick(
          hr.filter((c) => c !== intro),
          body.difficulty,
          rest - techN,
          avoid,
        ),
      ];
    }
    if (chosen.length < 3) throw badRequest('There are not enough questions for this interview yet');

    const s = await InterviewModel.create({
      userId: oid(viewer.userId),
      track: body.track,
      branch,
      driveId: body.driveId ? oid(body.driveId) : null,
      driveCompany: drive?.company ?? null,
      driveTitle: drive?.title ?? null,
      difficulty: body.difficulty,
      language: body.language,
      mode: body.mode === 'voice' && !(await this.voiceAvailable()) ? 'text' : body.mode,
      planned: chosen.length,
      turns: chosen.map((c) => ({
        kind: 'question',
        ref: c.ref,
        topic: c.topic,
        text: this.textFor(c, body.language),
        rubric: c.rubric,
      })),
    });
    await this.track(viewer.userId, 'mock_started', {
      track: body.track,
      mode: s.mode,
      language: body.language,
    });
    return this.get(viewer, String(s._id));
  }

  // ── Answering ─────────────────────────────

  private currentIndex(s: InterviewDoc) {
    return s.turns.findIndex(
      (t) => t.status === 'open' || t.status === 'voice_failed' || t.status === 'transcribing',
    );
  }

  /** Checks the turn is the one waiting for an answer (a double submit answers nothing twice). */
  private answerable(s: InterviewDoc, turn: number, allow: InterviewTurnDoc['status'][]) {
    if (s.status !== 'in_progress') throw conflict('This interview has ended');
    if (this.currentIndex(s) !== turn || !allow.includes(s.turns[turn]?.status ?? 'answered'))
      throw conflict('That question was already answered. Reload to see the next one.');
  }

  async answer(
    viewer: AuthState,
    id: string,
    body: z.output<typeof interviewAnswerBody>,
  ): Promise<InterviewView> {
    const s = await this.owned(viewer, id);
    this.answerable(s, body.turn, ['open', 'voice_failed']);
    await this.applyAnswer(s, body.turn, body.text, 'text');
    return this.get(viewer, id);
  }

  async skip(viewer: AuthState, id: string, turn: number): Promise<InterviewView> {
    const s = await this.owned(viewer, id);
    this.answerable(s, turn, ['open', 'voice_failed']);
    const r = await InterviewModel.updateOne(
      { _id: s._id, rev: s.rev },
      { $set: { [`turns.${turn}.status`]: 'skipped' }, $inc: { rev: 1 } },
    );
    if (!r.modifiedCount) throw conflict('This interview changed in another tab. Reload it.');
    await this.completeIfDone(String(s._id));
    return this.get(viewer, id);
  }

  /** The member ends early: what is left is skipped and the summary covers what they answered. */
  async finish(viewer: AuthState, id: string): Promise<InterviewView> {
    const s = await this.owned(viewer, id);
    if (s.status !== 'in_progress') return this.get(viewer, id);
    if (s.turns.some((t) => t.status === 'transcribing'))
      throw conflict('Your last recording is still being transcribed. Try again in a moment.');
    const set: Record<string, string> = {};
    s.turns.forEach((t, i) => {
      if (t.status === 'open' || t.status === 'voice_failed') set[`turns.${i}.status`] = 'skipped';
    });
    await InterviewModel.updateOne({ _id: s._id, rev: s.rev }, { $set: set, $inc: { rev: 1 } });
    await this.completeIfDone(String(s._id));
    return this.get(viewer, id);
  }

  /**
   * Stores the answer first (so a slow model never loses it), then scores it and may add a
   * follow-up right after it. Quotes the model gives as evidence are kept only if they are in the
   * answer; correctness is never scored on an HR question.
   */
  private async applyAnswer(s: InterviewDoc, turn: number, text: string, by: 'text' | 'voice') {
    const stored = await InterviewModel.findOneAndUpdate(
      { _id: s._id, rev: s.rev },
      {
        $set: {
          [`turns.${turn}.status`]: 'answered',
          [`turns.${turn}.answer`]: text,
          [`turns.${turn}.answeredBy`]: by,
        },
        $inc: { rev: 1 },
      },
      { returnDocument: 'after' },
    ).lean<InterviewDoc>();
    if (!stored) throw conflict('This interview changed in another tab. Reload it.');
    const t = stored.turns[turn];
    if (!t) return;
    const followUps = stored.turns.filter((x) => x.kind === 'follow_up').length;
    const followUpAllowed = t.kind === 'question' && followUps < INTERVIEW_FOLLOW_UPS_MAX;
    const hrQuestion = stored.track === 'hr' || t.ref.startsWith('starter:hr-');
    const r = await this.d.ai.run({ userId: String(stored.userId) }, answerTask, {
      track: hrQuestion ? 'hr' : 'technical',
      language: stored.language,
      question: t.text,
      rubric: t.rubric,
      answer: text,
      followUpAllowed,
    });
    if (r.ok) {
      const scores = { ...r.output.scores, ...(hrQuestion ? { correctness: null } : {}) } as RubricScores;
      const evidence: Partial<Record<RubricDimension, string>> = {};
      const answerNorm = norm(text);
      for (const k of RUBRIC_DIMENSIONS) {
        const q = r.output.evidence[k];
        if (q && scores[k] !== null && norm(q).length >= 3 && answerNorm.includes(norm(q))) evidence[k] = q;
      }
      // One write of the whole list (a field update and an insert cannot share an update), and only
      // onto the version this answer was stored in.
      const turns = stored.turns.map((x, i) =>
        i === turn ? { ...x, scores, evidence, tip: r.output.tip || null } : x,
      );
      if (followUpAllowed && r.output.followUp)
        turns.splice(turn + 1, 0, {
          kind: 'follow_up',
          ref: 'follow_up',
          topic: t.topic,
          text: r.output.followUp,
          rubric: t.rubric,
          status: 'open',
          answer: null,
          answeredBy: null,
          audioFileId: null,
          scores: null,
          evidence: {},
          tip: null,
        });
      await InterviewModel.updateOne(
        { _id: stored._id, rev: stored.rev },
        { $set: { turns }, $inc: { rev: 1 } },
      );
    }
    await this.completeIfDone(String(s._id));
  }

  /** Every turn answered or skipped: the summary (deep tier, rules without AI) and the event. */
  private async completeIfDone(id: string) {
    const s = await InterviewModel.findById(id).lean<InterviewDoc>();
    if (!s || s.status !== 'in_progress' || this.currentIndex(s) >= 0) return;
    const answered = s.turns.filter((t) => t.status === 'answered' && t.answer);
    const input = {
      track: s.track,
      language: s.language,
      turns: answered.map((t) => ({ question: t.text, answer: t.answer ?? '', scores: t.scores })),
    };
    const out = answered.length
      ? await this.d.ai.run({ userId: String(s.userId) }, summaryTask, input)
      : ({ ok: false } as const);
    const body = out.ok ? out.output : ruleSummary(input);
    const done = await InterviewModel.updateOne(
      { _id: s._id, rev: s.rev, status: 'in_progress' },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          summary: {
            ...body,
            averages: averages(answered.map((t) => t.scores)),
            source: out.ok && out.source === 'ai' ? 'ai' : 'rules',
          },
        },
        $inc: { rev: 1 },
      },
    );
    if (done.modifiedCount)
      await this.track(s.userId, 'mock_completed', { track: s.track, answered: String(answered.length) });
  }

  // ── Voice ─────────────────────────────

  /** A recorded answer: stored briefly, transcribed in the worker, then deleted (E3). */
  async audio(viewer: AuthState, id: string, turn: number, file: Buffer | undefined): Promise<InterviewView> {
    if (!file?.length) throw badRequest('Record an answer first');
    const s = await this.owned(viewer, id);
    this.answerable(s, turn, ['open', 'voice_failed']);
    if (!(await this.voiceAvailable()))
      throw badRequest('Voice answers are not available right now: type your answer');
    const stored = await this.d.files.storeInterviewAudio(viewer.userId, file);
    const r = await InterviewModel.updateOne(
      { _id: s._id, rev: s.rev },
      {
        $set: { [`turns.${turn}.status`]: 'transcribing', [`turns.${turn}.audioFileId`]: oid(stored.id) },
        $inc: { rev: 1 },
      },
    );
    if (!r.modifiedCount) {
      await this.d.files.remove(stored.id);
      throw conflict('This interview changed in another tab. Reload it.');
    }
    await this.d.jobs.enqueue(
      INTERVIEW_TRANSCRIBE_JOB,
      { tenantId: String(requireTenantId()), interviewId: id, turn, fileId: stored.id },
      { jobId: `interview-${id}-${turn}` },
    );
    return this.get(viewer, id);
  }

  /**
   * Job: transcribe one recording and delete it whatever happens. An empty or failed transcript
   * hands the turn back to the text box (`voice_failed`), never loses the question.
   */
  async onTranscribe(job: TenantJob) {
    const id = String(job.interviewId);
    const turn = Number(job.turn);
    const fileId = String(job.fileId);
    let text = '';
    try {
      const s = await InterviewModel.findById(id).lean<InterviewDoc>();
      const t = s?.turns[turn];
      if (!s || !t || t.status !== 'transcribing' || String(t.audioFileId) !== fileId) return;
      const transcriber = await this.transcriber();
      const data = await this.d.files.read(fileId).catch(() => null);
      const mp3 = data && transcriber ? await this.d.media.audio(data) : null;
      if (mp3 && transcriber) {
        const language = s.language === 'mixed' ? null : s.language;
        const segments = await transcriber.transcribe(mp3, language).catch((e: unknown) => {
          this.d.logger.warn({ err: e }, 'interview transcription failed');
          return [];
        });
        text = segments
          .map((x) => x.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 4000);
        await this.d.usage.record({
          kind: 'transcription',
          model: `${transcriber.id}:transcription`,
          userId: String(s.userId),
          inputTokens: 0,
        });
      }
    } finally {
      await this.d.files.remove(fileId).catch(() => undefined);
    }
    const s = await InterviewModel.findById(id).lean<InterviewDoc>();
    if (!s || s.turns[turn]?.status !== 'transcribing') return;
    const cleared = await InterviewModel.findOneAndUpdate(
      { _id: s._id, rev: s.rev },
      {
        $set: {
          [`turns.${turn}.audioFileId`]: null,
          ...(text ? {} : { [`turns.${turn}.status`]: 'voice_failed' }),
        },
        $inc: { rev: 1 },
      },
      { returnDocument: 'after' },
    ).lean<InterviewDoc>();
    if (cleared && text) await this.applyAnswer(cleared, turn, text, 'voice');
  }

  // ── Human follow-up ─────────────────────────────

  /** A mock interview request was sent (with or without this report): the event G3 asks for. */
  async mockBooked(menteeId: string, interviewId: string | null) {
    await this.track(menteeId, 'human_mock_booked', interviewId ? { shared: 'report' } : { shared: 'none' });
  }

  // ── The question bank ─────────────────────────────

  private async questionViews(rows: InterviewQuestionDoc[]): Promise<InterviewQuestionView[]> {
    const refs = await this.d.profiles.refsFor(rows.flatMap((r) => (r.reviewedBy ? [r.reviewedBy] : [])));
    return rows.map((q) => ({
      id: String(q._id),
      track: q.track,
      branch: q.branch,
      difficulty: q.difficulty,
      topic: q.topic,
      text: q.text,
      rubric: q.rubric,
      source: q.source,
      status: q.status,
      reviewedBy: q.reviewedBy
        ? { id: String(q.reviewedBy), name: refs.get(String(q.reviewedBy))?.name ?? '' }
        : null,
      createdAt: q.createdAt.toISOString(),
    }));
  }

  async questions(status: InterviewQuestionDoc['status']): Promise<InterviewQuestionView[]> {
    const rows = await InterviewQuestionModel.find({ status })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean<InterviewQuestionDoc[]>();
    return this.questionViews(rows);
  }

  /** Faculty write a question straight into the bank (their review is the writing). */
  async addQuestion(viewer: AuthState, body: z.output<typeof interviewQuestionBody>) {
    const q = await InterviewQuestionModel.create({
      ...body,
      branch: body.track === 'hr' ? null : body.branch,
      source: 'faculty',
      status: 'approved',
      createdBy: oid(viewer.userId),
      reviewedBy: oid(viewer.userId),
      reviewedAt: new Date(),
    });
    return (await this.questionViews([q.toObject() as InterviewQuestionDoc]))[0];
  }

  async decide(viewer: AuthState, id: string, body: z.output<typeof interviewQuestionDecisionBody>) {
    const q = await InterviewQuestionModel.findOneAndUpdate(
      { _id: id, status: 'pending' },
      {
        $set: {
          status: body.decision === 'approve' ? 'approved' : 'rejected',
          reviewedBy: oid(viewer.userId),
          reviewedAt: new Date(),
          ...(body.decision === 'approve' && body.text ? { text: body.text } : {}),
          ...(body.decision === 'approve' && body.rubric ? { rubric: body.rubric } : {}),
        },
      },
      { returnDocument: 'after' },
    ).lean<InterviewQuestionDoc>();
    if (!q) {
      if (await InterviewQuestionModel.exists({ _id: id }))
        throw conflict('This question was already reviewed');
      throw notFound('Question');
    }
    return (await this.questionViews([q]))[0];
  }

  async pendingCount(): Promise<number> {
    return InterviewQuestionModel.countDocuments({ status: 'pending' });
  }

  // ── Privacy ─────────────────────────────

  /** Data export: every session with the questions, answers (typed or transcribed), scores and summary. */
  async exportFor(userId: string) {
    const rows = await InterviewModel.find({ userId: oid(userId) }).lean<InterviewDoc[]>();
    return {
      interviews: rows.map((s) => ({
        track: s.track,
        company: s.driveCompany,
        difficulty: s.difficulty,
        language: s.language,
        mode: s.mode,
        status: s.status,
        createdAt: s.createdAt,
        turns: s.turns.map((t) => ({
          kind: t.kind,
          question: t.text,
          answer: t.answer,
          answeredBy: t.answeredBy,
          scores: t.scores,
          evidence: t.evidence,
          tip: t.tip,
        })),
        summary: s.summary,
      })),
      questionsWritten: await InterviewQuestionModel.find({ createdBy: oid(userId) })
        .select('track topic text rubric status createdAt')
        .lean(),
    };
  }

  /** Erasure: their sessions and any recording still waiting; questions they wrote stay with the college, unattributed. */
  async eraseFor(userId: string) {
    const rows = await InterviewModel.find({ userId: oid(userId) })
      .select('turns.audioFileId')
      .lean<InterviewDoc[]>();
    for (const s of rows)
      for (const t of s.turns)
        if (t.audioFileId) await this.d.files.remove(t.audioFileId).catch(() => undefined);
    await InterviewModel.deleteMany({ userId: oid(userId) });
    await InterviewQuestionModel.updateMany({ createdBy: oid(userId) }, { $set: { createdBy: null } });
    await InterviewQuestionModel.updateMany({ reviewedBy: oid(userId) }, { $set: { reviewedBy: null } });
  }
}
