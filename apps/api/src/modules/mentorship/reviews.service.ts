import { Types } from 'mongoose';
import type { MentorReviewView, SessionType } from '@campuslink/shared';
import { MentorReviewModel, type ReviewDoc } from './review.model.js';
import type { MentorsService } from './mentors.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { Removal } from '../moderation/moderation.service.js';
import { conflict } from '../../lib/errors.js';
import { plainText } from '../../lib/text.js';
import type { AuthState } from '../../types.js';

const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
const PAGE = 20;

/**
 * Public mentor reviews (B5): a mentee who gave private feedback on a completed session may publish
 * one short review of it. The private feedback stays private; the review shows the reviewer's
 * first name, the session type and the rating. Moderated like any other content.
 */
export class ReviewsService {
  constructor(
    private readonly d: { sessions: SessionsService; mentors: MentorsService; profiles: ProfilesService },
  ) {}

  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    return MentorReviewModel.find({ menteeId: new Types.ObjectId(userId) })
      .select('mentorId sessionType rating text status createdAt')
      .lean();
  }

  /** The reviewer's own reviews go; reviews about a mentor who leaves go with them. */
  async eraseFor(userId: string) {
    const u = new Types.ObjectId(userId);
    await MentorReviewModel.deleteMany({ $or: [{ menteeId: u }, { mentorId: u }] });
  }

  /** SessionsService hook: which of these bookings have a review. */
  async reviewedOf(bookingIds: Types.ObjectId[]): Promise<Set<string>> {
    const rows = await MentorReviewModel.find({ bookingId: { $in: bookingIds } })
      .select('bookingId')
      .lean();
    return new Set(rows.map((r) => String(r.bookingId)));
  }

  async create(viewer: AuthState, bookingId: string, text: string): Promise<MentorReviewView> {
    const fb = await this.d.sessions.feedbackOf(viewer, bookingId);
    if (!fb) throw conflict('Share your feedback on this session first');
    let doc;
    try {
      doc = await MentorReviewModel.create({
        bookingId: new Types.ObjectId(bookingId),
        mentorId: fb.mentorId,
        menteeId: new Types.ObjectId(viewer.userId),
        sessionType: fb.sessionType,
        rating: fb.rating,
        text: plainText(text),
      });
    } catch (e) {
      if (isDuplicate(e)) throw conflict('You already reviewed this session');
      throw e;
    }
    this.d.mentors.forgetStats(String(fb.mentorId));
    return (await this.views([doc.toObject() as ReviewDoc]))[0] as MentorReviewView;
  }

  /** Published reviews of a mentor the viewer may see (same visibility as the mentor page). */
  async list(viewer: AuthState, mentorId: string, cursor?: string) {
    await this.d.mentors.get(viewer, mentorId);
    const rows = await MentorReviewModel.find({
      mentorId: new Types.ObjectId(mentorId),
      status: 'published',
      ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(PAGE + 1)
      .lean<ReviewDoc[]>();
    const page = rows.slice(0, PAGE);
    return {
      items: await this.views(page),
      nextCursor: rows.length > PAGE ? String(page.at(-1)?._id) : null,
    };
  }

  private async views(rows: ReviewDoc[]): Promise<MentorReviewView[]> {
    const refs = await this.d.profiles.refsFor(rows.map((r) => r.menteeId));
    return rows.map((r) => ({
      id: String(r._id),
      rating: r.rating,
      text: r.text,
      sessionType: r.sessionType as SessionType,
      createdAt: r.createdAt.toISOString(),
      author: (refs.get(String(r.menteeId))?.name ?? '').trim().split(/\s+/)[0] ?? '',
    }));
  }

  /** ModerationService hook (target `review`). */
  readonly handler = {
    load: async (id: string) => {
      const r = await MentorReviewModel.findById(id).lean<ReviewDoc>();
      return r
        ? {
            authorId: String(r.menteeId),
            status: r.status,
            snapshot: r.text,
            context: { mentorId: String(r.mentorId) },
          }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) => {
      const r = await MentorReviewModel.findOneAndUpdate(
        { _id: id, status: removal ? 'published' : 'removed' },
        { $set: { status: removal ? 'removed' : 'published', removal } },
      ).lean<ReviewDoc>();
      if (r) this.d.mentors.forgetStats(String(r.mentorId));
      return !!r;
    },
  };
}
