import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  MAX_PENDING_REQUESTS,
  REQUEST_TTL_DAYS,
  isBookable,
  type DeclineTemplate,
  type MentorshipRequestBody,
  type RequestView,
  type SessionType,
  type requestsQuery,
  type respondBody,
} from '@campuslink/shared';
import { MentorshipRequestModel, type RequestDoc } from './request.model.js';
import type { MentorsService } from './mentors.service.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { requireTenantId } from '../../lib/context.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { MessagingService } from '../messaging/messaging.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { ReportTarget } from '../moderation/safety.service.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import type { AuthState } from '../../types.js';

export const EXPIRE_JOB = 'mentorship.expire';
const DAY = 24 * 3600_000;
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

export interface RequestsDeps {
  mentors: MentorsService;
  sessions: SessionsService;
  messaging: MessagingService;
  profiles: ProfilesService;
  notifications: NotificationsService;
  jobs: JobQueue;
}

/** Structured mentorship requests. No cold DMs: messaging opens only when a mentor accepts. */
export class RequestsService {
  constructor(private readonly d: RequestsDeps) {}

  private async views(rows: RequestDoc[]): Promise<RequestView[]> {
    const refs = await this.d.profiles.refsFor(rows.flatMap((r) => [r.mentorId, r.menteeId]));
    const ref = (id: Types.ObjectId) =>
      refs.get(String(id)) ?? { userId: String(id), name: '', avatarFileId: null };
    return rows.map((r) => ({
      id: String(r._id),
      status: r.status as RequestView['status'],
      sessionType: r.sessionType as SessionType,
      goal: r.goal,
      background: r.background,
      need: r.need,
      slotStart: r.slotStart ? r.slotStart.toISOString() : null,
      mentor: ref(r.mentorId),
      mentee: ref(r.menteeId),
      declineTemplate: (r.declineTemplate ?? null) as DeclineTemplate | null,
      declineNote: r.declineNote ?? null,
      bookingId: r.bookingId ? String(r.bookingId) : null,
      conversationId: r.conversationId ? String(r.conversationId) : null,
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  private async view(r: RequestDoc) {
    return (await this.views([r]))[0] as RequestView;
  }

  async create(viewer: AuthState, tenant: TenantRecord, body: MentorshipRequestBody): Promise<RequestView> {
    await this.d.mentors.assertRequestable(viewer, body.mentorId, body.sessionType);
    const me = new Types.ObjectId(viewer.userId);
    const [pending, thisWeek] = await Promise.all([
      MentorshipRequestModel.countDocuments({ menteeId: me, status: 'pending' }),
      MentorshipRequestModel.countDocuments({
        menteeId: me,
        createdAt: { $gte: new Date(Date.now() - 7 * DAY) },
      }),
    ]);
    if (pending >= MAX_PENDING_REQUESTS)
      throw conflict(
        `You can have ${MAX_PENDING_REQUESTS} open requests at a time. Withdraw one or wait for replies.`,
      );
    const weekly = tenant.limits?.mentorshipRequestsPerWeek ?? 5;
    if (thisWeek >= weekly)
      throw conflict(`Your college allows ${weekly} mentorship requests a week. Try again later.`);
    const slotStart = body.slotStart ? new Date(body.slotStart) : null;
    if (slotStart)
      await this.d.mentors.checkSlot({
        mentorId: body.mentorId,
        menteeId: viewer.userId,
        sessionType: body.sessionType,
        start: slotStart,
      });
    let doc;
    try {
      doc = await MentorshipRequestModel.create({
        menteeId: me,
        mentorId: new Types.ObjectId(body.mentorId),
        sessionType: body.sessionType,
        goal: body.goal,
        background: body.background,
        need: body.need,
        slotStart,
        expiresAt: new Date(Date.now() + REQUEST_TTL_DAYS * DAY),
      });
    } catch (e) {
      if (isDuplicate(e)) throw conflict('You already have an open request with this mentor');
      throw e;
    }
    const id = String(doc._id);
    await this.d.jobs.enqueue(
      EXPIRE_JOB,
      { tenantId: String(requireTenantId()), requestId: id },
      { jobId: `reqexp-${id}`, delayMs: REQUEST_TTL_DAYS * DAY },
    );
    const refs = await this.d.profiles.refsFor([viewer.userId]);
    await this.d.notifications.notify(body.mentorId, 'request_received', {
      name: refs.get(viewer.userId)?.name ?? '',
      sessionType: body.sessionType,
      requestId: id,
    });
    return this.view(doc.toObject() as RequestDoc);
  }

  async list(viewer: AuthState, q: z.output<typeof requestsQuery>) {
    const filter: Record<string, unknown> = {
      [q.box === 'received' ? 'mentorId' : 'menteeId']: new Types.ObjectId(viewer.userId),
      ...(q.status ? { status: q.status } : {}),
      ...(q.cursor ? { _id: { $lt: new Types.ObjectId(q.cursor) } } : {}),
    };
    await this.expireDue(filter);
    const rows = await MentorshipRequestModel.find(filter).sort({ _id: -1 }).limit(31).lean<RequestDoc[]>();
    const page = rows.slice(0, 30);
    return { items: await this.views(page), nextCursor: rows.length > 30 ? String(page.at(-1)?._id) : null };
  }

  /** Lazy expiry (the delayed job does this too). */
  private async expireDue(scope: Record<string, unknown>) {
    await MentorshipRequestModel.updateMany(
      { ...scope, status: 'pending', expiresAt: { $lte: new Date() } },
      { $set: { status: 'expired' } },
    );
  }

  private async mine(viewer: AuthState, id: string): Promise<RequestDoc> {
    const me = new Types.ObjectId(viewer.userId);
    await this.expireDue({ _id: new Types.ObjectId(id) });
    const r = await MentorshipRequestModel.findOne({
      _id: id,
      $or: [{ mentorId: me }, { menteeId: me }],
    }).lean<RequestDoc>();
    if (!r) throw notFound('Request');
    return r;
  }

  async get(viewer: AuthState, id: string) {
    return this.view(await this.mine(viewer, id));
  }

  async respond(viewer: AuthState, id: string, body: z.output<typeof respondBody>): Promise<RequestView> {
    const r = await this.mine(viewer, id);
    if (String(r.mentorId) !== viewer.userId) throw notFound('Request');
    if (r.status !== 'pending') throw conflict(`This request is already ${r.status}`);
    const mentorName = (await this.d.profiles.refsFor([viewer.userId])).get(viewer.userId)?.name ?? '';
    const menteeId = String(r.menteeId);

    if (body.action === 'decline') {
      const done = await MentorshipRequestModel.findOneAndUpdate(
        { _id: r._id, status: 'pending' },
        {
          $set: {
            status: 'declined',
            declineTemplate: body.template,
            declineNote: body.note ?? null,
            respondedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      ).lean<RequestDoc>();
      if (!done) throw conflict('This request just changed. Refresh and try again.');
      await this.d.jobs.cancel(EXPIRE_JOB, `reqexp-${id}`);
      await this.d.notifications.notify(menteeId, 'request_declined', { name: mentorName, requestId: id });
      return this.view(done);
    }

    const bookable = isBookable(r.sessionType as SessionType);
    if (body.action === 'accept_other' && !bookable) throw badRequest('Quick chats have no time to change');
    const start = body.action === 'accept_other' ? new Date(body.slotStart) : r.slotStart;
    if (bookable && !start) throw badRequest('Pick a time for this session');

    // Claim the request first so two accepts cannot both book.
    const claimed = await MentorshipRequestModel.findOneAndUpdate(
      { _id: r._id, status: 'pending' },
      { $set: { status: 'accepted', respondedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean<RequestDoc>();
    if (!claimed) throw conflict('This request just changed. Refresh and try again.');
    let bookingId: string | null = null;
    try {
      if (bookable && start) {
        const b = await this.d.sessions.book({
          requestId: id,
          mentorId: viewer.userId,
          menteeId,
          sessionType: r.sessionType as SessionType,
          start,
          conversationId: await this.d.messaging.conversationFor(viewer.userId, menteeId),
        });
        bookingId = String(b._id);
      }
    } catch (e) {
      await MentorshipRequestModel.updateOne(
        { _id: r._id, status: 'accepted' },
        { $set: { status: 'pending', respondedAt: null } },
      );
      throw e;
    }
    const conversationId = await this.d.messaging.openFor(viewer.userId, menteeId);
    if (bookingId) await this.d.sessions.linkConversation(bookingId, conversationId);
    const done = await MentorshipRequestModel.findOneAndUpdate(
      { _id: r._id },
      {
        $set: {
          conversationId: new Types.ObjectId(conversationId),
          ...(bookingId ? { bookingId: new Types.ObjectId(bookingId), slotStart: start } : {}),
        },
      },
      { returnDocument: 'after' },
    ).lean<RequestDoc>();
    await this.d.jobs.cancel(EXPIRE_JOB, `reqexp-${id}`);
    await this.d.notifications.notify(menteeId, 'request_accepted', {
      name: mentorName,
      sessionType: r.sessionType,
      requestId: id,
      conversationId,
      ...(bookingId && start ? { bookingId, start: start.toISOString() } : {}),
    });
    return this.view(done as RequestDoc);
  }

  async withdraw(viewer: AuthState, id: string) {
    const r = await this.mine(viewer, id);
    if (String(r.menteeId) !== viewer.userId) throw notFound('Request');
    const done = await MentorshipRequestModel.findOneAndUpdate(
      { _id: r._id, status: 'pending' },
      { $set: { status: 'withdrawn' } },
      { returnDocument: 'after' },
    ).lean<RequestDoc>();
    if (!done) throw conflict(`This request is already ${r.status}`);
    await this.d.jobs.cancel(EXPIRE_JOB, `reqexp-${id}`);
    return this.view(done);
  }

  async pendingFor(mentorId: string) {
    await this.expireDue({ mentorId: new Types.ObjectId(mentorId) });
    return MentorshipRequestModel.countDocuments({
      mentorId: new Types.ObjectId(mentorId),
      status: 'pending',
    });
  }

  async overview() {
    const since = new Date(Date.now() - 30 * DAY);
    const rows = await MentorshipRequestModel.aggregate<{ _id: string; n: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [r._id, r.n])) as Record<string, number>;
  }

  async onExpire(job: TenantJob) {
    const r = await MentorshipRequestModel.findOneAndUpdate(
      { _id: job.requestId, status: 'pending', expiresAt: { $lte: new Date(Date.now() + 60_000) } },
      { $set: { status: 'expired' } },
      { returnDocument: 'after' },
    ).lean<RequestDoc>();
    if (!r) return;
    const refs = await this.d.profiles.refsFor([r.mentorId]);
    await this.d.notifications.notify(r.menteeId, 'request_expired', {
      name: refs.get(String(r.mentorId))?.name ?? '',
      requestId: String(r._id),
    });
  }

  /** A block withdraws open requests between the two, silently. */
  async onBlock(a: string, b: string) {
    const ids = [new Types.ObjectId(a), new Types.ObjectId(b)];
    await MentorshipRequestModel.updateMany(
      { status: 'pending', mentorId: { $in: ids }, menteeId: { $in: ids } },
      { $set: { status: 'withdrawn' } },
    );
  }

  /** Safety hook: either side may report a request; the snapshot is the other side's text. */
  async reportTarget(viewer: AuthState, id: string): Promise<ReportTarget | null> {
    const r = await MentorshipRequestModel.findOne({ _id: id }).lean<RequestDoc>();
    if (!r) return null;
    if (String(r.mentorId) === viewer.userId)
      return {
        subjectUserId: String(r.menteeId),
        snapshot: `Goal: ${r.goal}\nBackground: ${r.background}\nNeed: ${r.need}`,
      };
    if (String(r.menteeId) === viewer.userId)
      return {
        subjectUserId: String(r.mentorId),
        snapshot: r.declineNote ? `Reply: ${r.declineNote}` : null,
      };
    return null;
  }
}
