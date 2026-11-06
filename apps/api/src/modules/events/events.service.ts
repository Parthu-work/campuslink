import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  APP_NAME,
  EVENT_LINK_LEAD_MIN,
  HOSTED_KINDS,
  QA_KINDS,
  icsEscape,
  type AttendeeView,
  type EventKind,
  type EventQuestionView,
  type EventView,
  type OfficeHoursSubscriptionView,
  type RsvpStatus,
  type eventBody,
  type eventUpdateBody,
  type eventsQuery,
} from '@campuslink/shared';
import {
  EventModel,
  EventQuestionModel,
  EventQuestionVoteModel,
  EventRsvpModel,
  OfficeHoursSubscriptionModel,
  type EventDoc,
  type EventQuestionDoc,
  type RsvpDoc,
} from './event.model.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { ErrorCode } from '@campuslink/shared';
import { plainText } from '../../lib/text.js';
import { requireTenantId } from '../../lib/context.js';
import { withTextSearch } from '../../db/search.js';
import { noAward, type Award } from '../../lib/awards.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import { backgroundAuth } from '../users/users.service.js';
import { findTenantById } from '../tenants/tenant.cache.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { isModerator, type Removal } from '../moderation/moderation.service.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthState } from '../../types.js';
import { noCircles, type CircleScope } from '../../lib/circle-scope.js';

export const EVENT_REMINDER_JOB = 'events.reminder';
/** Prompt 2, G6: when a weekly office hour ends, the next one in its series is made. */
export const OFFICE_HOURS_NEXT_JOB = 'events.office_hours_next';
const WEEK = 7 * 86_400_000;
const HOUR = 3_600_000;
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const FORMER = (id: string) => ({ userId: id, name: 'Former member', avatarFileId: null });

export interface EventsDeps {
  profiles: ProfilesService;
  notifications: NotificationsService;
  jobs: JobQueue;
}

const canManageAll = (v: AuthState) => v.permissions.has('events:create');
const canCreate = (v: AuthState, kind: EventKind) =>
  canManageAll(v) || (v.permissions.has('ama:host') && HOSTED_KINDS.includes(kind));

/** RFC 5545 UTC date-time. */
const icsDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
/** RFC 5545 line folding at 75 octets. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * Events with RSVP (capacity and an automatic waitlist), reminders, calendar export, check-in and
 * a live Q&A queue. Seats are claimed with conditional updates, so capacity holds under races.
 */
export class EventsService {
  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const u = oid(userId);
    const [rsvps, questions, hosted, officeHoursSubscriptions] = await Promise.all([
      EventRsvpModel.find({ userId: u }).select('eventId status checkedIn createdAt').lean(),
      EventQuestionModel.find({ authorId: u }).select('eventId body createdAt').lean(),
      EventModel.find({ hostId: u }).select('title kind startsAt status').lean(),
      OfficeHoursSubscriptionModel.find({ userId: u }).select('hostId createdAt').lean(),
    ]);
    return { rsvps, questions, hosted, officeHoursSubscriptions };
  }

  /** RSVPs and questions are deleted (seats are freed); my future events are cancelled. */
  async eraseFor(userId: string) {
    const u = oid(userId);
    const going = await EventRsvpModel.find({ userId: u, status: 'going' })
      .select('eventId')
      .lean<RsvpDoc[]>();
    for (const r of going)
      await EventModel.updateOne({ _id: r.eventId, goingCount: { $gt: 0 } }, { $inc: { goingCount: -1 } });
    await Promise.all([
      EventRsvpModel.deleteMany({ userId: u }),
      EventQuestionModel.deleteMany({ authorId: u }),
      EventQuestionVoteModel.deleteMany({ userId: u }),
      EventModel.updateMany(
        { hostId: u, status: 'scheduled', startsAt: { $gt: new Date() } },
        { $set: { status: 'cancelled' }, $inc: { version: 1 } },
      ),
      // Their weekly series stop, and nobody follows their office hours any more.
      EventModel.updateMany({ hostId: u, recurrence: { $ne: null } }, { $set: { recurrence: null } }),
      OfficeHoursSubscriptionModel.deleteMany({ $or: [{ userId: u }, { hostId: u }] }),
    ]);
  }

  /** Points for attendance and hosting (wired in app.ts). */
  award: Award = noAward;
  /** Product analytics (B9), set in app.ts. */
  track: Track = noTrack;
  /** Prompt 2, G7: a circle's events are for its members (set by the app from CirclesService). */
  circles: CircleScope = noCircles;

  constructor(private readonly d: EventsDeps) {}

  // ── Loading and access ─────────────────────────────
  private async byId(id: string) {
    const e = await EventModel.findById(id).lean<EventDoc>();
    if (!e) throw notFound('Event');
    return e;
  }

  private async eligible(viewer: AuthState, e: EventDoc) {
    if (e.circleId && !(await this.circles.canSee(viewer, e.circleId))) return false;
    if (canManageAll(viewer) || String(e.hostId) === viewer.userId) return true;
    if (e.audience === 'students' && !viewer.roles.includes('STUDENT')) return false;
    if (e.audience === 'alumni' && !viewer.roles.includes('ALUMNI')) return false;
    if (e.branches.length) {
      const branch = (await this.d.profiles.rankingFacts([viewer.userId])).get(viewer.userId)?.branch ?? null;
      if (!branch || !e.branches.includes(branch)) return false;
    }
    return true;
  }

  private async visible(viewer: AuthState, id: string) {
    const e = await this.byId(id);
    if (e.removal && !isModerator(viewer)) throw notFound('Event');
    if (!(await this.eligible(viewer, e))) throw notFound('Event');
    return e;
  }

  private manages(viewer: AuthState, e: EventDoc) {
    return String(e.hostId) === viewer.userId || canManageAll(viewer);
  }

  private async managed(viewer: AuthState, id: string) {
    const e = await this.visible(viewer, id);
    if (!this.manages(viewer, e)) throw forbidden();
    return e;
  }

  // ── Views ─────────────────────────────
  private async views(viewer: AuthState, rows: EventDoc[]): Promise<EventView[]> {
    if (!rows.length) return [];
    const ids = rows.map((e) => e._id);
    const me = oid(viewer.userId);
    const circleNames = await this.circles.names(rows.flatMap((e) => (e.circleId ? [e.circleId] : [])));
    const [mine, waitlists, refs] = await Promise.all([
      EventRsvpModel.find({ eventId: { $in: ids }, userId: me }).lean<RsvpDoc[]>(),
      EventRsvpModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { eventId: { $in: ids }, status: 'waitlist' } },
        { $group: { _id: '$eventId', n: { $sum: 1 } } },
      ]),
      this.d.profiles.refsFor(rows.map((e) => e.hostId)),
    ]);
    const myRsvp = new Map(mine.map((r) => [String(r.eventId), r]));
    const wl = new Map(waitlists.map((w) => [String(w._id), w.n]));
    const now = Date.now();
    return Promise.all(
      rows.map(async (e) => {
        const r = myRsvp.get(String(e._id));
        const status = r && r.status !== 'cancelled' ? (r.status as RsvpStatus) : null;
        const manage = this.manages(viewer, e);
        const linkOpen =
          manage ||
          (status === 'going' &&
            now >= e.startsAt.getTime() - EVENT_LINK_LEAD_MIN * 60_000 &&
            now <= e.endsAt.getTime() + HOUR);
        let position: number | null = null;
        if (status === 'waitlist' && r)
          position =
            (await EventRsvpModel.countDocuments({
              eventId: e._id,
              status: 'waitlist',
              queuedAt: { $lt: r.queuedAt },
            })) + 1;
        return {
          id: String(e._id),
          circle: e.circleId
            ? { id: String(e.circleId), name: circleNames.get(String(e.circleId)) ?? '' }
            : null,
          title: e.title,
          description: e.description,
          kind: e.kind,
          mode: e.mode,
          startsAt: e.startsAt.toISOString(),
          endsAt: e.endsAt.toISOString(),
          location: e.location,
          onlineUrl: linkOpen ? (e.onlineUrl ?? null) : null,
          capacity: e.capacity ?? null,
          audience: e.audience,
          branches: e.branches,
          host: refs.get(String(e.hostId)) ?? FORMER(String(e.hostId)),
          status: e.removal ? 'removed' : e.status,
          going: e.goingCount,
          waitlist: wl.get(String(e._id)) ?? 0,
          myRsvp: status,
          myWaitlistPosition: position,
          isHost: String(e.hostId) === viewer.userId,
          canManage: manage,
          hasQa: QA_KINDS.includes(e.kind),
          recurrence: e.recurrence
            ? { weekly: true as const, until: new Date(e.recurrence.until).toISOString() }
            : null,
          seriesId: e.seriesId ? String(e.seriesId) : null,
        };
      }),
    );
  }

  // ── Reading ─────────────────────────────
  async list(viewer: AuthState, q: z.output<typeof eventsQuery>): Promise<EventView[]> {
    const now = new Date();
    const filter: Record<string, unknown> = { removal: null };
    if (q.kind) filter.kind = q.kind;
    // Prompt 2, G7: one circle's events, or events outside circles and in the viewer's circles.
    if (q.circle) {
      if (!(await this.circles.canSee(viewer, q.circle))) throw notFound('Circle');
      filter.circleId = oid(q.circle);
    } else Object.assign(filter, { $and: [await this.circles.condition(viewer)] });
    let sort: Record<string, 1 | -1> = { startsAt: 1, _id: 1 };
    if (q.when === 'upcoming') {
      filter.status = 'scheduled';
      filter.endsAt = { $gte: now };
    } else if (q.when === 'past') {
      filter.endsAt = { $lt: now };
      sort = { startsAt: -1, _id: -1 };
    } else {
      const mine = await EventRsvpModel.find({
        userId: oid(viewer.userId),
        status: { $in: ['going', 'waitlist'] },
      })
        .select('eventId')
        .limit(200)
        .lean<RsvpDoc[]>();
      filter.$or = [{ hostId: oid(viewer.userId) }, { _id: { $in: mine.map((r) => r.eventId) } }];
      filter.endsAt = { $gte: new Date(now.getTime() - 30 * 86_400_000) };
    }
    const rows = await EventModel.find(filter).sort(sort).limit(100).lean<EventDoc[]>();
    const allowed: EventDoc[] = [];
    for (const e of rows) if (await this.eligible(viewer, e)) allowed.push(e);
    return this.views(viewer, allowed.slice(0, 50));
  }

  async get(viewer: AuthState, id: string): Promise<EventView> {
    return (await this.views(viewer, [await this.visible(viewer, id)]))[0] as EventView;
  }

  // ── Writing ─────────────────────────────
  private fields(body: z.output<typeof eventBody>) {
    return {
      title: plainText(body.title),
      description: plainText(body.description),
      kind: body.kind,
      mode: body.mode,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      location: body.mode === 'online' ? '' : plainText(body.location),
      onlineUrl: body.mode === 'in_person' ? null : body.onlineUrl,
      capacity: body.capacity,
      audience: body.audience,
      branches: body.branches,
      recurrence:
        body.kind === 'office_hours' && body.recurrence
          ? { weekly: true, until: new Date(body.recurrence.until) }
          : null,
    };
  }

  private async schedule(e: Pick<EventDoc, '_id' | 'startsAt' | 'version'>) {
    const tenantId = String(requireTenantId());
    const id = String(e._id);
    const now = Date.now();
    for (const [kind, before] of [
      ['24h', 24 * HOUR],
      ['1h', HOUR],
    ] as const) {
      const at = e.startsAt.getTime() - before;
      if (at > now)
        await this.d.jobs.enqueue(
          EVENT_REMINDER_JOB,
          { tenantId, eventId: id, version: e.version, kind },
          { jobId: `evrem${kind}-${id}-v${e.version}`, delayMs: at - now },
        );
    }
  }

  private async unschedule(id: string, version: number) {
    for (const k of ['24h', '1h'])
      await this.d.jobs.cancel(EVENT_REMINDER_JOB, `evrem${k}-${id}-v${version}`);
  }

  async create(viewer: AuthState, body: z.output<typeof eventBody>, meta: RequestMetaLite) {
    if (!canCreate(viewer, body.kind))
      throw new AppError(
        403,
        ErrorCode.FORBIDDEN,
        'Alumni can host AMAs and office hours; other events are created by staff',
      );
    if (Date.parse(body.startsAt) < Date.now() - 5 * 60_000) throw badRequest('Pick a time in the future');
    const circleId = await this.circles.assertCanPost(viewer, body.circleId);
    const e = await EventModel.create({ ...this.fields(body), circleId, hostId: oid(viewer.userId) });
    await this.schedule(e);
    if (e.recurrence) await EventModel.updateOne({ _id: e._id }, { $set: { seriesId: e._id } });
    await this.scheduleNext(e);
    if (e.kind === 'office_hours') await this.notifySubscribers(e);
    await audit.record(
      {
        action: 'event.created',
        actorId: viewer.userId,
        targetType: 'event',
        targetId: String(e._id),
        meta: { kind: body.kind },
      },
      meta,
    );
    return this.get(viewer, String(e._id));
  }

  private async notifyAll(e: EventDoc, type: 'event_updated' | 'event_cancelled' | 'event_reminder') {
    const rsvps = await EventRsvpModel.find({
      eventId: e._id,
      status: type === 'event_reminder' ? 'going' : { $in: ['going', 'waitlist'] },
    })
      .select('userId')
      .limit(10_000)
      .lean<RsvpDoc[]>();
    for (const r of rsvps)
      await this.d.notifications.notify(r.userId, type, {
        event: e.title,
        eventId: String(e._id),
        start: e.startsAt.toISOString(),
      });
  }

  async update(viewer: AuthState, id: string, body: z.output<typeof eventUpdateBody>, meta: RequestMetaLite) {
    const e = await this.managed(viewer, id);
    if (e.status !== 'scheduled') throw conflict('This event was cancelled');
    if (!canCreate(viewer, body.kind)) throw forbidden();
    if (body.capacity !== null && body.capacity < e.goingCount)
      throw badRequest(`${e.goingCount} people are already going; the capacity can’t be lower than that`);
    const next = await EventModel.findOneAndUpdate(
      { _id: e._id, version: e.version, status: 'scheduled' },
      { $set: this.fields(body), $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<EventDoc>();
    if (!next) throw conflict('This event just changed. Refresh and try again.');
    await this.unschedule(id, e.version);
    await this.schedule(next);
    if (next.recurrence && !next.seriesId)
      await EventModel.updateOne({ _id: next._id }, { $set: { seriesId: next._id } });
    await this.scheduleNext(next);
    await this.promote(next);
    if (body.notifyChange) await this.notifyAll(next, 'event_updated');
    await audit.record(
      { action: 'event.updated', actorId: viewer.userId, targetType: 'event', targetId: id },
      meta,
    );
    return this.get(viewer, id);
  }

  async cancel(viewer: AuthState, id: string, meta: RequestMetaLite) {
    const e = await this.managed(viewer, id);
    const next = await EventModel.findOneAndUpdate(
      { _id: e._id, status: 'scheduled' },
      { $set: { status: 'cancelled' }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean<EventDoc>();
    if (!next) throw conflict('This event is already cancelled');
    await this.unschedule(id, e.version);
    await this.notifyAll(next, 'event_cancelled');
    await audit.record(
      { action: 'event.cancelled', actorId: viewer.userId, targetType: 'event', targetId: id },
      meta,
    );
    return this.get(viewer, id);
  }

  // ── RSVP ─────────────────────────────
  /** Take a seat if one is free (atomic against capacity). */
  private async claimSeat(eventId: Types.ObjectId) {
    const r = await EventModel.updateOne(
      {
        _id: eventId,
        status: 'scheduled',
        $or: [{ capacity: null }, { $expr: { $lt: ['$goingCount', '$capacity'] } }],
      },
      { $inc: { goingCount: 1 } },
    );
    return r.modifiedCount > 0;
  }

  /** Fill free seats from the waitlist, oldest first. */
  private async promote(e: Pick<EventDoc, '_id' | 'title' | 'startsAt'>) {
    for (let i = 0; i < 1000; i++) {
      const next = await EventRsvpModel.findOne({ eventId: e._id, status: 'waitlist' })
        .sort({ queuedAt: 1 })
        .lean<RsvpDoc>();
      if (!next || !(await this.claimSeat(e._id))) return;
      const moved = await EventRsvpModel.updateOne(
        { _id: next._id, status: 'waitlist' },
        { $set: { status: 'going' } },
      );
      if (!moved.modifiedCount) {
        await EventModel.updateOne({ _id: e._id }, { $inc: { goingCount: -1 } });
        continue;
      }
      await this.d.notifications.notify(next.userId, 'event_promoted', {
        event: e.title,
        eventId: String(e._id),
        start: e.startsAt.toISOString(),
      });
    }
  }

  async rsvp(viewer: AuthState, id: string, going: boolean) {
    const e = await this.visible(viewer, id);
    if (e.removal) throw notFound('Event');
    const me = oid(viewer.userId);
    if (!going) {
      const before = await EventRsvpModel.findOneAndUpdate(
        { eventId: e._id, userId: me, status: { $in: ['going', 'waitlist'] } },
        { $set: { status: 'cancelled', checkedIn: false } },
        { returnDocument: 'before' },
      ).lean<RsvpDoc>();
      if (before?.status === 'going') {
        await EventModel.updateOne({ _id: e._id, goingCount: { $gt: 0 } }, { $inc: { goingCount: -1 } });
        if (e.status === 'scheduled') await this.promote(e);
      }
      return this.get(viewer, id);
    }
    if (e.status !== 'scheduled' || e.endsAt.getTime() < Date.now())
      throw conflict('RSVPs are closed for this event');
    // Join the queue first (one RSVP per member), then try for a seat.
    let rsvp: RsvpDoc | null;
    try {
      rsvp = (
        await EventRsvpModel.create({ eventId: e._id, userId: me, status: 'waitlist', queuedAt: new Date() })
      ).toObject() as RsvpDoc;
    } catch (err) {
      if (!isDuplicate(err)) throw err;
      rsvp = await EventRsvpModel.findOneAndUpdate(
        { eventId: e._id, userId: me, status: 'cancelled' },
        { $set: { status: 'waitlist', queuedAt: new Date() } },
        { returnDocument: 'after' },
      ).lean<RsvpDoc>();
      if (!rsvp) return this.get(viewer, id); // Already going or waitlisted.
    }
    // Nobody ahead in the queue: take a free seat.
    const ahead = await EventRsvpModel.countDocuments({
      eventId: e._id,
      status: 'waitlist',
      queuedAt: { $lt: rsvp.queuedAt },
    });
    if (!ahead && (await this.claimSeat(e._id))) {
      const moved = await EventRsvpModel.updateOne(
        { _id: rsvp._id, status: 'waitlist' },
        { $set: { status: 'going' } },
      );
      if (!moved.modifiedCount) await EventModel.updateOne({ _id: e._id }, { $inc: { goingCount: -1 } });
    }
    return this.get(viewer, id);
  }

  async attendees(viewer: AuthState, id: string): Promise<AttendeeView[]> {
    const e = await this.managed(viewer, id);
    const rows = await EventRsvpModel.find({ eventId: e._id, status: { $in: ['going', 'waitlist'] } })
      .sort({ status: 1, queuedAt: 1 })
      .limit(10_000)
      .lean<RsvpDoc[]>();
    const refs = await this.d.profiles.refsFor(rows.map((r) => r.userId));
    return rows.map((r) => ({
      person: refs.get(String(r.userId)) ?? FORMER(String(r.userId)),
      status: r.status as RsvpStatus,
      checkedIn: r.checkedIn,
    }));
  }

  /** The host marks who came; attendance earns XP (and hosting earns impact once). */
  async checkIn(viewer: AuthState, id: string, userId: string, attended: boolean) {
    const e = await this.managed(viewer, id);
    if (e.startsAt.getTime() - Date.now() > HOUR) throw conflict('Check-in opens an hour before the start');
    const r = await EventRsvpModel.findOneAndUpdate(
      { eventId: e._id, userId: oid(userId), status: 'going' },
      { $set: { checkedIn: attended } },
      { returnDocument: 'after' },
    ).lean<RsvpDoc>();
    if (!r) throw notFound('RSVP');
    if (attended) {
      await this.award(userId, 'event_attended', id, { from: e.hostId });
      await this.award(e.hostId, 'event_hosted', id);
    }
    return { checkedIn: attended };
  }

  async ics(viewer: AuthState, id: string) {
    const e = await this.visible(viewer, id);
    const view = (await this.views(viewer, [e]))[0] as EventView;
    const where =
      [e.location, view.onlineUrl].filter(Boolean).join(' · ') || (e.mode === 'online' ? 'Online' : '');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${icsEscape(APP_NAME)}//Events//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${String(e._id)}-${String(requireTenantId())}@campus-events`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(e.startsAt)}`,
      `DTEND:${icsDate(e.endsAt)}`,
      `SEQUENCE:${e.version}`,
      `SUMMARY:${icsEscape(e.title)}`,
      `DESCRIPTION:${icsEscape(e.description.slice(0, 1500))}`,
      ...(where ? [`LOCATION:${icsEscape(where)}`] : []),
      `STATUS:${e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  // ── Weekly office hours (prompt 2, G6) ─────────────────────────────

  /** Queues the making of the next instance for when this one ends (keyed by its end time). */
  private async scheduleNext(e: Pick<EventDoc, '_id' | 'endsAt' | 'kind' | 'recurrence'>) {
    if (e.kind !== 'office_hours' || !e.recurrence) return;
    const end = new Date(e.endsAt);
    await this.d.jobs.enqueue(
      OFFICE_HOURS_NEXT_JOB,
      { tenantId: String(requireTenantId()), eventId: String(e._id), endsAt: end.toISOString() },
      { jobId: `ohnext-${String(e._id)}-${end.getTime()}`, delayMs: Math.max(0, end.getTime() - Date.now()) },
    );
  }

  /**
   * Job: the instance ended, so make next week's, unless the series stopped (recurrence removed,
   * the event removed or moved since, the host left) or the next one would be after `until`. The
   * unique index on (series, start) makes a second run a no-op. A one-off cancellation does not
   * stop the series.
   */
  async onNextOfficeHours(job: TenantJob) {
    const e = await EventModel.findById(String(job.eventId)).lean<EventDoc>();
    if (!e || !e.recurrence || e.removal || e.endsAt.toISOString() !== job.endsAt) return;
    const startsAt = new Date(e.startsAt.getTime() + WEEK);
    if (startsAt > new Date(e.recurrence.until)) return;
    if (!(await this.d.profiles.isActiveMember(String(e.hostId)))) return;
    let next: EventDoc;
    try {
      const created = await EventModel.create({
        title: e.title,
        description: e.description,
        kind: e.kind,
        mode: e.mode,
        startsAt,
        endsAt: new Date(e.endsAt.getTime() + WEEK),
        location: e.location,
        onlineUrl: e.onlineUrl ?? null,
        capacity: e.capacity ?? null,
        audience: e.audience,
        branches: e.branches,
        hostId: e.hostId,
        recurrence: { weekly: true, until: e.recurrence.until },
        seriesId: e.seriesId ?? e._id,
        circleId: e.circleId ?? null,
      });
      next = created.toObject() as EventDoc;
    } catch (err) {
      if (isDuplicate(err)) return;
      throw err;
    }
    await this.schedule(next);
    await this.scheduleNext(next);
    await this.notifySubscribers(next);
  }

  /** Tells the host's followers about a new office hour they may attend (current rights apply). */
  private async notifySubscribers(e: EventDoc) {
    const subs = await OfficeHoursSubscriptionModel.find({ hostId: e.hostId })
      .select('userId')
      .limit(5000)
      .lean<{ userId: Types.ObjectId }[]>();
    if (!subs.length) return;
    const tenant = await findTenantById(requireTenantId());
    if (!tenant) return;
    const host = (await this.d.profiles.refsFor([e.hostId])).get(String(e.hostId));
    for (const s of subs) {
      const auth = await backgroundAuth(s.userId, tenant);
      if (!auth || !(await this.eligible(auth, e))) continue;
      await this.d.notifications.notify(s.userId, 'office_hours_scheduled', {
        name: host?.name ?? '',
        event: e.title,
        eventId: String(e._id),
        start: e.startsAt.toISOString(),
      });
    }
  }

  /** Follow (or stop following) a member's office hours. */
  async subscribe(viewer: AuthState, hostId: string, on: boolean): Promise<OfficeHoursSubscriptionView[]> {
    if (hostId === viewer.userId) throw badRequest('You cannot follow your own office hours');
    const key = { userId: oid(viewer.userId), hostId: oid(hostId) };
    if (on) {
      if (!(await this.d.profiles.isActiveMember(hostId))) throw notFound('Member');
      const hosts =
        (await EventModel.exists({ hostId: oid(hostId), kind: 'office_hours', removal: null })) !== null;
      if (!hosts) throw badRequest('This member does not hold office hours yet');
      const res = await OfficeHoursSubscriptionModel.updateOne(
        key,
        { $setOnInsert: key },
        { upsert: true },
      ).catch((err: unknown) => {
        if (!isDuplicate(err)) throw err;
        return null;
      });
      if (res?.upsertedCount) await this.track(viewer.userId, 'office_hours_subscribed', { hostId });
    } else await OfficeHoursSubscriptionModel.deleteOne(key);
    return this.subscriptions(viewer);
  }

  async subscriptions(viewer: AuthState): Promise<OfficeHoursSubscriptionView[]> {
    const rows = await OfficeHoursSubscriptionModel.find({ userId: oid(viewer.userId) })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean<{ hostId: Types.ObjectId; createdAt: Date }[]>();
    const refs = await this.d.profiles.refsFor(rows.map((r) => r.hostId));
    return rows.flatMap((r) => {
      const host = refs.get(String(r.hostId));
      return host ? [{ host, since: r.createdAt.toISOString() }] : [];
    });
  }

  /** Delayed job: remind people going, unless the event changed since it was scheduled. */
  async onReminder(job: TenantJob) {
    const e = await EventModel.findOne({
      _id: job.eventId,
      version: job.version,
      status: 'scheduled',
      removal: null,
    }).lean<EventDoc>();
    if (e) await this.notifyAll(e, 'event_reminder');
  }

  // ── Q&A queue ─────────────────────────────
  private async qaEvent(viewer: AuthState, id: string) {
    const e = await this.visible(viewer, id);
    if (!QA_KINDS.includes(e.kind)) throw notFound('Q&A');
    return e;
  }

  async questions(viewer: AuthState, id: string): Promise<EventQuestionView[]> {
    const e = await this.qaEvent(viewer, id);
    const manage = this.manages(viewer, e);
    const rows = await EventQuestionModel.find({
      eventId: e._id,
      status: { $in: manage ? ['open', 'answered', 'hidden'] : ['open', 'answered'] },
    })
      .sort({ votes: -1, _id: 1 })
      .limit(300)
      .lean<EventQuestionDoc[]>();
    const [refs, mine] = await Promise.all([
      this.d.profiles.refsFor(rows.map((q) => q.authorId)),
      EventQuestionVoteModel.find({ questionId: { $in: rows.map((q) => q._id) }, userId: oid(viewer.userId) })
        .select('questionId')
        .lean<{ questionId: Types.ObjectId }[]>(),
    ]);
    const voted = new Set(mine.map((v) => String(v.questionId)));
    const order = { open: 0, answered: 1, hidden: 2, removed: 3 } as const;
    return rows
      .sort((a, b) => order[a.status] - order[b.status])
      .map((q) => ({
        id: String(q._id),
        body: q.body,
        author: refs.get(String(q.authorId)) ?? FORMER(String(q.authorId)),
        votes: q.votes,
        votedByMe: voted.has(String(q._id)),
        status: q.status as EventQuestionView['status'],
        isMine: String(q.authorId) === viewer.userId,
        createdAt: q.createdAt.toISOString(),
      }));
  }

  async ask(viewer: AuthState, id: string, body: string) {
    const e = await this.qaEvent(viewer, id);
    if (e.status !== 'scheduled' || e.endsAt.getTime() < Date.now()) throw conflict('Questions are closed');
    const text = plainText(body);
    if (text.length < 5) throw badRequest('Write a question');
    const q = await EventQuestionModel.create({ eventId: e._id, authorId: oid(viewer.userId), body: text });
    return (await this.questions(viewer, id)).find((x) => x.id === String(q._id));
  }

  async vote(viewer: AuthState, questionId: string, on: boolean) {
    const q = await EventQuestionModel.findOne({ _id: questionId, status: 'open' }).lean<EventQuestionDoc>();
    if (!q) throw notFound('Question');
    await this.qaEvent(viewer, String(q.eventId));
    if (String(q.authorId) === viewer.userId) throw badRequest('You can’t vote for your own question');
    const key = { questionId: q._id, userId: oid(viewer.userId) };
    if (on) {
      try {
        await EventQuestionVoteModel.create(key);
        await EventQuestionModel.updateOne({ _id: q._id }, { $inc: { votes: 1 } });
      } catch (err) {
        if (!isDuplicate(err)) throw err;
      }
    } else if ((await EventQuestionVoteModel.deleteOne(key)).deletedCount)
      await EventQuestionModel.updateOne({ _id: q._id, votes: { $gt: 0 } }, { $inc: { votes: -1 } });
    return { voted: on };
  }

  async setQuestionStatus(viewer: AuthState, questionId: string, status: 'open' | 'answered' | 'hidden') {
    const q = await EventQuestionModel.findOne({
      _id: questionId,
      status: { $ne: 'removed' },
    }).lean<EventQuestionDoc>();
    if (!q) throw notFound('Question');
    await this.managed(viewer, String(q.eventId));
    await EventQuestionModel.updateOne({ _id: q._id, status: { $ne: 'removed' } }, { $set: { status } });
    return { status };
  }

  // ── Moderation, search and analytics ─────────────────────────────
  readonly handler = {
    load: async (id: string) => {
      const e = await EventModel.findById(id).lean<EventDoc>();
      return e
        ? {
            authorId: String(e.hostId),
            status: e.removal ? 'removed' : 'published',
            snapshot: `${e.title}\n${e.description.slice(0, 1500)}`,
            context: { eventId: String(e._id) },
          }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await EventModel.updateOne(
          removal ? { _id: id, removal: null } : { _id: id, removal: { $ne: null } },
          { $set: { removal } },
        )
      ).modifiedCount > 0,
  };

  readonly questionHandler = {
    load: async (id: string) => {
      const q = await EventQuestionModel.findById(id).lean<EventQuestionDoc>();
      return q
        ? {
            authorId: String(q.authorId),
            status: q.status === 'removed' ? 'removed' : 'published',
            snapshot: q.body,
            context: { eventId: String(q.eventId) },
          }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await EventQuestionModel.updateOne(
          removal ? { _id: id, status: { $ne: 'removed' } } : { _id: id, status: 'removed' },
          { $set: { status: removal ? 'removed' : 'open', removal } },
        )
      ).modifiedCount > 0,
  };

  /** Report targets: only what the reporter can see. */
  async reportTarget(type: 'event' | 'event_question', viewer: AuthState, id: string) {
    const item = type === 'event' ? await this.handler.load(id) : await this.questionHandler.load(id);
    if (!item || item.status !== 'published' || item.authorId === viewer.userId) return null;
    try {
      await this.visible(viewer, item.context.eventId ?? id);
    } catch {
      return null;
    }
    return { subjectUserId: item.authorId, snapshot: item.snapshot.slice(0, 2500) };
  }

  /** Analytics: events held, RSVPs and check-ins since a date (aggregates only). */
  async stats(since: Date) {
    const held = await EventModel.find({
      startsAt: { $gte: since, $lte: new Date() },
      status: 'scheduled',
      removal: null,
    })
      .select('_id')
      .limit(10_000)
      .lean<EventDoc[]>();
    const ids = held.map((e) => e._id);
    const [rsvps, attended] = await Promise.all([
      EventRsvpModel.countDocuments({ eventId: { $in: ids }, status: 'going' }),
      EventRsvpModel.countDocuments({ eventId: { $in: ids }, status: 'going', checkedIn: true }),
    ]);
    return { held: held.length, rsvps, attended };
  }

  /** Events held between two dates with their host (B8 alumni engagement; the host is public). */
  /**
   * Batch pages (prompt 2, G6): upcoming meetups for a batch, those whose title names the batch
   * year or a reunion, open to its branch.
   */
  async reunionsFor(gradYear: number, branch: string) {
    const rows = await EventModel.find({
      kind: 'meetup',
      status: 'scheduled',
      removal: null,
      endsAt: { $gte: new Date() },
      $and: [
        { $or: [{ branches: { $size: 0 } }, { branches: branch }] },
        { $or: [{ title: new RegExp(`\\b${gradYear}\\b`) }, { title: /reunion/i }] },
      ],
    })
      .sort({ startsAt: 1 })
      .limit(10)
      .lean<EventDoc[]>();
    return rows.map((e) => ({
      id: String(e._id),
      title: e.title,
      startsAt: e.startsAt.toISOString(),
      kind: e.kind,
    }));
  }

  /** Recognition (prompt 2, G6): events a member hosted that ended in a window. */
  async hostedBetween(hostId: string, from: Date, to: Date): Promise<number> {
    return EventModel.countDocuments({
      hostId: oid(hostId),
      status: 'scheduled',
      removal: null,
      endsAt: { $gte: from, $lt: to, $lte: new Date() },
    });
  }

  async heldBetween(from: Date, to: Date) {
    const rows = await EventModel.find({
      startsAt: { $gte: from, $lt: to },
      status: 'scheduled',
      removal: null,
    })
      .select('title kind startsAt hostId')
      .limit(10_000)
      .lean<EventDoc[]>();
    return rows.map((e) => ({
      title: e.title,
      kind: e.kind,
      startsAt: e.startsAt,
      hostId: String(e.hostId),
    }));
  }

  /** Who hosted or attended (for alumni participation). */
  async hostsSince(since: Date) {
    return (await EventModel.distinct('hostId', {
      startsAt: { $gte: since },
      removal: null,
    })) as Types.ObjectId[];
  }

  /** Command palette: upcoming events matching the text that the viewer may see. */
  async search(viewer: AuthState, text: string) {
    if (text.length < 3) return [];
    const rows = await withTextSearch(
      EventModel.find({ status: 'scheduled', removal: null, endsAt: { $gte: new Date() } }),
      text,
    )
      .limit(10)
      .lean<EventDoc[]>();
    const allowed: EventDoc[] = [];
    for (const e of rows) if (await this.eligible(viewer, e)) allowed.push(e);
    return this.views(viewer, allowed.slice(0, 5));
  }
}
