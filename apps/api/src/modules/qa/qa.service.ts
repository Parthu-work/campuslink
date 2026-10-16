import { Types } from 'mongoose';
import type { z } from 'zod';
import type {
  AnswerView,
  QuestionView,
  RemovalReason,
  Topic,
  questionBody,
  questionsQuery,
} from '@campuslink/shared';
import {
  AnswerModel,
  AnswerVoteModel,
  QuestionModel,
  type AnswerDoc,
  type QuestionDoc,
} from './question.model.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { plainText } from '../../lib/text.js';
import { withTextSearch } from '../../db/search.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { SafetyService } from '../moderation/safety.service.js';
import { isModerator, type ModerationService, type Removal } from '../moderation/moderation.service.js';
import type { RequestMetaLite } from '../audit/audit.service.js';
import type { AuthState } from '../../types.js';
import { noAward, type Award } from '../../lib/awards.js';

const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
const blankAuthor = (id: string) => ({
  userId: id,
  name: '',
  avatarFileId: null,
  roles: [],
  headline: '',
  branch: null,
  gradYear: null,
});

/**
 * Moderated Q&A: students ask, questions wait for a moderator, alumni and staff answer, the asker
 * accepts the best answer, members vote answers helpful.
 */
export class QaService {
  /** Points for actions this module confirms (wired in app.ts). */
  award: Award = noAward;
  constructor(
    private readonly d: {
      profiles: ProfilesService;
      notifications: NotificationsService;
      safety: SafetyService;
      moderation: ModerationService;
    },
  ) {}

  private async questionViews(viewer: AuthState, rows: QuestionDoc[]): Promise<QuestionView[]> {
    const authors = await this.d.profiles.authorsFor(
      viewer,
      rows.map((q) => q.authorId),
    );
    const mod = isModerator(viewer);
    const removals = await this.d.moderation.removalViews(
      'question',
      rows.filter((q) => mod || String(q.authorId) === viewer.userId) as {
        _id: Types.ObjectId;
        status: string;
        removal?: Removal | null;
      }[],
    );
    return rows.map((q) => {
      const id = String(q._id);
      const rejected = q.status === 'rejected' && q.rejection?.reason;
      return {
        id,
        title: q.title,
        body: q.body,
        topics: q.topics as Topic[],
        author: authors.get(String(q.authorId)) ?? blankAuthor(String(q.authorId)),
        status: q.status as QuestionView['status'],
        answers: q.answers,
        acceptedAnswerId: q.acceptedAnswerId ? String(q.acceptedAnswerId) : null,
        isMine: String(q.authorId) === viewer.userId,
        removal:
          removals.get(id) ??
          (rejected && (mod || String(q.authorId) === viewer.userId)
            ? {
                reason: q.rejection?.reason as RemovalReason,
                note: '',
                at: (q.rejection?.at ?? q.createdAt).toISOString(),
                appeal: null,
              }
            : null),
        createdAt: q.createdAt.toISOString(),
      };
    });
  }

  async ask(viewer: AuthState, body: z.output<typeof questionBody>) {
    const title = plainText(body.title);
    if (title.length < 10) throw badRequest('Write a clear question (at least 10 characters)');
    const q = await QuestionModel.create({
      authorId: new Types.ObjectId(viewer.userId),
      title,
      body: plainText(body.body),
      topics: body.topics,
    });
    return (await this.questionViews(viewer, [q.toObject() as QuestionDoc]))[0] as QuestionView;
  }

  async list(viewer: AuthState, q: z.output<typeof questionsQuery>) {
    const filter: Record<string, unknown> = q.mine
      ? { authorId: new Types.ObjectId(viewer.userId) }
      : { status: 'published' };
    if (q.topic) filter.topics = q.topic;
    if (q.unanswered) filter.answers = 0;
    if (q.cursor) filter._id = { $lt: new Types.ObjectId(q.cursor) };
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    const rows = (await QuestionModel.find(filter).sort({ _id: -1 }).limit(31).lean<QuestionDoc[]>()).filter(
      (x) => !hidden.has(String(x.authorId)),
    );
    const page = rows.slice(0, 30);
    return {
      items: await this.questionViews(viewer, page),
      nextCursor: rows.length > 30 ? String(page.at(-1)?._id) : null,
    };
  }

  private async visible(viewer: AuthState, id: string): Promise<QuestionDoc> {
    const q = await QuestionModel.findById(id).lean<QuestionDoc>();
    if (!q) throw notFound('Question');
    const mine = String(q.authorId) === viewer.userId;
    if (q.status !== 'published' && !mine && !isModerator(viewer)) throw notFound('Question');
    if (!mine && (await this.d.safety.isBlockedEither(viewer.userId, q.authorId))) throw notFound('Question');
    return q;
  }

  private async answerViews(viewer: AuthState, q: QuestionDoc, rows: AnswerDoc[]): Promise<AnswerView[]> {
    const authors = await this.d.profiles.authorsFor(
      viewer,
      rows.map((a) => a.authorId),
    );
    const votes = await AnswerVoteModel.find({
      answerId: { $in: rows.map((a) => a._id) },
      userId: new Types.ObjectId(viewer.userId),
    })
      .select('answerId')
      .lean();
    const voted = new Set(votes.map((v) => String(v.answerId)));
    const mod = isModerator(viewer);
    const removals = await this.d.moderation.removalViews(
      'answer',
      rows.filter((a) => mod || String(a.authorId) === viewer.userId) as {
        _id: Types.ObjectId;
        status: string;
        removal?: Removal | null;
      }[],
    );
    return rows.map((a) => ({
      id: String(a._id),
      questionId: String(a.questionId),
      author: authors.get(String(a.authorId)) ?? blankAuthor(String(a.authorId)),
      body: a.body,
      helpful: a.helpful,
      votedHelpful: voted.has(String(a._id)),
      accepted: !!q.acceptedAnswerId && String(q.acceptedAnswerId) === String(a._id),
      status: a.status as AnswerView['status'],
      isMine: String(a.authorId) === viewer.userId,
      removal: removals.get(String(a._id)) ?? null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async get(viewer: AuthState, id: string) {
    const q = await this.visible(viewer, id);
    const mod = isModerator(viewer);
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    const answers = (
      await AnswerModel.find({ questionId: q._id }).sort({ _id: 1 }).limit(200).lean<AnswerDoc[]>()
    )
      .filter(
        (a) =>
          !hidden.has(String(a.authorId)) &&
          (a.status === 'published' || mod || String(a.authorId) === viewer.userId),
      )
      // Accepted answer first, then the most helpful.
      .sort(
        (a, b) =>
          Number(String(b._id) === String(q.acceptedAnswerId)) -
            Number(String(a._id) === String(q.acceptedAnswerId)) || b.helpful - a.helpful,
      );
    return {
      question: (await this.questionViews(viewer, [q]))[0] as QuestionView,
      answers: await this.answerViews(viewer, q, answers),
    };
  }

  async answer(viewer: AuthState, questionId: string, body: string) {
    const q = await this.visible(viewer, questionId);
    if (q.status !== 'published') throw conflict('This question is not open for answers');
    const text = plainText(body);
    if (text.length < 10) throw badRequest('Write a fuller answer (at least 10 characters)');
    const a = await AnswerModel.create({
      questionId: q._id,
      authorId: new Types.ObjectId(viewer.userId),
      body: text,
    });
    await QuestionModel.updateOne(
      { _id: q._id },
      { $inc: { answers: 1 }, $set: { lastActivityAt: new Date() } },
    );
    if (String(q.authorId) !== viewer.userId) {
      const name = (await this.d.profiles.refsFor([viewer.userId])).get(viewer.userId)?.name ?? '';
      await this.d.notifications.notify(q.authorId, 'question_answered', { name, questionId: String(q._id) });
    }
    return (await this.answerViews(viewer, q, [a.toObject() as AnswerDoc]))[0] as AnswerView;
  }

  async accept(viewer: AuthState, questionId: string, answerId: string) {
    const q = await QuestionModel.findOne({
      _id: questionId,
      authorId: viewer.userId,
      status: 'published',
    }).lean<QuestionDoc>();
    if (!q) throw notFound('Question');
    const a = await AnswerModel.findOne({
      _id: answerId,
      questionId: q._id,
      status: 'published',
    }).lean<AnswerDoc>();
    if (!a) throw notFound('Answer');
    await QuestionModel.updateOne(
      { _id: q._id },
      { $set: { acceptedAnswerId: a._id, lastActivityAt: new Date() } },
    );
    if (String(a.authorId) !== viewer.userId) {
      await this.d.notifications.notify(a.authorId, 'answer_accepted', { questionId: String(q._id) });
      await this.award(a.authorId, 'answer_accepted', String(a._id), { from: viewer.userId });
      await this.award(a.authorId, 'answer_accepted_alumni', String(a._id), { from: viewer.userId });
    }
    return this.get(viewer, questionId);
  }

  async helpful(viewer: AuthState, answerId: string, on: boolean) {
    const a = await AnswerModel.findOne({ _id: answerId, status: 'published' }).lean<AnswerDoc>();
    if (!a) throw notFound('Answer');
    await this.visible(viewer, String(a.questionId));
    if (String(a.authorId) === viewer.userId) throw badRequest('You cannot vote for your own answer');
    const key = { answerId: a._id, userId: new Types.ObjectId(viewer.userId) };
    if (on) {
      try {
        await AnswerVoteModel.create(key);
        await AnswerModel.updateOne({ _id: a._id }, { $inc: { helpful: 1 } });
      } catch (e) {
        if (!isDuplicate(e)) throw e;
      }
    } else if ((await AnswerVoteModel.deleteOne(key)).deletedCount) {
      await AnswerModel.updateOne({ _id: a._id }, { $inc: { helpful: -1 } });
    }
    return { helpful: on };
  }

  /** Authors may delete a question while it has no answers, and their own answers any time. */
  async deleteQuestion(viewer: AuthState, id: string) {
    const r = await QuestionModel.deleteOne({ _id: id, authorId: viewer.userId, answers: 0 });
    if (!r.deletedCount)
      throw conflict('Questions with answers stay up; ask a moderator if something is wrong');
    return { deleted: true };
  }

  async deleteAnswer(viewer: AuthState, id: string) {
    const a = await AnswerModel.findOneAndDelete({ _id: id, authorId: viewer.userId }).lean<AnswerDoc>();
    if (!a) throw notFound('Answer');
    await AnswerVoteModel.deleteMany({ answerId: a._id });
    await QuestionModel.updateOne({ _id: a.questionId }, { $inc: { answers: -1 } });
    await QuestionModel.updateOne(
      { _id: a.questionId, acceptedAnswerId: a._id },
      { $set: { acceptedAnswerId: null } },
    );
    return { deleted: true };
  }

  // ── Moderation ─────────────────────────────
  async pending(cursor?: string) {
    const rows = await QuestionModel.find({
      status: 'pending',
      ...(cursor ? { _id: { $gt: new Types.ObjectId(cursor) } } : {}),
    })
      .sort({ _id: 1 })
      .limit(31)
      .lean<QuestionDoc[]>();
    const page = rows.slice(0, 30);
    const refs = await this.d.profiles.refsFor(page.map((q) => q.authorId));
    return {
      items: page.map((q) => ({
        id: String(q._id),
        title: q.title,
        body: q.body,
        topics: q.topics,
        author: refs.get(String(q.authorId)),
        createdAt: q.createdAt.toISOString(),
      })),
      nextCursor: rows.length > 30 ? String(page.at(-1)?._id) : null,
    };
  }

  async pendingCount() {
    return QuestionModel.countDocuments({ status: 'pending' });
  }

  async decide(
    actor: AuthState,
    id: string,
    decision: 'approve' | 'reject',
    reason: RemovalReason | undefined,
    meta: RequestMetaLite,
  ) {
    const q = await QuestionModel.findOneAndUpdate(
      { _id: id, status: 'pending' },
      decision === 'approve'
        ? { $set: { status: 'published', lastActivityAt: new Date() } }
        : {
            $set: {
              status: 'rejected',
              rejection: { reason, by: new Types.ObjectId(actor.userId), at: new Date() },
            },
          },
      { returnDocument: 'after' },
    ).lean<QuestionDoc>();
    if (!q) throw notFound('Pending question');
    await this.d.moderation.log(
      actor,
      {
        targetType: 'question',
        targetId: id,
        subjectUserId: String(q.authorId),
        action: decision,
        reason: reason ?? null,
      },
      meta,
    );
    await this.d.notifications.notify(
      q.authorId,
      decision === 'approve' ? 'question_approved' : 'question_rejected',
      {
        questionId: id,
        ...(reason ? { reason } : {}),
      },
    );
    return { status: q.status };
  }

  readonly questionHandler = {
    load: async (id: string) => {
      const q = await QuestionModel.findById(id).lean<QuestionDoc>();
      return q
        ? {
            authorId: String(q.authorId),
            status: q.status,
            snapshot: `${q.title}\n${q.body}`,
            context: { questionId: String(q._id) },
          }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await QuestionModel.updateOne(
          { _id: id, status: removal ? 'published' : 'removed' },
          { $set: { status: removal ? 'removed' : 'published', removal } },
        )
      ).modifiedCount > 0,
  };

  readonly answerHandler = {
    load: async (id: string) => {
      const a = await AnswerModel.findById(id).lean<AnswerDoc>();
      return a
        ? {
            authorId: String(a.authorId),
            status: a.status,
            snapshot: a.body,
            context: { questionId: String(a.questionId) },
          }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await AnswerModel.updateOne(
          { _id: id, status: removal ? 'published' : 'removed' },
          { $set: { status: removal ? 'removed' : 'published', removal } },
        )
      ).modifiedCount > 0,
  };

  async search(viewer: AuthState, text: string) {
    if (text.length < 3) return [];
    const rows = await withTextSearch(QuestionModel.find({ status: 'published' }), text)
      .limit(5)
      .lean<QuestionDoc[]>();
    return this.questionViews(viewer, rows);
  }

  /** Analytics: published answers per author since a date. */
  async answersByAuthorSince(since: Date) {
    const rows = await AnswerModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { status: 'published', createdAt: { $gte: since } } },
      { $group: { _id: '$authorId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  }
}
