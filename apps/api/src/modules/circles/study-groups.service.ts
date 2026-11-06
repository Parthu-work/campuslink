import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  STUDY_GROUP_MAX,
  STUDY_GROUP_MIN,
  STUDY_GROUP_QUESTIONS_MAX,
  type QuizQuestion,
  type StudyGroupQuizView,
  type StudyGroupView,
  type studyGroupBody,
} from '@campuslink/shared';
import type { AuthState } from '../../types.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { plainText } from '../../lib/text.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import { sameAnswer } from '../study/chat.service.js';
import { StudyGroupModel, type StudyGroupDoc } from './circle.model.js';

export interface StudyGroupsDeps {
  profiles: ProfilesService;
  /** The study subject, if the viewer may read it (404 otherwise). */
  subject: (viewer: AuthState, id: string) => Promise<{ id: string; name: string }>;
  /** One of the viewer's own `/quiz` answers from the study assistant. */
  quizOf: (viewer: AuthState, messageId: string) => Promise<{ topic: string; questions: QuizQuestion[] }>;
  /** The viewer's recent /quiz answers (to pick one to share). */
  recentQuizzes: (
    viewer: AuthState,
  ) => Promise<{ id: string; topic: string; questions: number; createdAt: string }[]>;
}

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const GROUPS_PER_MEMBER = 10;
const QUIZZES_MAX = 20;

/**
 * Study groups (prompt 2, G7): 3 to 6 members on one study subject, with a shared list of
 * questions to work through, the next session's time and place, and quizzes a member shares from
 * the study assistant's /quiz for the whole group to take. A group "forms" when its third member
 * joins (the `study_group_formed` event); it never grows past six.
 */
export class StudyGroupsService {
  track: Track = noTrack;

  constructor(private readonly d: StudyGroupsDeps) {}

  private async views(viewer: AuthState, rows: StudyGroupDoc[]): Promise<StudyGroupView[]> {
    const ids = [
      ...new Set(
        rows.flatMap((g) => [
          ...g.memberIds.map(String),
          ...g.questions.flatMap((q) => (q.by ? [String(q.by)] : [])),
          ...g.quizzes.flatMap((q) => (q.sharedBy ? [String(q.sharedBy)] : [])),
        ]),
      ),
    ];
    const people = ids.length ? await this.d.profiles.cohortOf(ids) : new Map<string, { name: string }>();
    const person = (id: Types.ObjectId | null) => ({
      id: id ? String(id) : '',
      name: id ? (people.get(String(id))?.name ?? '') : '',
    });
    return rows.map((g) => {
      const joined = g.memberIds.some((m) => String(m) === viewer.userId);
      return {
        id: String(g._id),
        subject: { id: String(g.subjectId), name: g.subjectName },
        name: g.name,
        members: g.memberIds.map((m) => person(m)),
        formed: g.memberIds.length >= STUDY_GROUP_MIN,
        joined,
        full: g.memberIds.length >= STUDY_GROUP_MAX,
        slot: g.slot ? { at: g.slot.at.toISOString(), place: g.slot.place } : null,
        // The question list and quizzes are for members only.
        questions: joined
          ? g.questions.map((q) => ({ id: String(q._id), text: q.text, by: person(q.by), done: q.done }))
          : [],
        quizzes: joined ? g.quizzes.map((q) => this.quizView(viewer, q, person)) : [],
        createdAt: g.createdAt.toISOString(),
      };
    });
  }

  private quizView(
    viewer: AuthState,
    q: StudyGroupDoc['quizzes'][number],
    person: (id: Types.ObjectId | null) => { id: string; name: string },
  ): StudyGroupQuizView {
    const mine = q.results.find((r) => String(r.userId) === viewer.userId);
    return {
      id: String(q._id),
      topic: q.topic,
      sharedBy: person(q.sharedBy),
      // Answers and explanations only after the member has answered.
      questions: q.questions.map((x) =>
        x.kind === 'mcq'
          ? { kind: 'mcq' as const, q: x.q, options: x.options }
          : { kind: 'short' as const, q: x.q },
      ),
      mine: mine
        ? {
            correct: mine.correct,
            total: mine.total,
            answers: mine.answers,
            key: q.questions.map((x) => ({ answer: x.answer, explain: x.explain })),
          }
        : null,
      taken: q.results.length,
      createdAt: q.createdAt.toISOString(),
    };
  }

  private async member(viewer: AuthState, id: string): Promise<StudyGroupDoc> {
    const g = await StudyGroupModel.findOne({
      _id: oid(id),
      memberIds: oid(viewer.userId),
    }).lean<StudyGroupDoc>();
    if (!g) throw notFound('Study group');
    return g;
  }

  /** Groups on a subject the viewer can read (theirs first), or all of their own groups. */
  async list(viewer: AuthState, subjectId?: string): Promise<StudyGroupView[]> {
    if (subjectId) {
      await this.d.subject(viewer, subjectId);
      const rows = await StudyGroupModel.find({ subjectId: oid(subjectId) })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean<StudyGroupDoc[]>();
      const views = await this.views(viewer, rows);
      return views.sort((a, b) => Number(b.joined) - Number(a.joined));
    }
    const rows = await StudyGroupModel.find({ memberIds: oid(viewer.userId) })
      .sort({ createdAt: -1 })
      .limit(GROUPS_PER_MEMBER)
      .lean<StudyGroupDoc[]>();
    return this.views(viewer, rows);
  }

  async get(viewer: AuthState, id: string): Promise<StudyGroupView> {
    const g = await StudyGroupModel.findById(oid(id)).lean<StudyGroupDoc>();
    if (!g) throw notFound('Study group');
    // Only members, or someone who can read the subject (to join), see it.
    if (!g.memberIds.some((m) => String(m) === viewer.userId))
      await this.d.subject(viewer, String(g.subjectId));
    const [view] = await this.views(viewer, [g]);
    return view as StudyGroupView;
  }

  private async assertRoom(viewer: AuthState) {
    const n = await StudyGroupModel.countDocuments({ memberIds: oid(viewer.userId) });
    if (n >= GROUPS_PER_MEMBER) throw conflict(`You can be in up to ${GROUPS_PER_MEMBER} study groups`);
  }

  async create(viewer: AuthState, body: z.output<typeof studyGroupBody>): Promise<StudyGroupView> {
    const subject = await this.d.subject(viewer, body.subjectId);
    await this.assertRoom(viewer);
    const g = await StudyGroupModel.create({
      subjectId: oid(subject.id),
      subjectName: subject.name,
      name: plainText(body.name),
      memberIds: [oid(viewer.userId)],
      createdBy: oid(viewer.userId),
      slot: body.slot ? { at: new Date(body.slot.at), place: plainText(body.slot.place) } : null,
    });
    return this.get(viewer, String(g._id));
  }

  /** Join a group with room; the third member forms it. */
  async join(viewer: AuthState, id: string): Promise<StudyGroupView> {
    const g = await StudyGroupModel.findById(oid(id)).lean<StudyGroupDoc>();
    if (!g) throw notFound('Study group');
    await this.d.subject(viewer, String(g.subjectId));
    if (g.memberIds.some((m) => String(m) === viewer.userId)) return this.get(viewer, id);
    await this.assertRoom(viewer);
    const updated = await StudyGroupModel.findOneAndUpdate(
      {
        _id: g._id,
        memberIds: { $ne: oid(viewer.userId) },
        [`memberIds.${STUDY_GROUP_MAX - 1}`]: { $exists: false },
      },
      { $push: { memberIds: oid(viewer.userId) } },
      { returnDocument: 'after' },
    ).lean<StudyGroupDoc>();
    if (!updated) throw conflict('This group is full');
    if (updated.memberIds.length >= STUDY_GROUP_MIN && !updated.formedAt) {
      const formed = await StudyGroupModel.updateOne(
        { _id: g._id, formedAt: null },
        { $set: { formedAt: new Date() } },
      );
      if (formed.modifiedCount)
        for (const m of updated.memberIds)
          await this.track(String(m), 'study_group_formed', { size: String(updated.memberIds.length) });
    }
    return this.get(viewer, id);
  }

  async leave(viewer: AuthState, id: string): Promise<StudyGroupView | null> {
    const g = await this.member(viewer, id);
    if (g.memberIds.length <= 1) {
      await StudyGroupModel.deleteOne({ _id: g._id });
      return null;
    }
    await StudyGroupModel.updateOne({ _id: g._id }, { $pull: { memberIds: oid(viewer.userId) } });
    return this.get(viewer, id);
  }

  async setSlot(viewer: AuthState, id: string, slot: { at: string; place: string } | null) {
    const g = await this.member(viewer, id);
    await StudyGroupModel.updateOne(
      { _id: g._id },
      { $set: { slot: slot ? { at: new Date(slot.at), place: plainText(slot.place) } : null } },
    );
    return this.get(viewer, id);
  }

  async addQuestion(viewer: AuthState, id: string, text: string) {
    const g = await this.member(viewer, id);
    if (g.questions.length >= STUDY_GROUP_QUESTIONS_MAX)
      throw conflict(`A group's list holds up to ${STUDY_GROUP_QUESTIONS_MAX} questions`);
    const clean = plainText(text);
    if (clean.length < 5) throw badRequest('Write the question');
    await StudyGroupModel.updateOne(
      { _id: g._id },
      { $push: { questions: { text: clean, by: oid(viewer.userId), done: false } } },
    );
    return this.get(viewer, id);
  }

  async markQuestion(viewer: AuthState, id: string, questionId: string, done: boolean) {
    const g = await this.member(viewer, id);
    const r = await StudyGroupModel.updateOne(
      { _id: g._id, 'questions._id': oid(questionId) },
      { $set: { 'questions.$.done': done } },
    );
    if (!r.matchedCount) throw notFound('Question');
    return this.get(viewer, id);
  }

  /** Shares one of the member's own study assistant quizzes with the group (questions only until answered). */
  async shareQuiz(viewer: AuthState, id: string, messageId: string) {
    const g = await this.member(viewer, id);
    if (g.quizzes.length >= QUIZZES_MAX)
      throw conflict('This group has shared enough quizzes; finish those first');
    const quiz = await this.d.quizOf(viewer, messageId);
    if (!quiz.questions.length) throw badRequest('That quiz has no questions');
    await StudyGroupModel.updateOne(
      { _id: g._id },
      {
        $push: {
          quizzes: {
            topic: quiz.topic,
            sharedBy: oid(viewer.userId),
            questions: quiz.questions,
            results: [],
          },
        },
      },
    );
    return this.get(viewer, id);
  }

  async myQuizzes(viewer: AuthState) {
    return this.d.recentQuizzes(viewer);
  }

  /** A member takes a shared quiz once. */
  async answerQuiz(viewer: AuthState, id: string, quizId: string, answers: (number | string)[]) {
    const g = await this.member(viewer, id);
    const quiz = g.quizzes.find((q) => String(q._id) === quizId);
    if (!quiz) throw notFound('Quiz');
    if (answers.length !== quiz.questions.length) throw badRequest('Answer every question');
    let correct = 0;
    quiz.questions.forEach((q, i) => {
      const a = answers[i];
      if (q.kind === 'mcq' ? a === q.answer : typeof a === 'string' && sameAnswer(a, q.answer)) correct++;
    });
    const r = await StudyGroupModel.updateOne(
      {
        _id: g._id,
        quizzes: { $elemMatch: { _id: oid(quizId), 'results.userId': { $ne: oid(viewer.userId) } } },
      },
      {
        $push: {
          'quizzes.$.results': {
            userId: oid(viewer.userId),
            correct,
            total: quiz.questions.length,
            answers,
            at: new Date(),
          },
        },
      },
    );
    if (!r.modifiedCount) throw conflict('You already took this quiz');
    return this.get(viewer, id);
  }

  async exportFor(userId: string) {
    const rows = await StudyGroupModel.find({ memberIds: oid(userId) }).lean<StudyGroupDoc[]>();
    return {
      studyGroups: rows.map((g) => ({
        name: g.name,
        subject: g.subjectName,
        slot: g.slot,
        questionsAdded: g.questions.filter((q) => String(q.by) === userId).map((q) => q.text),
        quizResults: g.quizzes.flatMap((q) =>
          q.results
            .filter((r) => String(r.userId) === userId)
            .map((r) => ({ topic: q.topic, correct: r.correct, total: r.total, at: r.at })),
        ),
      })),
    };
  }

  /** Erasure: they leave every group (a group with no one left goes); their questions stay, unattributed. */
  async eraseFor(userId: string) {
    const me = oid(userId);
    await StudyGroupModel.updateMany(
      { memberIds: me },
      { $pull: { memberIds: me, 'quizzes.$[].results': { userId: me } } },
    );
    await StudyGroupModel.updateMany(
      { 'questions.by': me },
      { $set: { 'questions.$[q].by': null } },
      { arrayFilters: [{ 'q.by': me }] },
    );
    await StudyGroupModel.updateMany(
      { 'quizzes.sharedBy': me },
      { $set: { 'quizzes.$[z].sharedBy': null } },
      { arrayFilters: [{ 'z.sharedBy': me }] },
    );
    await StudyGroupModel.deleteMany({ memberIds: { $size: 0 } });
    await StudyGroupModel.updateMany({ createdBy: me }, { $set: { createdBy: null } });
  }
}
