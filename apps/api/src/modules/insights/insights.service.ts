import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  currentGradYear,
  INSIGHT_WEEKS,
  MEANINGFUL_EVENTS,
  PRODUCT_EVENT_RETENTION_DAYS,
  PRODUCT_EVENTS,
  RETENTION_COHORTS,
  SMALL_CELL,
  suppress,
  type InsightsView,
  type PlatformInsightRow,
  type PlatformInsightsView,
  type ProductEventName,
  type RetentionCohort,
  type WeeklyActiveRow,
} from '@campuslink/shared';
import { requireTenantId, withPlatformScope } from '../../lib/context.js';
import type { Track } from '../../lib/product-events.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { ProductEventDailyModel, ProductEventModel, type ProductEventDoc } from './insights.model.js';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const ELIGIBLE_TTL_MS = 10 * 60_000;
const ID = /^[a-f0-9]{24}$/;
const ENUM = /^[a-z0-9_]{1,40}$/;
const KEY = /^[a-zA-Z]{1,30}$/;

export const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** Monday (UTC) of the week a date falls in. */
export function weekOf(d: Date): string {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const back = (new Date(t).getUTCDay() + 6) % 7;
  return dayOf(new Date(t - back * DAY));
}
const addDays = (day: string, n: number) => dayOf(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY));
const shown = (n: number) => n === 0 || n >= SMALL_CELL;
/** A percentage to one decimal, only when both counts behind it are shown. */
const pct = (part: number, whole: number) =>
  whole > 0 && shown(part) && shown(whole) ? Math.round((1000 * part) / whole) / 10 : null;
const ratio = (part: number, whole: number) =>
  whole > 0 && shown(part) && shown(whole) ? Math.round((100 * part) / whole) / 100 : null;

/** Only ids and enum values survive; at most five of them. */
function cleanProps(props: Record<string, string> | undefined) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props ?? {}).slice(0, 5))
    if (KEY.test(k) && typeof v === 'string' && (ID.test(v) || ENUM.test(v))) out[k] = v;
  return out;
}

export interface InsightsDeps {
  /** An adult (B2) who allows aggregate analytics (`analytics_aggregate` consent). */
  eligible(userId: string): Promise<boolean>;
  /** Every member's roles (members without a profile count as students). */
  roles(): Promise<Map<string, readonly string[]>>;
  /** Invite links sent since a date (B4). */
  invitedSince(since: Date): Promise<number>;
  /** Hours from request to reply, for requests answered since a date. */
  replyHoursSince(since: Date): Promise<number[]>;
  /** The graduating batch: on the college list, registered for a drive, verified job offers. */
  placement(gradYear: number): Promise<{ finalYear: number; registered: number; jobOffers: number }>;
}

type Row = Pick<ProductEventDoc, 'userId' | 'anonKey' | 'name' | 'day' | 'createdAt'> & {
  props?: Record<string, string>;
};
const who = (r: Pick<Row, 'userId' | 'anonKey'>) => (r.userId ? String(r.userId) : (r.anonKey ?? ''));

/**
 * First-party product analytics (B9). Events come from services after confirmed writes through
 * `track`; minors and members without `analytics_aggregate` consent are never recorded. Every
 * count leaves through `suppress()`, and ratios only from counts that are shown.
 */
export class InsightsService {
  private readonly eligibleCache = new Map<string, { ok: boolean; at: number }>();
  private readonly visitedToday = new Set<string>();
  private visitedDay = '';

  constructor(private readonly d: InsightsDeps) {}

  private async isEligible(userId: string) {
    const key = `${String(requireTenantId())}:${userId}`;
    const hit = this.eligibleCache.get(key);
    if (hit && Date.now() - hit.at < ELIGIBLE_TTL_MS) return hit.ok;
    const ok = await this.d.eligible(userId);
    this.eligibleCache.set(key, { ok, at: Date.now() });
    if (this.eligibleCache.size > 50_000) this.eligibleCache.clear();
    return ok;
  }

  /** The `track` callback services receive. Never throws: analytics never breaks a write. */
  track: Track = async (userId, name, props) => {
    try {
      if (!(PRODUCT_EVENTS as readonly string[]).includes(name)) return;
      const u = String(userId);
      if (!ID.test(u) || !(await this.isEligible(u))) return;
      const day = dayOf(new Date());
      if (name === 'visited') {
        if (this.visitedDay !== day) {
          this.visitedDay = day;
          this.visitedToday.clear();
        }
        const key = `${String(requireTenantId())}:${u}`;
        if (this.visitedToday.has(key)) return;
        this.visitedToday.add(key);
        await ProductEventModel.updateOne(
          { userId: new Types.ObjectId(u), day, name: 'visited' },
          { $setOnInsert: { props: {}, anonKey: null } },
          { upsert: true },
        );
        return;
      }
      await ProductEventModel.create({ day, userId: new Types.ObjectId(u), name, props: cleanProps(props) });
    } catch {
      /* analytics is best effort */
    }
  };

  /** Consent changed: withdrawn detaches the member's past events (kept as counts, not as them). */
  async onConsent(userId: string, granted: boolean) {
    this.eligibleCache.delete(`${String(requireTenantId())}:${userId}`);
    if (!granted) await this.detach(userId);
  }

  private async detach(userId: string) {
    await ProductEventModel.updateMany(
      { userId: new Types.ObjectId(userId) },
      { $set: { userId: null, anonKey: randomUUID() } },
    );
  }

  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    return ProductEventModel.find({ userId: new Types.ObjectId(userId) })
      .select('day name props -_id')
      .sort({ day: 1 })
      .limit(5000)
      .lean();
  }

  async eraseFor(userId: string) {
    await this.detach(userId);
  }

  // ── Retention ─────────────────────────────
  /** Events past 13 months become daily counts (no member in them), then are deleted. Idempotent. */
  async rollupExpired(now = new Date()) {
    const cutoff = dayOf(new Date(now.getTime() - PRODUCT_EVENT_RETENTION_DAYS * DAY));
    const days = ((await ProductEventModel.distinct('day', { day: { $lt: cutoff } })) as string[])
      .sort()
      .slice(0, 62);
    for (const day of days) {
      const rows = await ProductEventModel.aggregate<{ _id: string; count: number; members: string[] }>([
        { $match: { day } },
        {
          $group: {
            _id: '$name',
            count: { $sum: 1 },
            members: { $addToSet: { $ifNull: ['$userId', '$anonKey'] } },
          },
        },
      ]);
      for (const r of rows)
        await ProductEventDailyModel.updateOne(
          { day, name: r._id },
          { $setOnInsert: { count: r.count, members: r.members.length } },
          { upsert: true },
        );
      await ProductEventModel.deleteMany({ day });
    }
    return days.length;
  }

  // ── The college's metrics ─────────────────────────────
  async dashboard(now = new Date()): Promise<InsightsView> {
    const thisWeek = weekOf(now);
    const since = addDays(thisWeek, -7 * (INSIGHT_WEEKS - 1));
    const sinceDate = new Date(`${since}T00:00:00Z`);
    const rows = (await ProductEventModel.find({ day: { $gte: addDays(since, -7 * RETENTION_COHORTS) } })
      .select('userId anonKey name day props createdAt')
      .limit(500_000)
      .lean()) as unknown as Row[];
    const [roles, invited, replyHours, placement] = await Promise.all([
      this.d.roles(),
      this.d.invitedSince(sinceDate),
      this.d.replyHoursSince(sinceDate),
      this.d.placement(currentGradYear(now)),
    ]);
    const inWindow = rows.filter((r) => r.day >= since);
    const today = dayOf(now);

    // Activation: signed up in the window → verified → a meaningful action within 7 days.
    const signups = new Map<string, string>();
    for (const r of inWindow) if (r.name === 'signed_up' && !signups.has(who(r))) signups.set(who(r), r.day);
    const verified = new Set(rows.filter((r) => r.name === 'verified').map(who));
    const meaningful = new Map<string, string[]>();
    for (const r of rows)
      if ((MEANINGFUL_EVENTS as readonly string[]).includes(r.name))
        meaningful.set(who(r), [...(meaningful.get(who(r)) ?? []), r.day]);
    const mature = [...signups].filter(([, day]) => addDays(day, 7) <= today);
    const activated = mature.filter(([u, day]) =>
      (meaningful.get(u) ?? []).some((d) => d >= day && d < addDays(day, 7)),
    ).length;

    // Weekly actives by role: anyone with any event that week.
    const byWeek = new Map<string, Set<string>>();
    for (const r of inWindow) {
      const w = weekOf(new Date(`${r.day}T00:00:00Z`));
      byWeek.set(w, (byWeek.get(w) ?? new Set()).add(who(r)));
    }
    const roleOf = (u: string) => {
      const rs = roles.get(u) ?? [];
      if (rs.some((x) => x === 'FACULTY' || x === 'TPO' || x === 'COLLEGE_ADMIN')) return 'staff';
      return rs.includes('ALUMNI') ? 'alumni' : 'students';
    };
    const weeklyActive: WeeklyActiveRow[] = Array.from({ length: INSIGHT_WEEKS }, (_, i) => {
      const week = addDays(since, 7 * i);
      const members = [...(byWeek.get(week) ?? [])];
      const n = (k: string) => members.filter((u) => roleOf(u) === k).length;
      return {
        week,
        students: suppress(n('students')),
        alumni: suppress(n('alumni')),
        staff: suppress(n('staff')),
        total: suppress(members.length),
      };
    });

    // Retention: of each signup week's cohort, the share active 1…7 weeks later.
    const activeWeeks = new Map<string, Set<string>>();
    for (const r of rows) {
      const w = weekOf(new Date(`${r.day}T00:00:00Z`));
      activeWeeks.set(w, (activeWeeks.get(w) ?? new Set()).add(who(r)));
    }
    const cohortOf = new Map<string, string[]>();
    for (const r of rows)
      if (r.name === 'signed_up') {
        const w = weekOf(new Date(`${r.day}T00:00:00Z`));
        cohortOf.set(w, [...new Set([...(cohortOf.get(w) ?? []), who(r)])]);
      }
    const retention: RetentionCohort[] = Array.from({ length: RETENTION_COHORTS }, (_, i) => {
      const week = addDays(thisWeek, -7 * (RETENTION_COHORTS - 1 - i));
      const cohort = cohortOf.get(week) ?? [];
      return {
        week,
        size: suppress(cohort.length),
        retained: Array.from({ length: RETENTION_COHORTS - 1 }, (_, k) => {
          const later = addDays(week, 7 * (k + 1));
          if (later > thisWeek || cohort.length < SMALL_CELL) return null;
          const active = activeWeeks.get(later) ?? new Set();
          return Math.round((100 * cohort.filter((u) => active.has(u)).length) / cohort.length);
        }),
      };
    });

    // Mentorship: requests sent in the window, and those that led to a completed session.
    const sent = new Set(
      inWindow
        .filter((r) => r.name === 'request_sent')
        .flatMap((r) => (r.props?.requestId ? [r.props.requestId] : [])),
    );
    const completed = new Set(
      rows
        .filter((r) => r.name === 'session_completed')
        .flatMap((r) => (r.props?.requestId ? [r.props.requestId] : [])),
    );
    const converted = [...sent].filter((id) => completed.has(id)).length;
    const hours = [...replyHours].sort((a, b) => a - b);
    const mid = Math.floor(hours.length / 2);
    const medianReply =
      hours.length >= SMALL_CELL
        ? Math.round(
            (hours.length % 2
              ? (hours[mid] as number)
              : ((hours[mid - 1] as number) + (hours[mid] as number)) / 2) * 10,
          ) / 10
        : null;

    // Placements and study for the graduating batch and students active in the window.
    const studyQuestions = inWindow.filter((r) => r.name === 'study_question').length;
    const activeStudents = new Set(inWindow.map(who).filter((u) => roleOf(u) === 'students')).size;
    return {
      since,
      activation: {
        invited: suppress(invited),
        signedUp: suppress(signups.size),
        verified: suppress([...signups.keys()].filter((u) => verified.has(u)).length),
        matured: suppress(mature.length),
        activated: suppress(activated),
        activationPct: pct(activated, mature.length),
      },
      weeklyActive,
      retention,
      mentorship: {
        requests: suppress(sent.size),
        converted: suppress(converted),
        conversionPct: pct(converted, sent.size),
        medianReplyHours: medianReply,
      },
      placements: {
        gradYear: currentGradYear(now),
        finalYear: suppress(placement.finalYear),
        registered: suppress(placement.registered),
        registrationPct: pct(placement.registered, placement.finalYear),
        offersPer100: pct(placement.jobOffers, placement.finalYear),
        studyQuestions: suppress(studyQuestions),
        activeStudents: suppress(activeStudents),
        questionsPerActiveStudent: ratio(studyQuestions, activeStudents),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ── The platform's cross-college view ─────────────────────────────
  /**
   * Per-college aggregates for the platform console: one grouped pipeline over every college's
   * events through a named platform path. It returns counts per college only (member ids never
   * leave the database) and is audit-logged.
   */
  async platform(
    colleges: { id: Types.ObjectId; slug: string; name: string }[],
    actorId: string,
    meta: RequestMetaLite,
    now = new Date(),
  ): Promise<PlatformInsightsView> {
    const since = dayOf(new Date(now.getTime() - INSIGHT_WEEKS * WEEK));
    const d7 = dayOf(new Date(now.getTime() - 7 * DAY));
    const d28 = dayOf(new Date(now.getTime() - 28 * DAY));
    const member = { $ifNull: ['$userId', '$anonKey'] };
    const counted = (name: ProductEventName) => ({ $sum: { $cond: [{ $eq: ['$name', name] }, 1, 0] } });
    const rows = await withPlatformScope('insights:platform-aggregates', () =>
      ProductEventModel.aggregate<{
        _id: Types.ObjectId;
        a7: number;
        a28: number;
        signUps: number;
        requests: number;
        sessions: number;
        driveRegistrations: number;
        offersVerified: number;
        studyQuestions: number;
      }>([
        { $match: { tenantId: { $in: colleges.map((c) => c.id) }, day: { $gte: since } } },
        {
          $group: {
            _id: '$tenantId',
            a7: { $addToSet: { $cond: [{ $gte: ['$day', d7] }, member, '$$REMOVE'] } },
            a28: { $addToSet: { $cond: [{ $gte: ['$day', d28] }, member, '$$REMOVE'] } },
            signUps: counted('signed_up'),
            requests: counted('request_sent'),
            sessions: counted('session_completed'),
            driveRegistrations: counted('drive_registered'),
            offersVerified: counted('offer_verified'),
            studyQuestions: counted('study_question'),
          },
        },
        // Only sizes leave the pipeline.
        { $set: { a7: { $size: '$a7' }, a28: { $size: '$a28' } } },
      ]),
    );
    await audit.record(
      {
        action: 'platform.insights_viewed',
        actorId,
        targetType: 'platform',
        meta: { colleges: colleges.length, weeks: INSIGHT_WEEKS },
      },
      meta,
    );
    const byId = new Map(rows.map((r) => [String(r._id), r]));
    const zero = {
      a7: 0,
      a28: 0,
      signUps: 0,
      requests: 0,
      sessions: 0,
      driveRegistrations: 0,
      offersVerified: 0,
      studyQuestions: 0,
    };
    const row = (r: typeof zero) => ({
      active7d: suppress(r.a7),
      active28d: suppress(r.a28),
      signUps: suppress(r.signUps),
      requests: suppress(r.requests),
      sessions: suppress(r.sessions),
      driveRegistrations: suppress(r.driveRegistrations),
      offersVerified: suppress(r.offersVerified),
      studyQuestions: suppress(r.studyQuestions),
    });
    const sum = (k: keyof typeof zero) => rows.reduce((s, r) => s + r[k], 0);
    return {
      weeks: INSIGHT_WEEKS,
      colleges: colleges.map((c): PlatformInsightRow => ({
        tenantId: String(c.id),
        slug: c.slug,
        name: c.name,
        ...row(byId.get(String(c.id)) ?? zero),
      })),
      totals: row({
        a7: sum('a7'),
        a28: sum('a28'),
        signUps: sum('signUps'),
        requests: sum('requests'),
        sessions: sum('sessions'),
        driveRegistrations: sum('driveRegistrations'),
        offersVerified: sum('offersVerified'),
        studyQuestions: sum('studyQuestions'),
      }),
      generatedAt: new Date().toISOString(),
    };
  }
}
