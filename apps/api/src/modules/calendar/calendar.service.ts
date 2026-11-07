import { Schema, Types, type InferSchemaType } from 'mongoose';
import {
  CALENDAR_AHEAD_DAYS,
  CALENDAR_PAST_DAYS,
  type CalendarFeedLink,
  type CalendarFeedView,
  type Locale,
} from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { icsCalendar, type IcsEvent } from '../../lib/ics.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { UserModel } from '../auth/user.model.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import type { AuthState } from '../../types.js';

/**
 * The calendar feed (prompt 2, G9): one secret ICS address per member, so Google and Apple
 * calendars subscribe to their sessions, the events they are going to and their drive deadlines.
 * Only a hash of the token is stored; a new link replaces the old one, which stops working.
 */
const feedSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true },
    lastFetchedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
feedSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
feedSchema.index({ tenantId: 1, tokenHash: 1 }, { unique: true });
type FeedDoc = InferSchemaType<typeof feedSchema> & { _id: Types.ObjectId; createdAt: Date };
export const CalendarFeedModel = defineTenantModel('CalendarFeed', feedSchema);

/** What each module puts in the feed; the feed words and localises it. */
export type CalendarItem =
  | { kind: 'session'; id: string; version: number; start: Date; end: Date; with: string; cancelled: boolean }
  | {
      kind: 'event';
      id: string;
      version: number;
      start: Date;
      end: Date;
      title: string;
      location: string;
      cancelled: boolean;
    }
  | { kind: 'drive'; id: string; start: Date; company: string; title: string; venue: string }
  | { kind: 'deadline'; id: string; at: Date; company: string; title: string };

export interface CalendarDeps {
  sessions: (userId: string, from: Date, to: Date) => Promise<CalendarItem[]>;
  events: (userId: string, from: Date, to: Date) => Promise<CalendarItem[]>;
  /** Registered drives and open eligible drives' deadlines (students with placements on). */
  drives: (viewer: AuthState) => Promise<CalendarItem[]>;
  viewerOf: (userId: string, tenant: TenantRecord) => Promise<AuthState | null>;
  tenantUrl: (tenant: TenantRecord, path: string) => string;
}

const WORDS: Record<
  Locale,
  {
    session: (n: string) => string;
    drive: (c: string) => string;
    deadline: (c: string) => string;
    open: string;
  }
> = {
  en: {
    session: (n) => `Mentorship session with ${n}`,
    drive: (c) => `Placement drive: ${c}`,
    deadline: (c) => `Registration closes: ${c}`,
    open: 'Open in CampusLink',
  },
  te: {
    session: (n) => `${n}తో మెంటర్‌షిప్ సెషన్`,
    drive: (c) => `ప్లేస్‌మెంట్ డ్రైవ్: ${c}`,
    deadline: (c) => `రిజిస్ట్రేషన్ ముగుస్తుంది: ${c}`,
    open: 'CampusLinkలో తెరవండి',
  },
  hi: {
    session: (n) => `${n} के साथ मेंटरशिप सत्र`,
    drive: (c) => `प्लेसमेंट ड्राइव: ${c}`,
    deadline: (c) => `रजिस्ट्रेशन बंद होगा: ${c}`,
    open: 'CampusLink में खोलें',
  },
};
const DAY = 86_400_000;
/** The last fetch is recorded at most this often (calendars poll every few minutes to hours). */
const TOUCH_MS = 3600_000;

export class CalendarService {
  constructor(private readonly d: CalendarDeps) {}

  private link(tenant: TenantRecord, token: string): CalendarFeedLink {
    const url = this.d.tenantUrl(tenant, `/api/v1/calendar/${token}.ics`);
    const webcal = url.replace(/^https?:\/\//, 'webcal://');
    return {
      url,
      webcal,
      google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    };
  }

  async view(viewer: AuthState): Promise<CalendarFeedView> {
    const f = await CalendarFeedModel.findOne({ userId: new Types.ObjectId(viewer.userId) }).lean<FeedDoc>();
    return {
      enabled: !!f,
      createdAt: f?.createdAt.toISOString() ?? null,
      lastFetchedAt: f?.lastFetchedAt?.toISOString() ?? null,
    };
  }

  /** Makes the feed, or replaces its address (the old one stops working at once). */
  async issue(viewer: AuthState, tenant: TenantRecord, meta: RequestMetaLite): Promise<CalendarFeedLink> {
    const token = randomToken();
    const userId = new Types.ObjectId(viewer.userId);
    const before = await CalendarFeedModel.findOneAndUpdate(
      { userId },
      { $set: { tokenHash: sha256(token), lastFetchedAt: null }, $setOnInsert: { userId } },
      { upsert: true },
    ).lean();
    await audit.record(
      { action: before ? 'calendar.feed_replaced' : 'calendar.feed_created', actorId: viewer.userId },
      meta,
    );
    return this.link(tenant, token);
  }

  async stop(viewer: AuthState, meta: RequestMetaLite): Promise<CalendarFeedView> {
    const r = await CalendarFeedModel.deleteOne({ userId: new Types.ObjectId(viewer.userId) });
    if (r.deletedCount) await audit.record({ action: 'calendar.feed_stopped', actorId: viewer.userId }, meta);
    return { enabled: false, createdAt: null, lastFetchedAt: null };
  }

  /** The feed itself, for the public route: null (404) for an unknown or replaced token. */
  async feed(tenant: TenantRecord, token: string, now = new Date()): Promise<string | null> {
    const f = await CalendarFeedModel.findOne({ tokenHash: sha256(token) }).lean<FeedDoc>();
    if (!f) return null;
    const user = await UserModel.findById(f.userId)
      .select('status locale')
      .lean<{ status: string; locale?: Locale }>();
    if (!user || user.status === 'suspended' || user.status === 'deleting') return null;
    const viewer = await this.d.viewerOf(String(f.userId), tenant);
    if (!viewer) return null;
    if (!f.lastFetchedAt || now.getTime() - f.lastFetchedAt.getTime() > TOUCH_MS)
      await CalendarFeedModel.updateOne({ _id: f._id }, { $set: { lastFetchedAt: now } });
    const from = new Date(now.getTime() - CALENDAR_PAST_DAYS * DAY);
    const to = new Date(now.getTime() + CALENDAR_AHEAD_DAYS * DAY);
    const userId = String(f.userId);
    const [sessions, events, drives] = await Promise.all([
      this.d.sessions(userId, from, to),
      this.d.events(userId, from, to),
      this.d.drives(viewer).catch(() => [] as CalendarItem[]),
    ]);
    const w = WORDS[user.locale ?? 'en'] ?? WORDS.en;
    const at = (path: string) => this.d.tenantUrl(tenant, path);
    const host = tenant.slug;
    const items: IcsEvent[] = [...sessions, ...events, ...drives].map((i): IcsEvent => {
      switch (i.kind) {
        case 'session':
          return {
            uid: `session-${i.id}-v${i.version}@${host}`,
            start: i.start,
            end: i.end,
            summary: w.session(i.with),
            description: w.open,
            url: at('/sessions'),
            cancelled: i.cancelled,
          };
        case 'event':
          return {
            uid: `event-${i.id}@${host}`,
            start: i.start,
            end: i.end,
            summary: i.title,
            description: w.open,
            location: i.location,
            url: at(`/events/${i.id}`),
            cancelled: i.cancelled,
          };
        case 'drive':
          return {
            uid: `drive-${i.id}@${host}`,
            start: i.start,
            end: new Date(i.start.getTime() + 3 * 3600_000),
            summary: w.drive(i.company),
            description: `${i.title}\n${w.open}`,
            location: i.venue,
            url: at(`/placements/${i.id}`),
          };
        case 'deadline':
          return {
            uid: `deadline-${i.id}@${host}`,
            start: new Date(i.at.getTime() - 30 * 60_000),
            end: i.at,
            summary: w.deadline(i.company),
            description: `${i.title}\n${w.open}`,
            url: at(`/placements/${i.id}`),
          };
      }
    });
    items.sort((a, b) => a.start.getTime() - b.start.getTime());
    return icsCalendar(`${tenant.branding.shortName} · CampusLink`, items, now);
  }

  // ── Privacy ─────────────────────────────

  async exportFor(userId: string) {
    const f = await CalendarFeedModel.findOne({ userId: new Types.ObjectId(userId) })
      .select('createdAt lastFetchedAt')
      .lean();
    return { calendarFeed: f ? { createdAt: f.createdAt, lastFetchedAt: f.lastFetchedAt } : null };
  }

  async eraseFor(userId: string) {
    await CalendarFeedModel.deleteOne({ userId: new Types.ObjectId(userId) });
  }
}
