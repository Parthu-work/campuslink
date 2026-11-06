/**
 * The moat data (prompt 2, G10): the Placement Graph, the Interview Experience Bank and
 * outcome-proven matching. Zod-free on purpose: screens that only need these values never load Zod
 * (bundle budget).
 */

/** How hard the interview felt, in the author's words. */
export const EXPERIENCE_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type ExperienceDifficulty = (typeof EXPERIENCE_DIFFICULTIES)[number];
/** What happened to the author in that process. */
export const EXPERIENCE_RESULTS = ['selected', 'not_selected', 'waiting'] as const;
export type ExperienceResult = (typeof EXPERIENCE_RESULTS)[number];
/** A write-up waits for the placement cell or faculty, then is published or sent back with a reason. */
export const EXPERIENCE_STATUSES = ['pending', 'published', 'rejected'] as const;
export type ExperienceStatus = (typeof EXPERIENCE_STATUSES)[number];
/** Why the author may write about this company: shown as a badge next to their write-up. */
export const EXPERIENCE_BASES = ['verified_offer', 'drive', 'alumni'] as const;
export type ExperienceBasis = (typeof EXPERIENCE_BASES)[number];

export const EXPERIENCE_ROUNDS_MAX = 8;
export const EXPERIENCE_QUESTIONS_MAX = 10;

/** Offer holders are asked to share their interview this long after the offer is verified. */
export const EXPERIENCE_PROMPT_DAYS = 7;

/** The graph is rebuilt once a day per college, from this hour (India time). */
export const GRAPH_RUN_HOUR_IST = 2;
/** Batches shown on a company page (newest first). */
export const GRAPH_YEARS_SHOWN = 5;

const IST_MS = 5.5 * 3600_000;
/** The India-time day a graph run belongs to (`20261106`): the job id carries it. */
export function graphDay(now = new Date()): string {
  return new Date(now.getTime() + IST_MS).toISOString().slice(0, 10).replaceAll('-', '');
}
/** Whether today's run is due (from GRAPH_RUN_HOUR_IST, India time). */
export function graphDue(now = new Date()): boolean {
  return new Date(now.getTime() + IST_MS).getUTCHours() >= GRAPH_RUN_HOUR_IST;
}

/**
 * Outcome-proven matching: a bounded, deterministic term in the Alumni Match score. A mentor gains
 * `perMentee` for each mentee like the viewer (same branch, or aiming at a company the viewer
 * targets) who reached an interview or an offer after a session with them (up to `menteeCap`), and
 * `perReferral` for each referral of theirs that led to an interview or offer (up to
 * `referralCap`); the two together never add more than `cap`. Fewer than `minEvidence` outcomes
 * add nothing, so one result never singles anybody out.
 */
export const OUTCOME_MATCH = {
  perMentee: 4,
  menteeCap: 12,
  perReferral: 3,
  referralCap: 6,
  cap: 15,
  minEvidence: 2,
} as const;

export interface OutcomeEvidence {
  /** Mentees like the viewer (same branch, or aiming at a company the viewer targets) who reached an interview or offer. */
  mentees: number;
  scope: 'branch' | 'target';
  /** The mentor's referrals that led to an interview or offer. */
  referrals: number;
}

/** The bounded match term for some evidence: 0 to OUTCOME_MATCH.cap points, deterministic. */
export function outcomePoints(e: OutcomeEvidence): { mentee: number; referral: number; total: number } {
  const m = OUTCOME_MATCH;
  const mentee = e.mentees >= m.minEvidence ? Math.min(m.menteeCap, e.mentees * m.perMentee) : 0;
  const referral = e.referrals >= m.minEvidence ? Math.min(m.referralCap, e.referrals * m.perReferral) : 0;
  return { mentee, referral, total: Math.min(m.cap, mentee + referral) };
}
