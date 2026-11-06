import { randomInt } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  PRACTICE_COMPANY_SETS_PER_DAY,
  PRACTICE_MASTERY_DAYS,
  PRACTICE_MIN_ATTEMPTS,
  PRACTICE_SET_SIZE,
  PRACTICE_TOPICS,
  PRACTICE_WEAK_BELOW,
  SMALL_CELL,
  addDays,
  areaOfTopic,
  checkAnswer,
  currentStreak,
  nextCard,
  planSet,
  suppress,
  type PracticeCompanyView,
  type PracticeHomeView,
  type PracticeItemPublic,
  type PracticeItemView,
  type PracticeMasteryView,
  type PracticeSetView,
  type PracticeStatus,
  type PracticeTopic,
  type PracticeTopicStat,
  type practiceAnswerBody,
  type practiceDecisionBody,
  type practiceDraftBody,
  type practiceItemBody,
  type practiceItemsQuery,
  type practiceStartBody,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { badRequest, conflict, notFound, tooMany } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import type { Award } from '../../lib/awards.js';
import { noAward } from '../../lib/awards.js';
import { companyKey } from '../../lib/company.js';
import type { Logger } from '../../lib/logger.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import type { AiTasksService } from '../ai-tasks/ai-tasks.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import { dayKey } from '../gamification/gamification.service.js';
import type { CodeRunner } from './code-runner.js';
import {
  PracticeCardModel,
  PracticeItemModel,
  PracticeSetModel,
  type PracticeCardDoc,
  type PracticeItemDoc,
  type PracticeSetDoc,
} from './practice.model.js';
import { draftTask, usableDrafts } from './practice-tasks.js';
import { STARTER_ITEMS } from './starter-items.js';

export interface PracticeDeps {
  ai: AiTasksService;
  runner: CodeRunner;
  profiles: ProfilesService;
  logger: Logger;
  /** Companies that recruit through the college, with the next open drive's closing time. */
  companies: () => Promise<{ key: string; name: string; nextDriveCloses: Date | null }[]>;
}

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
type ItemInput = z.output<typeof practiceItemBody>;

function shuffled<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}
const isDuplicate = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 11000;

/** Companies as written, de-duplicated by their comparable key. */
function companyTags(names: readonly string[]): { key: string; name: string }[] {
  const out = new Map<string, string>();
  for (const n of names) {
    const key = companyKey(n);
    if (key && !out.has(key)) out.set(key, n.trim());
  }
  return [...out].map(([key, name]) => ({ key, name }));
}

/**
 * Aptitude and coding practice (prompt 2, G4). Each day a member gets up to ten items: earlier
 * mistakes that are due again (Leitner boxes), then new items weighted to their weak topics. A
 * company prep set draws from items tagged with that company. Answers are checked here; coding
 * answers only through the platform's CodeRunner, and coding items are served only when it is on.
 */
export class PracticeService {
  track: Track = noTrack;
  award: Award = noAward;
  private readonly seeded = new Set<string>();

  constructor(private readonly d: PracticeDeps) {}

  // ── The bank ─────────────────────────────

  /** Copies the starter set into this college's bank once (missing items only; safe to race). */
  private async ensureStarter() {
    const tenant = String(requireTenantId());
    if (this.seeded.has(tenant)) return;
    const have = new Set(
      (
        await PracticeItemModel.find({ starterRef: { $type: 'string' } })
          .select('starterRef')
          .lean<{ starterRef: string }[]>()
      ).map((r) => r.starterRef),
    );
    const missing = STARTER_ITEMS.filter((s) => !have.has(s.ref));
    if (missing.length)
      await PracticeItemModel.insertMany(
        missing.map((s) => ({
          kind: s.kind,
          topic: s.topic,
          difficulty: s.difficulty,
          companies: [],
          text: s.text,
          code: s.code ?? '',
          codeLanguage: s.codeLanguage ?? null,
          options: s.options ?? [],
          answer: s.answer,
          tolerance: s.tolerance ?? null,
          explanation: s.explanation,
          tests: s.tests ?? [],
          source: 'starter',
          status: 'approved',
          starterRef: s.ref,
        })),
        { ordered: false },
      ).catch((e: unknown) => {
        if (!isDuplicate(e) && !(e instanceof Error && /E11000/.test(e.message))) throw e;
      });
    this.seeded.add(tenant);
  }

  /** What a member can be served: approved, and coding only when code runs are on. */
  private servable(): Record<string, unknown> {
    return {
      status: 'approved',
      ...(this.d.runner.enabled ? {} : { kind: { $ne: 'coding' } }),
    };
  }

  private publicItem(i: PracticeItemDoc): PracticeItemPublic {
    return {
      id: String(i._id),
      kind: i.kind,
      topic: i.topic,
      difficulty: i.difficulty,
      text: i.text,
      code: i.code,
      codeLanguage: i.codeLanguage,
      options: i.options,
      companies: i.companies.map((c) => c.name),
    };
  }

  private shownAnswer(i: PracticeItemDoc): string {
    if (i.kind === 'mcq') return i.options[Number(i.answer)] ?? '';
    if (i.kind === 'coding') return '';
    return i.answer;
  }

  // ── Member: today, sets and answers ─────────────────────────────

  private today() {
    return dayKey(new Date());
  }

  /** Per-topic attempts and accuracy over the mastery window, from the member's answered sets. */
  private async topicStats(userId: string): Promise<PracticeTopicStat[]> {
    const since = new Date(Date.now() - PRACTICE_MASTERY_DAYS * 86_400_000);
    const rows = await PracticeSetModel.aggregate<{ _id: PracticeTopic; attempts: number; right: number }>([
      { $match: { userId: oid(userId), createdAt: { $gte: since } } },
      { $unwind: '$answers' },
      { $project: { topic: { $arrayElemAt: ['$topics', '$answers.index'] }, correct: '$answers.correct' } },
      { $group: { _id: '$topic', attempts: { $sum: 1 }, right: { $sum: { $cond: ['$correct', 1, 0] } } } },
    ]);
    return rows
      .filter((r) => (PRACTICE_TOPICS as string[]).includes(r._id))
      .map((r) => {
        const accuracy = r.attempts >= PRACTICE_MIN_ATTEMPTS ? r.right / r.attempts : null;
        return {
          topic: r._id,
          area: areaOfTopic(r._id),
          attempts: r.attempts,
          accuracy,
          weak: accuracy !== null && accuracy < PRACTICE_WEAK_BELOW,
        };
      })
      .sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2) || b.attempts - a.attempts);
  }

  private async companyList(): Promise<PracticeCompanyView[]> {
    const counts = await PracticeItemModel.aggregate<{ _id: string; name: string; items: number }>([
      { $match: this.servable() },
      { $unwind: '$companies' },
      { $group: { _id: '$companies.key', name: { $first: '$companies.name' }, items: { $sum: 1 } } },
    ]);
    const recruiting = new Map((await this.d.companies()).map((c) => [c.key, c]));
    return counts
      .map((c) => {
        const r = recruiting.get(c._id);
        return {
          key: c._id,
          name: r?.name ?? c.name,
          items: c.items,
          nextDriveCloses: r?.nextDriveCloses?.toISOString() ?? null,
        };
      })
      .sort(
        (a, b) =>
          Number(!a.nextDriveCloses) - Number(!b.nextDriveCloses) ||
          (a.nextDriveCloses ?? '').localeCompare(b.nextDriveCloses ?? '') ||
          a.name.localeCompare(b.name),
      );
  }

  async home(viewer: AuthState): Promise<PracticeHomeView> {
    await this.ensureStarter();
    const today = this.today();
    const [set, finished, topics, companies, companySetsToday, mineWaiting] = await Promise.all([
      PracticeSetModel.findOne({
        userId: oid(viewer.userId),
        kind: 'daily',
        day: today,
      }).lean<PracticeSetDoc>(),
      PracticeSetModel.find({
        userId: oid(viewer.userId),
        kind: 'daily',
        completedAt: { $ne: null },
        day: { $gte: addDays(today, -400) },
      })
        .select('day')
        .lean<{ day: string }[]>(),
      this.topicStats(viewer.userId),
      this.companyList(),
      PracticeSetModel.countDocuments({ userId: oid(viewer.userId), kind: 'company', day: today }),
      PracticeItemModel.countDocuments({ createdBy: oid(viewer.userId), status: 'pending' }),
    ]);
    const days = finished.map((s) => s.day);
    const cutoff = addDays(today, -29);
    return {
      today: {
        setId: set ? String(set._id) : null,
        answered: set?.answers.length ?? 0,
        size: set?.itemIds.length ?? PRACTICE_SET_SIZE,
        completed: !!set?.completedAt,
      },
      streak: currentStreak(days, today),
      days: days.filter((d) => d >= cutoff).sort(),
      topics,
      companies,
      companySetsLeft: Math.max(0, PRACTICE_COMPANY_SETS_PER_DAY - companySetsToday),
      runner: this.d.runner.enabled,
      mineWaiting,
    };
  }

  private async setView(s: PracticeSetDoc): Promise<PracticeSetView> {
    const items = new Map(
      (await PracticeItemModel.find({ _id: { $in: s.itemIds } }).lean<PracticeItemDoc[]>()).map((i) => [
        String(i._id),
        i,
      ]),
    );
    const answers = new Map(s.answers.map((a) => [a.index, a]));
    const out: PracticeSetView['items'] = [];
    s.itemIds.forEach((id, index) => {
      const i = items.get(String(id));
      if (!i) return; // erased or deleted since: the set simply shows fewer items
      const a = answers.get(index);
      out.push({
        index,
        item: this.publicItem(i),
        result: a
          ? {
              given: a.given,
              correct: a.correct,
              answer: this.shownAnswer(i),
              explanation: i.explanation,
              run: a.run,
              at: a.at.toISOString(),
            }
          : null,
      });
    });
    return {
      id: String(s._id),
      kind: s.kind,
      company: s.companyKey ? { key: s.companyKey, name: s.companyName ?? s.companyKey } : null,
      day: s.day,
      items: out,
      answered: s.answers.length,
      correct: s.answers.filter((a) => a.correct).length,
      completedAt: s.completedAt?.toISOString() ?? null,
    };
  }

  /** Chooses up to ten items for a member (spaced repetition), optionally from one company's tags. */
  private async plan(userId: string, company: string | null): Promise<PracticeItemDoc[]> {
    const today = this.today();
    const filter = { ...this.servable(), ...(company ? { 'companies.key': company } : {}) };
    const [pool, cards, stats] = await Promise.all([
      PracticeItemModel.find(filter)
        .select('_id topic')
        .limit(5000)
        .lean<Pick<PracticeItemDoc, '_id' | 'topic'>[]>(),
      PracticeCardModel.find({ userId: oid(userId) }).lean<PracticeCardDoc[]>(),
      this.topicStats(userId),
    ]);
    const inPool = new Map(pool.map((i) => [String(i._id), i]));
    const seen = new Map(cards.map((c) => [String(c.itemId), c]));
    const toPlan = (c: PracticeCardDoc) => ({ id: String(c.itemId), topic: c.topic });
    const live = cards.filter((c) => inPool.has(String(c.itemId)));
    const due = live.filter((c) => c.due <= today).sort((a, b) => a.due.localeCompare(b.due));
    const later = live.filter((c) => c.due > today).sort((a, b) => a.due.localeCompare(b.due));
    const ids = planSet({
      due: due.map(toPlan),
      fresh: pool.filter((i) => !seen.has(String(i._id))).map((i) => ({ id: String(i._id), topic: i.topic })),
      later: later.map(toPlan),
      weak: new Set(stats.filter((s) => s.weak).map((s) => s.topic)),
      shuffle: shuffled,
    });
    const docs = new Map(
      (await PracticeItemModel.find({ _id: { $in: ids.map(oid) } }).lean<PracticeItemDoc[]>()).map((i) => [
        String(i._id),
        i,
      ]),
    );
    return ids.map((id) => docs.get(id)).filter((i): i is PracticeItemDoc => !!i);
  }

  /** Today's set (made once, then resumed), or a "Preparing for <company>" set. */
  async start(viewer: AuthState, body: z.output<typeof practiceStartBody>): Promise<PracticeSetView> {
    await this.ensureStarter();
    const today = this.today();
    const userId = oid(viewer.userId);
    if (!body.company) {
      const existing = await PracticeSetModel.findOne({
        userId,
        kind: 'daily',
        day: today,
      }).lean<PracticeSetDoc>();
      if (existing) return this.setView(existing);
    } else {
      const made = await PracticeSetModel.countDocuments({ userId, kind: 'company', day: today });
      if (made >= PRACTICE_COMPANY_SETS_PER_DAY)
        throw tooMany('You have done all of today\x27s company practice. More tomorrow.');
    }
    const company = body.company ? companyKey(body.company) || body.company : null;
    const items = await this.plan(viewer.userId, company);
    if (!items.length)
      throw notFound(
        company ? 'There are no practice questions for this company yet' : 'The practice bank is empty',
      );
    const companyName = company
      ? (items.flatMap((i) => i.companies).find((c) => c.key === company)?.name ?? company)
      : null;
    try {
      const s = await PracticeSetModel.create({
        userId,
        kind: company ? 'company' : 'daily',
        day: today,
        companyKey: company,
        companyName,
        itemIds: items.map((i) => i._id),
        topics: items.map((i) => i.topic),
      });
      return this.setView(s.toObject() as PracticeSetDoc);
    } catch (e) {
      // Two taps at once: the other request made today's set.
      if (!company && isDuplicate(e)) {
        const s = await PracticeSetModel.findOne({
          userId,
          kind: 'daily',
          day: today,
        }).lean<PracticeSetDoc>();
        if (s) return this.setView(s);
      }
      throw e;
    }
  }

  private async owned(viewer: AuthState, id: string): Promise<PracticeSetDoc> {
    const s = await PracticeSetModel.findOne({
      _id: oid(id),
      userId: oid(viewer.userId),
    }).lean<PracticeSetDoc>();
    if (!s) throw notFound('Practice set not found');
    return s;
  }

  async get(viewer: AuthState, id: string): Promise<PracticeSetView> {
    return this.setView(await this.owned(viewer, id));
  }

  /** Checks one answer, schedules the item again and, with the last answer, completes the set. */
  async answer(
    viewer: AuthState,
    id: string,
    body: z.output<typeof practiceAnswerBody>,
  ): Promise<PracticeSetView> {
    const s = await this.owned(viewer, id);
    const itemId = s.itemIds[body.index];
    if (!itemId) throw badRequest('There is no such question in this set');
    if (s.answers.some((a) => a.index === body.index)) throw conflict('This question is already answered');
    const item = await PracticeItemModel.findById(itemId).lean<PracticeItemDoc>();
    if (!item) throw notFound('This question has been removed');

    let correct: boolean;
    let run: PracticeSetDoc['answers'][number]['run'] = null;
    if (item.kind === 'coding') {
      if (!body.answer.trim()) correct = false;
      else {
        if (!this.d.runner.enabled) throw conflict('Code runs are not available right now');
        const language = body.codeLanguage ?? item.codeLanguage ?? 'python';
        const r = await this.d.runner.run(body.answer, language, item.tests);
        // A runner outage is not the member's mistake: nothing is recorded, they can try again.
        if (r.status === 'error') throw conflict(r.message || 'The code runner is not available right now');
        run = r;
        correct = r.status === 'passed';
      }
    } else correct = checkAnswer(item, body.answer);

    const answer = { index: body.index, given: body.answer.slice(0, 6000), correct, run, at: new Date() };
    const updated = await PracticeSetModel.findOneAndUpdate(
      { _id: s._id, userId: s.userId, 'answers.index': { $ne: body.index } },
      { $push: { answers: answer } },
      { returnDocument: 'after' },
    ).lean<PracticeSetDoc>();
    if (!updated) throw conflict('This question is already answered');

    const today = this.today();
    const card = await PracticeCardModel.findOne({ userId: s.userId, itemId }).lean<PracticeCardDoc>();
    const next = nextCard(card?.box ?? null, correct, today);
    await PracticeCardModel.updateOne(
      { userId: s.userId, itemId },
      {
        $set: { topic: item.topic, box: next.box, due: next.due, lastCorrect: correct },
        $inc: { reps: 1, lapses: correct ? 0 : 1 },
      },
      { upsert: true },
    );

    if (updated.answers.length >= updated.itemIds.length && !updated.completedAt) {
      const done = await PracticeSetModel.findOneAndUpdate(
        { _id: s._id, completedAt: null },
        { $set: { completedAt: new Date() } },
        { returnDocument: 'after' },
      ).lean<PracticeSetDoc>();
      if (done) {
        const right = done.answers.filter((a) => a.correct).length;
        await this.track(viewer.userId, 'practice_set_completed', {
          kind: done.kind,
          correct: String(right),
          size: String(done.itemIds.length),
        });
        if (done.kind === 'daily') await this.award(viewer.userId, 'practice_set', String(done._id));
        return this.setView(done);
      }
    }
    return this.setView(updated);
  }

  // ── Authors and reviewers ─────────────────────────────

  private async names(ids: (Types.ObjectId | null)[]) {
    const real = ids.filter((i): i is Types.ObjectId => !!i);
    return real.length ? await this.d.profiles.cohortOf(real) : new Map<string, { name: string }>();
  }

  private async itemViews(rows: PracticeItemDoc[]): Promise<PracticeItemView[]> {
    const people = await this.names(rows.flatMap((r) => [r.createdBy, r.reviewedBy]));
    const person = (id: Types.ObjectId | null) =>
      id ? { id: String(id), name: people.get(String(id))?.name ?? '' } : null;
    return rows.map((i) => ({
      ...this.publicItem(i),
      answer: i.answer,
      tolerance: i.tolerance,
      explanation: i.explanation,
      tests: i.tests,
      source: i.source,
      status: i.status,
      createdBy: person(i.createdBy),
      reviewedBy: person(i.reviewedBy),
      createdAt: i.createdAt.toISOString(),
    }));
  }

  private fields(b: ItemInput) {
    return {
      kind: b.kind,
      topic: b.topic,
      difficulty: b.difficulty,
      companies: companyTags(b.companies),
      text: b.text,
      code: b.code,
      codeLanguage: b.codeLanguage,
      options: b.kind === 'mcq' ? b.options : [],
      answer: b.kind === 'coding' ? '' : b.answer,
      tolerance: b.kind === 'numeric' ? b.tolerance : null,
      explanation: b.explanation,
      tests: b.kind === 'coding' ? b.tests : [],
    };
  }

  async items(query: z.output<typeof practiceItemsQuery>): Promise<PracticeItemView[]> {
    await this.ensureStarter();
    const rows = await PracticeItemModel.find({
      status: query.status,
      ...(query.topic ? { topic: query.topic } : {}),
    })
      .sort({ createdAt: query.status === 'pending' ? 1 : -1 })
      .limit(300)
      .lean<PracticeItemDoc[]>();
    return this.itemViews(rows);
  }

  /** Faculty items go straight into the bank; an alumnus's wait for a faculty decision. */
  async add(viewer: AuthState, body: ItemInput): Promise<PracticeItemView> {
    const reviewer = viewer.permissions.has('practice:review');
    const doc = await PracticeItemModel.create({
      ...this.fields(body),
      source: reviewer ? 'faculty' : 'alumni',
      status: reviewer ? 'approved' : 'pending',
      createdBy: oid(viewer.userId),
      ...(reviewer ? { reviewedBy: oid(viewer.userId), reviewedAt: new Date() } : {}),
    });
    const [view] = await this.itemViews([doc.toObject() as PracticeItemDoc]);
    return view as PracticeItemView;
  }

  /** A reviewer corrects an item or tags its companies (any status; the starter set included). */
  async update(viewer: AuthState, id: string, body: ItemInput): Promise<PracticeItemView> {
    const doc = await PracticeItemModel.findByIdAndUpdate(
      oid(id),
      { $set: { ...this.fields(body), reviewedBy: oid(viewer.userId), reviewedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean<PracticeItemDoc>();
    if (!doc) throw notFound('Practice question not found');
    const [view] = await this.itemViews([doc]);
    return view as PracticeItemView;
  }

  /** Approve (optionally corrected) or reject; rejecting an approved item retires it from new sets. */
  async decide(
    viewer: AuthState,
    id: string,
    body: z.output<typeof practiceDecisionBody>,
  ): Promise<PracticeItemView> {
    const status: PracticeStatus = body.decision === 'approve' ? 'approved' : 'rejected';
    const doc = await PracticeItemModel.findOneAndUpdate(
      { _id: oid(id), status: { $ne: status } },
      {
        $set: {
          ...(body.decision === 'approve' && body.edit ? this.fields(body.edit) : {}),
          status,
          reviewedBy: oid(viewer.userId),
          reviewedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    ).lean<PracticeItemDoc>();
    if (!doc) {
      if (await PracticeItemModel.exists({ _id: oid(id) })) throw conflict('Already decided');
      throw notFound('Practice question not found');
    }
    const [view] = await this.itemViews([doc]);
    return view as PracticeItemView;
  }

  /** AI drafts for one topic, straight into the review queue (never served before a decision). */
  async draft(
    viewer: AuthState,
    body: z.output<typeof practiceDraftBody>,
  ): Promise<{ drafted: number; dropped: number; reason: string | null }> {
    await this.ensureStarter();
    const existing = (
      await PracticeItemModel.find({ topic: body.topic, status: { $ne: 'rejected' } })
        .select('text')
        .sort({ createdAt: -1 })
        .limit(30)
        .lean<{ text: string }[]>()
    ).map((i) => i.text);
    const r = await this.d.ai.run(viewer, draftTask, {
      topic: body.topic,
      kind: body.kind,
      difficulty: body.difficulty,
      count: body.count,
      existing,
    });
    if (!r.ok) return { drafted: 0, dropped: 0, reason: r.reason };
    const usable = usableDrafts(body.kind, r.output.items).slice(0, body.count);
    if (usable.length)
      await PracticeItemModel.insertMany(
        usable.map((dft) => ({
          kind: body.kind,
          topic: body.topic,
          difficulty: body.difficulty,
          companies: companyTags(body.companies),
          text: dft.text,
          code: body.kind === 'output_prediction' ? dft.code : '',
          codeLanguage: body.kind === 'output_prediction' ? dft.codeLanguage : null,
          options: body.kind === 'mcq' ? dft.options : [],
          answer: dft.answer,
          tolerance: null,
          explanation: dft.explanation,
          tests: [],
          source: 'ai_generated',
          status: 'pending',
          createdBy: oid(viewer.userId),
        })),
      );
    return { drafted: usable.length, dropped: r.output.items.length - usable.length, reason: null };
  }

  async pendingCount(): Promise<number> {
    return PracticeItemModel.countDocuments({ status: 'pending' });
  }

  // ── Staff: topic mastery by batch ─────────────────────────────

  /**
   * Who practised which topic and how accurately, by graduation year, for planning training.
   * Counts below five are shown as "<5", and accuracy only for groups of five or more.
   */
  /**
   * Readiness (prompt 2, G5): per member since a date, daily sets completed and answers given and
   * right (all practice sets), for the practice part of the readiness score.
   */
  async readinessFacts(
    userIds: string[],
    since: Date,
  ): Promise<Map<string, { sets: number; attempts: number; right: number }>> {
    const rows = await PracticeSetModel.find({
      userId: { $in: userIds.map((u) => new Types.ObjectId(u)) },
      createdAt: { $gte: since },
    })
      .select('userId kind completedAt answers.correct')
      .limit(100_000)
      .lean<Pick<PracticeSetDoc, 'userId' | 'kind' | 'completedAt' | 'answers'>[]>();
    const out = new Map<string, { sets: number; attempts: number; right: number }>();
    for (const s of rows) {
      const u = String(s.userId);
      const f = out.get(u) ?? { sets: 0, attempts: 0, right: 0 };
      if (s.kind === 'daily' && s.completedAt) f.sets++;
      f.attempts += s.answers.length;
      f.right += s.answers.filter((a) => a.correct).length;
      out.set(u, f);
    }
    return out;
  }

  async mastery(query: { gradYear?: number | undefined }): Promise<PracticeMasteryView> {
    const since = new Date(Date.now() - PRACTICE_MASTERY_DAYS * 86_400_000);
    const rows = await PracticeSetModel.aggregate<{
      _id: { userId: Types.ObjectId; topic: PracticeTopic };
      attempts: number;
      right: number;
    }>([
      { $match: { createdAt: { $gte: since } } },
      { $unwind: '$answers' },
      {
        $project: {
          userId: 1,
          topic: { $arrayElemAt: ['$topics', '$answers.index'] },
          correct: '$answers.correct',
        },
      },
      {
        $group: {
          _id: { userId: '$userId', topic: '$topic' },
          attempts: { $sum: 1 },
          right: { $sum: { $cond: ['$correct', 1, 0] } },
        },
      },
    ]);
    const cohort = await this.d.profiles.cohortOf([...new Set(rows.map((r) => String(r._id.userId)))]);
    type Acc = {
      students: Set<string>;
      topics: Map<PracticeTopic, { students: Set<string>; attempts: number; right: number }>;
    };
    const byYear = new Map<number | null, Acc>();
    for (const r of rows) {
      const year = cohort.get(String(r._id.userId))?.gradYear ?? null;
      if (query.gradYear !== undefined && year !== query.gradYear) continue;
      if (!(PRACTICE_TOPICS as string[]).includes(r._id.topic)) continue;
      const acc = byYear.get(year) ?? { students: new Set(), topics: new Map() };
      byYear.set(year, acc);
      const u = String(r._id.userId);
      acc.students.add(u);
      const t = acc.topics.get(r._id.topic) ?? { students: new Set(), attempts: 0, right: 0 };
      acc.topics.set(r._id.topic, t);
      t.students.add(u);
      t.attempts += r.attempts;
      t.right += r.right;
    }
    return {
      since: since.toISOString(),
      batches: [...byYear]
        .sort(([a], [b]) => (b ?? 0) - (a ?? 0))
        .map(([gradYear, acc]) => ({
          gradYear,
          students: suppress(acc.students.size),
          topics: [...acc.topics]
            .map(([topic, t]) => ({
              topic,
              area: areaOfTopic(topic),
              students: suppress(t.students.size),
              accuracy:
                t.students.size >= SMALL_CELL && t.attempts
                  ? Math.round((t.right / t.attempts) * 100) / 100
                  : null,
            }))
            .sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2)),
        })),
    };
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    const [sets, cards, written] = await Promise.all([
      PracticeSetModel.find({ userId: oid(userId) }).lean<PracticeSetDoc[]>(),
      PracticeCardModel.find({ userId: oid(userId) }).lean<PracticeCardDoc[]>(),
      PracticeItemModel.find({ createdBy: oid(userId) })
        .select('kind topic text options answer explanation status createdAt')
        .lean(),
    ]);
    return {
      practiceSets: sets.map((s) => ({
        kind: s.kind,
        day: s.day,
        company: s.companyName,
        topics: s.topics,
        answers: s.answers.map((a) => ({
          question: a.index + 1,
          given: a.given,
          correct: a.correct,
          at: a.at,
        })),
        completedAt: s.completedAt,
      })),
      practiceSchedule: cards.map((c) => ({
        topic: c.topic,
        box: c.box,
        due: c.due,
        reps: c.reps,
        lapses: c.lapses,
      })),
      practiceQuestionsWritten: written,
    };
  }

  /** Erasure: their sets and schedule go; questions they wrote stay with the college, unattributed. */
  async eraseFor(userId: string) {
    await PracticeSetModel.deleteMany({ userId: oid(userId) });
    await PracticeCardModel.deleteMany({ userId: oid(userId) });
    await PracticeItemModel.updateMany({ createdBy: oid(userId) }, { $set: { createdBy: null } });
    await PracticeItemModel.updateMany({ reviewedBy: oid(userId) }, { $set: { reviewedBy: null } });
  }
}
