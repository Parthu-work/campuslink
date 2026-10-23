import type { z } from 'zod';
import {
  academicYear,
  suppress,
  type AnalyticsView,
  type Branch,
  type EngagementRow,
  type MonthPoint,
  type ReportId,
  type analyticsQuery,
} from '@campuslink/shared';
import { requireTenantId } from '../../lib/context.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import type { AuthState } from '../../types.js';

type Since = (since: Date) => Promise<Map<string, number>>;
/** What each module exposes for analytics (aggregates and ids only, never content). */
export interface AnalyticsSources {
  cohorts(): Promise<
    { userId: string; roles: string[]; verified: boolean; branch: Branch | null; gradYear: number | null }[]
  >;
  pendingVerification(): Promise<number>;
  activeSince(since: Date): Promise<number>;
  postsByAuthor: Since;
  answersByAuthor: Since;
  stepsByUser: Since;
  sessions(
    since: Date,
  ): Promise<{ sessions: { mentorId: string; menteeId: string; at: Date }[]; averageRating: number | null }>;
  referrals(since: Date): Promise<{
    requested: number;
    referred: number;
    declined: number;
    expired: number;
    pending: number;
    referrerIds: string[];
  }>;
  jobs(since: Date): Promise<{ posted: Date[]; open: number }>;
  events(since: Date): Promise<{ held: number; rsvps: number; attended: number }>;
  eventHosts(since: Date): Promise<string[]>;
}

const DAY = 86_400_000;
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const CACHE_MS = 5 * 60_000;

/** CSV cell: quoted, and never starting with a formula character (spreadsheet injection). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/**
 * College analytics from aggregates only. Counts under 5 are suppressed so nobody can be singled
 * out in a small branch or batch. Cached per college and query for 5 minutes.
 */
export class AnalyticsService {
  private readonly cache = new Map<string, { at: number; value: AnalyticsView }>();
  constructor(private readonly s: AnalyticsSources) {}

  private months(n: number, now: Date) {
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--)
      out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
    return out;
  }

  private series(keys: string[], dates: Date[]): MonthPoint[] {
    const counts = new Map<string, number>();
    for (const d of dates) counts.set(monthKey(d), (counts.get(monthKey(d)) ?? 0) + 1);
    return keys.map((month) => ({ month, value: suppress(counts.get(month) ?? 0) }));
  }

  /** Members active in the last 7 and 30 days, suppressed (Admin › Overview). */
  async activity() {
    const now = Date.now();
    const [last7, last30] = await Promise.all([
      this.s.activeSince(new Date(now - 7 * DAY)),
      this.s.activeSince(new Date(now - 30 * DAY)),
    ]);
    return { last7: suppress(last7), last30: suppress(last30) };
  }

  async dashboard(viewer: AuthState, q: z.output<typeof analyticsQuery>): Promise<AnalyticsView> {
    const scope = viewer.permissions.has('analytics:tenant') ? 'college' : 'cohort';
    const key = `${String(requireTenantId())}|${scope}|${q.months}|${q.branch ?? ''}|${q.gradYear ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await this.compute(q, scope);
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }

  private async compute(
    q: z.output<typeof analyticsQuery>,
    scope: 'college' | 'cohort',
  ): Promise<AnalyticsView> {
    const now = new Date();
    const keys = this.months(q.months, now);
    const since = new Date(`${keys[0]}-01T00:00:00Z`);
    const since90 = new Date(now.getTime() - 90 * DAY);
    const allMembers = await this.s.cohorts();
    const inCohort = (m: { branch: Branch | null; gradYear: number | null }) =>
      (!q.branch || m.branch === q.branch) && (!q.gradYear || m.gradYear === q.gradYear);
    const members = allMembers.filter(inCohort);
    const ids = new Set(members.map((m) => m.userId));
    const [posts, answers, steps, sessions, referrals, jobs, events, hosts, active7, active30, pending] =
      await Promise.all([
        this.s.postsByAuthor(since),
        this.s.answersByAuthor(since),
        this.s.stepsByUser(since),
        this.s.sessions(since),
        this.s.referrals(since90 < since ? since90 : since),
        this.s.jobs(since),
        this.s.events(since),
        this.s.eventHosts(since90),
        scope === 'college' ? this.s.activeSince(new Date(now.getTime() - 7 * DAY)) : Promise.resolve(0),
        scope === 'college' ? this.s.activeSince(new Date(now.getTime() - 30 * DAY)) : Promise.resolve(0),
        scope === 'college' ? this.s.pendingVerification() : Promise.resolve(0),
      ]);

    // Engagement by branch and batch (students and alumni).
    const groups = new Map<string, EngagementRow & { raw: number[] }>();
    const sessionsByMentee = new Map<string, number>();
    for (const s of sessions.sessions)
      sessionsByMentee.set(s.menteeId, (sessionsByMentee.get(s.menteeId) ?? 0) + 1);
    for (const m of members) {
      if (!m.roles.includes('STUDENT') && !m.roles.includes('ALUMNI')) continue;
      const k = `${m.branch ?? ''}|${m.gradYear ?? ''}`;
      const g =
        groups.get(k) ??
        ({
          branch: m.branch,
          gradYear: m.gradYear,
          members: 0,
          posts: 0,
          answers: 0,
          sessions: 0,
          roadmapSteps: 0,
          raw: [0, 0, 0, 0, 0],
        } as EngagementRow & { raw: number[] });
      const add = [
        1,
        posts.get(m.userId) ?? 0,
        answers.get(m.userId) ?? 0,
        sessionsByMentee.get(m.userId) ?? 0,
        steps.get(m.userId) ?? 0,
      ];
      g.raw = g.raw.map((v, i) => v + (add[i] ?? 0));
      groups.set(k, g);
    }
    const engagement = [...groups.values()]
      .sort(
        (a, b) => (a.branch ?? '~').localeCompare(b.branch ?? '~') || (b.gradYear ?? 0) - (a.gradYear ?? 0),
      )
      .map(({ raw, ...g }) => ({
        ...g,
        members: suppress(raw[0] ?? 0),
        posts: suppress(raw[1] ?? 0),
        answers: suppress(raw[2] ?? 0),
        sessions: suppress(raw[3] ?? 0),
        roadmapSteps: suppress(raw[4] ?? 0),
      }));

    // Alumni participation: verified alumni who mentored, referred, answered or hosted (90 days).
    const alumni = members.filter((m) => m.verified && m.roles.includes('ALUMNI'));
    const activeAlumni = new Set<string>();
    for (const s of sessions.sessions) if (s.at >= since90) activeAlumni.add(s.mentorId);
    for (const id of referrals.referrerIds) activeAlumni.add(id);
    for (const id of hosts) activeAlumni.add(id);
    const answered = await this.s.answersByAuthor(since90);
    for (const id of answered.keys()) activeAlumni.add(id);
    const participating = alumni.filter((a) => activeAlumni.has(a.userId)).length;

    const cohortSessions = sessions.sessions.filter((s) => ids.has(s.menteeId) || ids.has(s.mentorId));
    const count = (pred: (m: (typeof members)[number]) => boolean) => suppress(members.filter(pred).length);
    return {
      generatedAt: now.toISOString(),
      academicYear: academicYear(now),
      scope,
      members: {
        students: count((m) => m.roles.includes('STUDENT')),
        alumni: count((m) => m.roles.includes('ALUMNI')),
        staff: count((m) => m.roles.some((r) => r === 'FACULTY' || r === 'TPO' || r === 'COLLEGE_ADMIN')),
        verified: count((m) => m.verified),
        pendingVerification: suppress(pending),
      },
      active: { last7: suppress(active7), last30: suppress(active30) },
      sessions: {
        completed: this.series(
          keys,
          cohortSessions.map((s) => s.at),
        ),
        total: suppress(cohortSessions.length),
        averageRating: scope === 'college' ? sessions.averageRating : null,
      },
      referrals: {
        requested: suppress(referrals.requested),
        referred: suppress(referrals.referred),
        declined: suppress(referrals.declined),
        expired: suppress(referrals.expired),
        pending: suppress(referrals.pending),
      },
      jobs: { posted: this.series(keys, jobs.posted), open: suppress(jobs.open) },
      events: {
        held: suppress(events.held),
        rsvps: suppress(events.rsvps),
        attended: suppress(events.attended),
      },
      alumniParticipation: {
        active: suppress(participating),
        total: suppress(alumni.length),
        rate: alumni.length >= 5 ? Math.round((participating / alumni.length) * 100) : null,
      },
      engagement,
    };
  }

  /** CSV export of one report (audited). */
  async exportCsv(
    viewer: AuthState,
    q: z.output<typeof analyticsQuery>,
    report: ReportId,
    meta: RequestMetaLite,
  ) {
    const v = await this.dashboard(viewer, q);
    let rows: unknown[][];
    switch (report) {
      case 'engagement':
        rows = [
          ['Branch', 'Batch', 'Members', 'Posts', 'Answers', 'Mentorship sessions', 'Roadmap steps'],
          ...v.engagement.map((e) => [
            e.branch ?? 'Not set',
            e.gradYear ?? 'Not set',
            e.members,
            e.posts,
            e.answers,
            e.sessions,
            e.roadmapSteps,
          ]),
        ];
        break;
      case 'mentorship':
        rows = [['Month', 'Completed sessions'], ...v.sessions.completed.map((p) => [p.month, p.value])];
        break;
      case 'referrals':
        rows = [['Outcome', 'Requests'], ...Object.entries(v.referrals)];
        break;
      case 'events':
        rows = [
          ['Measure', 'Count'],
          ['Events held', v.events.held],
          ['RSVPs', v.events.rsvps],
          ['Attended', v.events.attended],
        ];
        break;
      default:
        rows = [
          ['Measure', 'Value'],
          ['Academic year', v.academicYear],
          ['Students', v.members.students],
          ['Alumni', v.members.alumni],
          ['Staff', v.members.staff],
          ['Verified members', v.members.verified],
          ['Active in the last 7 days', v.active.last7],
          ['Active in the last 30 days', v.active.last30],
          ['Mentorship sessions completed', v.sessions.total],
          ['Referral requests', v.referrals.requested],
          ['Referred', v.referrals.referred],
          ['Open jobs', v.jobs.open],
          ['Events held', v.events.held],
          ['Alumni participating (90 days)', v.alumniParticipation.active],
          ['Alumni participation rate (%)', v.alumniParticipation.rate ?? 'Not enough data'],
        ];
    }
    await audit.record(
      {
        action: 'report.exported',
        actorId: viewer.userId,
        targetType: 'report',
        targetId: report,
        meta: { months: q.months, branch: q.branch ?? null, gradYear: q.gradYear ?? null },
      },
      meta,
    );
    return {
      csv: toCsv([
        [`Generated ${v.generatedAt}`, `Academic year ${v.academicYear}`, 'Counts under 5 are shown as <5'],
        ...rows,
      ]),
      filename: `${report}-${v.generatedAt.slice(0, 10)}.csv`,
    };
  }
}
