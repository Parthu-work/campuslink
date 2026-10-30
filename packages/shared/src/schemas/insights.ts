import type { Count } from './analytics.js';

/** Product analytics views (build B9): counts through `suppress()`, ratios only from shown counts. */
export interface ActivationView {
  /** Invite links sent in the window (B4). */
  invited: Count;
  signedUp: Count;
  /** Of those who signed up, verified (at any time since). */
  verified: Count;
  /** Of sign-ups at least 7 days old, a meaningful action within 7 days. */
  matured: Count;
  activated: Count;
  activationPct: number | null;
}
export interface WeeklyActiveRow {
  /** Monday of the week (UTC), YYYY-MM-DD. */
  week: string;
  students: Count;
  alumni: Count;
  staff: Count;
  total: Count;
}
export interface RetentionCohort {
  week: string;
  size: Count;
  /** Percent of the cohort active 1, 2, … weeks after signing up (null: not shown or not yet). */
  retained: (number | null)[];
}
export interface MentorshipInsight {
  requests: Count;
  /** Requests that led to a completed session. */
  converted: Count;
  conversionPct: number | null;
  medianReplyHours: number | null;
}
export interface PlacementInsight {
  gradYear: number;
  finalYear: Count;
  /** Final-year students who registered for at least one drive. */
  registered: Count;
  registrationPct: number | null;
  offersPer100: number | null;
  studyQuestions: Count;
  activeStudents: Count;
  questionsPerActiveStudent: number | null;
}
export interface InsightsView {
  since: string;
  activation: ActivationView;
  weeklyActive: WeeklyActiveRow[];
  retention: RetentionCohort[];
  mentorship: MentorshipInsight;
  placements: PlacementInsight;
  generatedAt: string;
}
/** One college in the platform's cross-college view: per-college aggregates only. */
export interface PlatformInsightRow {
  tenantId: string;
  slug: string;
  name: string;
  active7d: Count;
  active28d: Count;
  signUps: Count;
  requests: Count;
  sessions: Count;
  driveRegistrations: Count;
  offersVerified: Count;
  studyQuestions: Count;
}
export interface PlatformInsightsView {
  weeks: number;
  colleges: PlatformInsightRow[];
  totals: Omit<PlatformInsightRow, 'tenantId' | 'slug' | 'name'>;
  generatedAt: string;
}
