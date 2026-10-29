import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  APP_NAME,
  FEEDBACK_WINDOW_DAYS,
  JOIN_EARLY_MINUTES,
  JOIN_LATE_MINUTES,
  LATE_CANCEL_HOURS,
  MAX_RESCHEDULES,
  NO_SHOW_WINDOW_HOURS,
  type BookingView,
  type FeedbackView,
  type ImpactView,
  type SessionType,
  type bookingsQuery,
  type feedbackBody,
} from '@campuslink/shared';
import { BookingModel, FeedbackModel, type BookingDoc, type FeedbackDoc } from './booking.model.js';
import { holdsFor } from '../mentorship/slots.js';
import { conflict, notFound } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { VideoProvider } from '../../lib/video.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import type { AuthState } from '../../types.js';
import { zonedParts, zonedToUtc } from '../../lib/timezone.js';
import { noAward, type Award } from '../../lib/awards.js';

export const REMINDER_JOB = 'sessions.reminder';
export const COMPLETE_JOB = 'sessions.complete';
const MIN = 60_000;
const HOUR = 60 * MIN;
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
const taken = () => conflict('That time is no longer free. Pick another slot.');

/** Validates a slot against the mentor's availability; supplied by the mentorship module. */
export type SlotCheck = (input: {
  mentorId: string;
  menteeId: string;
  sessionType: SessionType;
  start: Date;
  ignoreBookingId?: string;
}) => Promise<{ durationMin: number; bufferMin: number }>;

export interface SessionsDeps {
  video: VideoProvider;
  jobs: JobQueue;
  profiles: ProfilesService;
  notifications: NotificationsService;
  tenantUrl: (tenant: TenantRecord, path: string) => string;
}

/** Lists free slots for a pair; supplied by the mentorship module. */
export type SlotList = (
  mentorId: string,
  menteeId: string,
  type: SessionType,
  days: number,
  ignoreBookingId: string,
) => Promise<{ timezone: string; durationMin: number; slots: string[] }>;

export class SessionsService {
  /** Set by the app (B5 reviews live in the mentorship module): which bookings have a review. */
  reviewedOf: ((bookingIds: Types.ObjectId[]) => Promise<Set<string>>) | null = null;

  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const u = new Types.ObjectId(userId);
    const [bookings, feedbackGiven] = await Promise.all([
      BookingModel.find({ $or: [{ menteeId: u }, { mentorId: u }] })
        .select('mentorId menteeId sessionType start end status')
        .lean(),
      FeedbackModel.find({ menteeId: u }).select('bookingId rating tags comment createdAt').lean(),
    ]);
    return { bookings, feedbackGiven };
  }

  /** Future sessions are cancelled; feedback I wrote is deleted. Past bookings stay, pseudonymous. */
  async eraseFor(userId: string) {
    const u = new Types.ObjectId(userId);
    await BookingModel.updateMany(
      { $or: [{ menteeId: u }, { mentorId: u }], status: 'scheduled', start: { $gt: new Date() } },
      { $set: { status: 'cancelled' }, $inc: { version: 1 } },
    );
    await FeedbackModel.deleteMany({ menteeId: u });
  }

  /** Points for actions this module confirms (wired in app.ts). */
  award: Award = noAward;
  slotCheck: SlotCheck | null = null;
  slotList: SlotList | null = null;
  constructor(private readonly d: SessionsDeps) {}

  /** Busy holds of these people overlapping [from, to) (scheduled bookings only). */
  async busy(userIds: string[], from: Date, to: Date, ignoreBookingId?: string): Promise<Set<string>> {
    const rows = await BookingModel.find({
      status: 'scheduled',
      participants: { $in: userIds.map((u) => new Types.ObjectId(u)) },
      start: { $lt: to },
      end: { $gt: new Date(from.getTime() - 2 * HOUR) },
      ...(ignoreBookingId ? { _id: { $ne: new Types.ObjectId(ignoreBookingId) } } : {}),
    })
      .select('holds')
      .lean<{ holds: string[] }[]>();
    const prefixes = userIds.map((u) => `${u}|`);
    return new Set(rows.flatMap((r) => r.holds.filter((h) => prefixes.some((p) => h.startsWith(p)))));
  }

  private async schedule(b: Pick<BookingDoc, '_id' | 'start' | 'end' | 'version'>) {
    const tenantId = String(requireTenantId());
    const id = String(b._id);
    const now = Date.now();
    const base = { tenantId, bookingId: id, version: b.version };
    for (const [kind, before] of [
      ['24h', 24 * HOUR],
      ['1h', HOUR],
    ] as const) {
      const at = b.start.getTime() - before;
      if (at > now)
        await this.d.jobs.enqueue(
          REMINDER_JOB,
          { ...base, kind },
          { jobId: `rem${kind}-${id}-v${b.version}`, delayMs: at - now },
        );
    }
    await this.d.jobs.enqueue(COMPLETE_JOB, base, {
      jobId: `done-${id}-v${b.version}`,
      delayMs: Math.max(0, b.end.getTime() - now),
    });
  }

  private async unschedule(id: string, version: number) {
    for (const k of ['rem24h', 'rem1h']) await this.d.jobs.cancel(REMINDER_JOB, `${k}-${id}-v${version}`);
    await this.d.jobs.cancel(COMPLETE_JOB, `done-${id}-v${version}`);
  }

  /** Creates a booking; the unique hold index turns any overlap (either person) into a 409. */
  async book(input: {
    requestId: string;
    mentorId: string;
    menteeId: string;
    sessionType: SessionType;
    start: Date;
    conversationId: string | null;
  }): Promise<BookingDoc> {
    if (!this.slotCheck) throw new Error('slot check not wired');
    const { durationMin, bufferMin } = await this.slotCheck(input);
    const end = new Date(input.start.getTime() + durationMin * MIN);
    try {
      const doc = await BookingModel.create({
        requestId: new Types.ObjectId(input.requestId),
        mentorId: new Types.ObjectId(input.mentorId),
        menteeId: new Types.ObjectId(input.menteeId),
        participants: [new Types.ObjectId(input.mentorId), new Types.ObjectId(input.menteeId)],
        sessionType: input.sessionType,
        start: input.start,
        end,
        holds: holdsFor(input.mentorId, input.menteeId, input.start, end, bufferMin),
        room: this.d.video.newRoom(),
        conversationId: input.conversationId ? new Types.ObjectId(input.conversationId) : null,
      });
      const b = doc.toObject() as BookingDoc;
      await this.schedule(b);
      return b;
    } catch (e) {
      if (isDuplicate(e)) throw taken();
      throw e;
    }
  }

  async linkConversation(bookingId: string, conversationId: string) {
    await BookingModel.updateOne(
      { _id: bookingId },
      { $set: { conversationId: new Types.ObjectId(conversationId) } },
    );
  }

  /** Marks finished sessions as completed (jobs do this too; this keeps reads right if Redis lost a job). */
  private async settle(userId: string) {
    await BookingModel.updateMany(
      { participants: new Types.ObjectId(userId), status: 'scheduled', end: { $lte: new Date() } },
      { $set: { status: 'completed', completedAt: new Date() } },
    );
  }

  private async mine(viewer: AuthState, id: string): Promise<BookingDoc> {
    await this.settle(viewer.userId);
    const b = await BookingModel.findOne({ _id: id, participants: viewer.userId }).lean<BookingDoc>();
    if (!b) throw notFound('Session');
    return b;
  }

  private async views(viewer: AuthState, rows: BookingDoc[]): Promise<BookingView[]> {
    const refs = await this.d.profiles.refsFor(rows.flatMap((b) => [b.mentorId, b.menteeId]));
    const given = new Set(
      (
        await FeedbackModel.find({ bookingId: { $in: rows.map((b) => b._id) } })
          .select('bookingId')
          .lean()
      ).map((f) => String(f.bookingId)),
    );
    const reviewed = (await this.reviewedOf?.(rows.map((b) => b._id))) ?? new Set<string>();
    return rows.map((b) => ({
      id: String(b._id),
      status: b.status as BookingView['status'],
      sessionType: b.sessionType as SessionType,
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      mentor: refs.get(String(b.mentorId)) ?? { userId: String(b.mentorId), name: '', avatarFileId: null },
      mentee: refs.get(String(b.menteeId)) ?? { userId: String(b.menteeId), name: '', avatarFileId: null },
      role: String(b.mentorId) === viewer.userId ? 'mentor' : 'mentee',
      rescheduleCount: b.rescheduleCount,
      canJoinFrom: new Date(b.start.getTime() - JOIN_EARLY_MINUTES * MIN).toISOString(),
      canJoinUntil: new Date(b.end.getTime() + JOIN_LATE_MINUTES * MIN).toISOString(),
      cancelledBy: (b.cancelledBy ?? null) as BookingView['cancelledBy'],
      lateCancel: b.lateCancel,
      noShowBy: (b.noShowBy ?? null) as BookingView['noShowBy'],
      feedbackGiven: given.has(String(b._id)),
      reviewGiven: reviewed.has(String(b._id)),
      conversationId: b.conversationId ? String(b.conversationId) : null,
    }));
  }

  async list(viewer: AuthState, q: z.output<typeof bookingsQuery>) {
    await this.settle(viewer.userId);
    const upcoming = q.when === 'upcoming';
    const filter: Record<string, unknown> = {
      participants: new Types.ObjectId(viewer.userId),
      ...(upcoming ? { status: 'scheduled' } : { status: { $ne: 'scheduled' } }),
    };
    if (q.cursor) {
      const ref = await BookingModel.findOne({ _id: q.cursor, participants: viewer.userId })
        .select('start')
        .lean();
      if (ref) filter.start = upcoming ? { $gt: ref.start } : { $lt: ref.start };
    }
    const rows = await BookingModel.find(filter)
      .sort({ start: upcoming ? 1 : -1 })
      .limit(31)
      .lean<BookingDoc[]>();
    const page = rows.slice(0, 30);
    return {
      items: await this.views(viewer, page),
      nextCursor: rows.length > 30 ? String(page.at(-1)?._id) : null,
    };
  }

  async get(viewer: AuthState, id: string): Promise<BookingView> {
    const [v] = await this.views(viewer, [await this.mine(viewer, id)]);
    return v as BookingView;
  }

  private async notifyOther(
    b: BookingDoc,
    actorId: string,
    type: 'booking_rescheduled' | 'booking_cancelled',
  ) {
    const otherId = String(String(b.mentorId) === actorId ? b.menteeId : b.mentorId);
    const refs = await this.d.profiles.refsFor([actorId]);
    await this.d.notifications.notify(otherId, type, {
      name: refs.get(actorId)?.name ?? '',
      sessionType: b.sessionType,
      start: b.start.toISOString(),
      bookingId: String(b._id),
    });
  }

  async reschedule(viewer: AuthState, id: string, slotStart: string) {
    const b = await this.mine(viewer, id);
    if (b.status !== 'scheduled' || b.start.getTime() <= Date.now())
      throw conflict('Only upcoming sessions can be moved');
    if (b.rescheduleCount >= MAX_RESCHEDULES)
      throw conflict(
        `A session can be moved at most ${MAX_RESCHEDULES} times. Cancel it and send a new request instead.`,
      );
    if (!this.slotCheck) throw new Error('slot check not wired');
    const start = new Date(slotStart);
    const { durationMin, bufferMin } = await this.slotCheck({
      mentorId: String(b.mentorId),
      menteeId: String(b.menteeId),
      sessionType: b.sessionType as SessionType,
      start,
      ignoreBookingId: id,
    });
    const end = new Date(start.getTime() + durationMin * MIN);
    let updated: BookingDoc | null;
    try {
      updated = await BookingModel.findOneAndUpdate(
        { _id: b._id, status: 'scheduled', version: b.version },
        {
          $set: {
            start,
            end,
            holds: holdsFor(String(b.mentorId), String(b.menteeId), start, end, bufferMin),
            room: this.d.video.newRoom(), // old links stop working
          },
          $inc: { version: 1, rescheduleCount: 1 },
        },
        { returnDocument: 'after' },
      ).lean<BookingDoc>();
    } catch (e) {
      if (isDuplicate(e)) throw taken();
      throw e;
    }
    if (!updated) throw conflict('This session just changed. Refresh and try again.');
    await this.unschedule(id, b.version);
    await this.schedule(updated);
    await this.notifyOther(updated, viewer.userId, 'booking_rescheduled');
    return this.get(viewer, id);
  }

  /** Times either participant can move this session to. */
  async slotsFor(viewer: AuthState, id: string, days: number) {
    const b = await this.mine(viewer, id);
    if (b.status !== 'scheduled') throw conflict('Only upcoming sessions can be moved');
    if (!this.slotList) throw new Error('slot list not wired');
    return this.slotList(String(b.mentorId), String(b.menteeId), b.sessionType as SessionType, days, id);
  }

  async cancel(viewer: AuthState, id: string, reason: string | undefined) {
    const b = await this.mine(viewer, id);
    if (b.status !== 'scheduled' || b.start.getTime() <= Date.now())
      throw conflict('Only upcoming sessions can be cancelled');
    const role = String(b.mentorId) === viewer.userId ? 'mentor' : 'mentee';
    await this.cancelBooking(b, role, reason ?? null);
    await this.notifyOther(b, viewer.userId, 'booking_cancelled');
    return this.get(viewer, id);
  }

  private async cancelBooking(b: BookingDoc, by: 'mentor' | 'mentee', reason: string | null) {
    const late = b.start.getTime() - Date.now() < LATE_CANCEL_HOURS * HOUR;
    const r = await BookingModel.updateOne(
      { _id: b._id, status: 'scheduled' },
      { $set: { status: 'cancelled', cancelledBy: by, cancelReason: reason, lateCancel: late } },
    );
    if (r.modifiedCount) await this.unschedule(String(b._id), b.version);
    return r.modifiedCount > 0;
  }

  /** Short-lived join link, only for the two participants and only around the session time. */
  async join(viewer: AuthState, id: string) {
    const b = await this.mine(viewer, id);
    const from = b.start.getTime() - JOIN_EARLY_MINUTES * MIN;
    const until = b.end.getTime() + JOIN_LATE_MINUTES * MIN;
    const now = Date.now();
    if (!['scheduled', 'completed'].includes(b.status) || now < from || now > until)
      throw conflict(
        `You can join from ${JOIN_EARLY_MINUTES} minutes before the start until ${JOIN_LATE_MINUTES} minutes after the end`,
      );
    const refs = await this.d.profiles.refsFor([viewer.userId]);
    const expiresAt = new Date(until);
    const url = await this.d.video.joinUrl({
      room: b.room,
      user: { id: viewer.userId, name: refs.get(viewer.userId)?.name ?? '' },
      moderator: String(b.mentorId) === viewer.userId,
      notBefore: new Date(from),
      expiresAt,
    });
    return { url, provider: this.d.video.name, expiresAt: expiresAt.toISOString() };
  }

  /** Calendar file. It carries no video link (links are issued only at join time). */
  async ics(viewer: AuthState, tenant: TenantRecord, id: string): Promise<string> {
    const b = await this.mine(viewer, id);
    const refs = await this.d.profiles.refsFor([b.mentorId, b.menteeId]);
    const other =
      refs.get(String(String(b.mentorId) === viewer.userId ? b.menteeId : b.mentorId))?.name ?? '';
    const fmt = (d: Date) =>
      d
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
    const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
    const label = b.sessionType.replace(/_/g, ' ');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${esc(APP_NAME)}//Mentorship//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${String(b._id)}-v${b.version}@${tenant.slug}`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(b.start)}`,
      `DTEND:${fmt(b.end)}`,
      `SUMMARY:${esc(`${APP_NAME}: ${label} with ${other}`)}`,
      `DESCRIPTION:${esc(`Open ${APP_NAME} → Sessions to join. The video link opens ${JOIN_EARLY_MINUTES} minutes before the start.`)}`,
      `URL:${this.d.tenantUrl(tenant, '/sessions')}`,
      b.status === 'cancelled' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return lines.join('\r\n') + '\r\n';
  }

  async markNoShow(viewer: AuthState, id: string) {
    const b = await this.mine(viewer, id);
    if (b.status !== 'completed' || Date.now() > b.end.getTime() + NO_SHOW_WINDOW_HOURS * HOUR)
      throw conflict(`You can report a no-show within ${NO_SHOW_WINDOW_HOURS} hours after a session ends`);
    const absent = String(b.mentorId) === viewer.userId ? 'mentee' : 'mentor';
    const r = await BookingModel.updateOne(
      { _id: b._id, status: 'completed', noShowBy: null },
      { $set: { status: 'no_show', noShowBy: absent } },
    );
    if (!r.modifiedCount) throw conflict('This session was already updated');
    return this.get(viewer, id);
  }

  async feedback(viewer: AuthState, id: string, body: z.output<typeof feedbackBody>) {
    const b = await this.mine(viewer, id);
    if (String(b.menteeId) !== viewer.userId) throw notFound('Session');
    if (b.status !== 'completed' || Date.now() > b.end.getTime() + FEEDBACK_WINDOW_DAYS * 24 * HOUR)
      throw conflict(`Feedback is open for ${FEEDBACK_WINDOW_DAYS} days after a completed session`);
    try {
      await FeedbackModel.create({
        bookingId: b._id,
        mentorId: b.mentorId,
        menteeId: b.menteeId,
        rating: body.rating,
        tags: body.tags,
        comment: body.comment ?? '',
      });
    } catch (e) {
      if (isDuplicate(e)) throw conflict('You already shared feedback for this session');
      throw e;
    }
    await this.d.notifications.notify(b.mentorId, 'feedback_received', { bookingId: String(b._id) });
    await this.award(b.menteeId, 'feedback_given', String(b._id), { from: b.mentorId });
    return { saved: true };
  }

  private async feedbackViews(rows: FeedbackDoc[]): Promise<FeedbackView[]> {
    const refs = await this.d.profiles.refsFor(rows.flatMap((f) => [f.mentorId, f.menteeId]));
    return rows.map((f) => ({
      id: String(f._id),
      bookingId: String(f.bookingId),
      rating: f.rating,
      tags: f.tags,
      comment: f.comment,
      mentee: refs.get(String(f.menteeId)) ?? { userId: String(f.menteeId), name: '', avatarFileId: null },
      mentor: refs.get(String(f.mentorId)) ?? { userId: String(f.mentorId), name: '', avatarFileId: null },
      createdAt: f.createdAt.toISOString(),
    }));
  }

  /** Private feedback: the mentor sees their own; admins with mentorship:oversee see all. */
  async feedbackFor(filter: { mentorId?: string }, cursor?: string) {
    const rows = await FeedbackModel.find({
      ...(filter.mentorId ? { mentorId: new Types.ObjectId(filter.mentorId) } : {}),
      ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(31)
      .lean<FeedbackDoc[]>();
    const page = rows.slice(0, 30);
    return {
      items: await this.feedbackViews(page),
      nextCursor: rows.length > 30 ? String(page.at(-1)?._id) : null,
    };
  }

  async impact(mentorId: string, timezone: string): Promise<Omit<ImpactView, 'pendingRequests'>> {
    await this.settle(mentorId);
    const today = zonedParts(new Date(), timezone).date;
    const monthStart =
      zonedToUtc(`${today.slice(0, 8)}01`, 0, timezone) ?? new Date(`${today.slice(0, 8)}01T00:00:00Z`);
    const done = await BookingModel.find({ mentorId: new Types.ObjectId(mentorId), status: 'completed' })
      .select('menteeId end')
      .lean();
    const thisMonth = done.filter((b) => b.end >= monthStart);
    const ratings = await FeedbackModel.find({ mentorId: new Types.ObjectId(mentorId) })
      .select('rating')
      .lean();
    const avg = ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : null;
    return {
      helpedThisMonth: new Set(thisMonth.map((b) => String(b.menteeId))).size,
      sessionsThisMonth: thisMonth.length,
      sessionsTotal: done.length,
      menteesTotal: new Set(done.map((b) => String(b.menteeId))).size,
      averageRating: avg === null ? null : Math.round(avg * 10) / 10,
      ratingsCount: ratings.length,
    };
  }

  async overview() {
    const since = new Date(Date.now() - 30 * 24 * HOUR);
    const [scheduled, completed, cancelled, noShow, feedback] = await Promise.all([
      BookingModel.countDocuments({ status: 'scheduled' }),
      BookingModel.countDocuments({ status: 'completed', end: { $gte: since } }),
      BookingModel.countDocuments({ status: 'cancelled', updatedAt: { $gte: since } }),
      BookingModel.countDocuments({ status: 'no_show', end: { $gte: since } }),
      FeedbackModel.countDocuments({ createdAt: { $gte: since } }),
    ]);
    return {
      upcomingSessions: scheduled,
      completed30d: completed,
      cancelled30d: cancelled,
      noShows30d: noShow,
      feedback30d: feedback,
    };
  }

  /** A block cancels future sessions between the two people; the blocked person is told it was cancelled. */
  async onBlock(blockerId: string, blockedId: string) {
    const rows = await BookingModel.find({
      participants: { $all: [new Types.ObjectId(blockerId), new Types.ObjectId(blockedId)] },
      status: 'scheduled',
      start: { $gt: new Date() },
    }).lean<BookingDoc[]>();
    for (const b of rows) {
      const by = String(b.mentorId) === blockerId ? 'mentor' : 'mentee';
      if (await this.cancelBooking(b, by, null)) await this.notifyOther(b, blockerId, 'booking_cancelled');
    }
  }

  // ── Jobs ─────────────────────────────
  async onReminder(job: TenantJob) {
    const b = await BookingModel.findOne({
      _id: job.bookingId,
      status: 'scheduled',
      version: job.version,
    }).lean<BookingDoc>();
    if (!b) return;
    const refs = await this.d.profiles.refsFor([b.mentorId, b.menteeId]);
    for (const [to, other] of [
      [b.mentorId, b.menteeId],
      [b.menteeId, b.mentorId],
    ] as const)
      await this.d.notifications.notify(to, 'booking_reminder', {
        name: refs.get(String(other))?.name ?? '',
        sessionType: b.sessionType,
        start: b.start.toISOString(),
        bookingId: String(b._id),
        when: String(job.kind),
      });
  }

  async onComplete(job: TenantJob) {
    const b = await BookingModel.findOneAndUpdate(
      { _id: job.bookingId, status: 'scheduled', version: job.version },
      { $set: { status: 'completed', completedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean<BookingDoc>();
    if (!b) return;
    const refs = await this.d.profiles.refsFor([b.mentorId]);
    await this.d.notifications.notify(b.menteeId, 'session_completed', {
      name: refs.get(String(b.mentorId))?.name ?? '',
      sessionType: b.sessionType,
      bookingId: String(b._id),
    });
    await this.award(b.menteeId, 'session_completed', String(b._id), { from: b.mentorId });
    await this.award(b.mentorId, 'session_mentored', String(b._id), { from: b.menteeId });
    // Once per mentee: the dedupe key includes the mentor.
    await this.award(b.mentorId, 'new_mentee', String(b.menteeId), { from: b.menteeId });
  }

  /** Analytics: completed sessions since a date (who and when only) and the average rating. */
  /** B5 mentor stats: completed sessions per mentor. */
  async completedCounts(mentorIds: Types.ObjectId[]): Promise<Map<string, number>> {
    const rows = await BookingModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { mentorId: { $in: mentorIds }, status: 'completed' } },
      { $group: { _id: '$mentorId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  }

  /** B5 reviews: the mentee's own feedback on a completed session (the review carries its rating). */
  async feedbackOf(viewer: AuthState, bookingId: string) {
    const b = await this.mine(viewer, bookingId);
    if (String(b.menteeId) !== viewer.userId) throw notFound('Session');
    const f = await FeedbackModel.findOne({ bookingId: b._id }).select('rating').lean();
    return f ? { rating: f.rating, mentorId: b.mentorId, sessionType: b.sessionType as SessionType } : null;
  }

  async completedSince(since: Date) {
    const [rows, rating] = await Promise.all([
      BookingModel.find({ status: 'completed', completedAt: { $gte: since } })
        .select('mentorId menteeId completedAt')
        .limit(100_000)
        .lean<BookingDoc[]>(),
      FeedbackModel.aggregate<{ avg: number; n: number }>([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
      ]),
    ]);
    return {
      sessions: rows.map((b) => ({
        mentorId: String(b.mentorId),
        menteeId: String(b.menteeId),
        at: b.completedAt ?? b.end,
      })),
      averageRating: rating[0] && rating[0].n >= 5 ? Math.round(rating[0].avg * 10) / 10 : null,
    };
  }
}
