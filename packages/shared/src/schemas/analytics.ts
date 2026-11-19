import { z } from 'zod';
import { BRANCHES, type Branch } from '../constants/people.js';

/** Counts below this are shown as "<5" so nobody is identifiable in a small group. */
export const SMALL_CELL = 5;
export type Count = number | '<5';
export const suppress = (n: number): Count => (n > 0 && n < SMALL_CELL ? '<5' : n);

/**
 * A headline number with the same measure for the period before (prompt 3, U9c). `previous` is
 * null when there is no earlier figure (a new college, a board not yet a week old).
 */
export interface Kpi {
  value: Count;
  previous: Count | null;
}
/**
 * The change beside a headline number: only when both figures are shown, so a change never
 * reveals a count under 5. Null otherwise.
 */
export const kpiChange = (k: { value: Count | null; previous: Count | null }): number | null =>
  typeof k.value === 'number' && typeof k.previous === 'number' ? k.value - k.previous : null;
/** Both figures, suppressed: the headline number and the one before it. */
export const kpi = (value: number, previous: number | null): Kpi => ({
  value: suppress(value),
  previous: previous === null ? null : suppress(previous),
});

export const analyticsQuery = z.strictObject({
  /** Months back from the current month (inclusive), for monthly series. */
  months: z.coerce.number().int().min(1).max(24).default(6),
  branch: z.enum(BRANCHES).optional(),
  gradYear: z.coerce.number().int().min(1950).max(2100).optional(),
});
export const REPORTS = ['summary', 'engagement', 'mentorship', 'referrals', 'events'] as const;
export type ReportId = (typeof REPORTS)[number];
export const exportQuery = analyticsQuery.extend({ report: z.enum(REPORTS) }).strict();

export interface MonthPoint {
  month: string; // YYYY-MM
  value: Count;
}
export interface EngagementRow {
  branch: Branch | null;
  gradYear: number | null;
  members: Count;
  posts: Count;
  answers: Count;
  sessions: Count;
  roadmapSteps: Count;
}
export interface AnalyticsView {
  generatedAt: string;
  /** Academic year label (June–May) for reports, e.g. "2026-27". */
  academicYear: string;
  members: { students: Count; alumni: Count; staff: Count; verified: Count; pendingVerification: Count };
  active: { last7: Count; last30: Count };
  sessions: { completed: MonthPoint[]; total: Count; averageRating: number | null };
  referrals: { requested: Count; referred: Count; declined: Count; expired: Count; pending: Count };
  jobs: { posted: MonthPoint[]; open: Count };
  events: { held: Count; rsvps: Count; attended: Count };
  alumniParticipation: { active: Count; total: Count; rate: number | null };
  engagement: EngagementRow[];
  scope: 'college' | 'cohort';
  /**
   * The four headline numbers for the period, each with the same length of time just before it
   * (prompt 3, U9c): sessions completed, students referred, jobs posted, events held.
   */
  kpis: { sessions: Kpi; referred: Kpi; jobsPosted: Kpi; eventsHeld: Kpi };
}

/** Academic year (June to May), e.g. 2026-10-16 → "2026-27". */
export function academicYear(d: Date): string {
  const y = d.getUTCMonth() >= 5 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
