/**
 * Placement outcomes beyond offers, and accreditation reports (build B8): vocabulary and report
 * ids. Zod-free on purpose: screens that only need these values never load Zod (bundle budget).
 */
export const OUTCOME_KINDS = ['higher_study', 'exam', 'venture'] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];
export const OUTCOME_STATUSES = ['reported', 'verified', 'rejected'] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];
export const OUTCOME_SOURCES = ['self', 'tpo', 'import'] as const;
export type OutcomeSource = (typeof OUTCOME_SOURCES)[number];

export const EXAMS = [
  'GATE',
  'CAT',
  'GRE',
  'GMAT',
  'IELTS',
  'TOEFL',
  'UPSC',
  'STATE_PSC',
  'NET',
  'OTHER',
] as const;
export type Exam = (typeof EXAMS)[number];
export const EXAM_LEVELS = ['state', 'national', 'international'] as const;
export type ExamLevel = (typeof EXAM_LEVELS)[number];
/** The level NAAC asks about ("state, national or international"); `OTHER` takes the member's. */
export const EXAM_LEVEL: Record<Exclude<Exam, 'OTHER'>, ExamLevel> = {
  GATE: 'national',
  CAT: 'national',
  UPSC: 'national',
  NET: 'national',
  STATE_PSC: 'state',
  GRE: 'international',
  GMAT: 'international',
  IELTS: 'international',
  TOEFL: 'international',
};

export const REPORT_FRAMEWORKS = ['NBA', 'NAAC', 'NIRF', 'internal'] as const;
export type ReportFramework = (typeof REPORT_FRAMEWORKS)[number];
export const REPORT_IDS = [
  'nba-sar-placement',
  'naac-placement',
  'naac-higher-education',
  'naac-exams',
  'naac-alumni-engagement',
  'nirf-median-salary',
  'internal-placement',
] as const;
export type AccreditationReportId = (typeof REPORT_IDS)[number];

/** "2025-26" for students graduating in 2026 (the academic year runs June to May). */
export const gradYearLabel = (gradYear: number) =>
  `${gradYear - 1}-${String(gradYear % 100).padStart(2, '0')}`;

/** The batch that graduated most recently, or graduates this academic year (June onwards counts as next). */
export const currentGradYear = (now = new Date()) =>
  now.getUTCMonth() >= 5 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
