/**
 * Placement readiness (prompt 2, G5, docs/specs/readiness.md): one honest number per student, the
 * transparent sum of weighted components, each with its points and its next action. Zod-free on
 * purpose: the student view and the board read these without loading Zod (bundle budget).
 */

/** The components, in the order the student view lists them. */
export const READINESS_COMPONENTS = [
  'resume',
  'interviews',
  'practice',
  'roadmap',
  'mentorship',
  'eligibility',
] as const;
export type ReadinessComponentId = (typeof READINESS_COMPONENTS)[number];

export type ReadinessWeights = Record<ReadinessComponentId, number>;
/** Weights out of 100 until the college changes them (Admin › Readiness). */
export const DEFAULT_READINESS_WEIGHTS: Readonly<ReadinessWeights> = {
  resume: 25,
  interviews: 20,
  practice: 15,
  roadmap: 15,
  mentorship: 10,
  eligibility: 15,
};
/** A single weight is 0 (off) to this. Weights need not sum to 100: they are scaled to it. */
export const READINESS_WEIGHT_MAX = 50;

/** Below this score, a student whose next drive closes soon is on the "needs help" list. */
export const DEFAULT_READINESS_THRESHOLD = 50;
/** "Closes soon": a drive's registration closes within this many days. */
export const DEFAULT_READINESS_CLOSING_DAYS = 7;
export const READINESS_CLOSING_DAYS_MAX = 30;

/** Score bands of the board's distribution: lower bounds, each 20 wide (the last is 80 to 100). */
export const READINESS_BANDS = [0, 20, 40, 60, 80] as const;
export const bandOf = (score: number) => Math.min(READINESS_BANDS.length - 1, Math.floor(score / 20));

/** A student is nudged at most once in this many days, whoever sends it (plus WhatsApp's own caps). */
export const READINESS_NUDGE_COOLDOWN_DAYS = 7;
/** At most this many students in one bulk nudge. */
export const READINESS_NUDGE_BATCH_MAX = 200;

/** Mock interviews: sessions in this window count towards practice done. */
export const READINESS_MOCK_WINDOW_DAYS = 90;
/** Mock interviews: this many completed in the window earn the full practice share. */
export const READINESS_MOCKS_TARGET = 3;
/** Mentorship: completed sessions as a mentee in the last year; this many earn full points. */
export const READINESS_SESSIONS_TARGET = 2;
/** Eligibility headroom: the college's own drives over this many days set the typical cut-offs. */
export const READINESS_CUTOFF_WINDOW_DAYS = 730;

/** What a component suggests next. The web turns each into words and a link. */
export const READINESS_ACTIONS = [
  'build_resume',
  'check_resume',
  'fix_resume_issues',
  'add_keywords',
  'check_against_role',
  'do_mock',
  'improve_answers',
  'do_practice',
  'pick_roadmap',
  'roadmap_steps',
  'book_session',
  'add_academics',
  'raise_cgpa',
  'clear_backlogs',
] as const;
export type ReadinessActionId = (typeof READINESS_ACTIONS)[number];
