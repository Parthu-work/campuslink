import { z } from 'zod';
import { objectId } from './common.js';
import { BRANCHES, type Branch } from '../constants/people.js';
import type { CtcBand } from '../constants/placements.js';
import {
  EXAM_LEVELS,
  EXAMS,
  OUTCOME_KINDS,
  REPORT_IDS,
  type AccreditationReportId,
  type Exam,
  type ExamLevel,
  type OutcomeKind,
  type OutcomeSource,
  type OutcomeStatus,
  type ReportFramework,
} from '../constants/outcomes.js';
import type { Count } from './analytics.js';

/** Higher studies, exams and ventures, and accreditation reports (build B8). */
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const year = z.number().int().min(1990).max(2100);

export const higherStudyBody = z.strictObject({
  institution: text(2, 160),
  program: text(2, 120),
  country: text(2, 60).default('India'),
  admitYear: year,
  /** The exam the admission went through (GATE for an M.Tech, GRE for an MS abroad). */
  qualifyingExam: z.enum(EXAMS).nullable().default(null),
});
export const examBody = z
  .strictObject({
    exam: z.enum(EXAMS),
    /** The exam's own name when it is `OTHER`. */
    examName: text(0, 80).default(''),
    year,
    /** As the member reports it ("AIR under 2,000", "320+"); never a raw score sheet. */
    scoreBand: text(0, 60).default(''),
    /** Only for `OTHER`; known exams have a fixed level. */
    level: z.enum(EXAM_LEVELS).optional(),
  })
  .refine((b) => b.exam !== 'OTHER' || (b.examName.length >= 2 && !!b.level), {
    message: 'Name the exam and its level',
    path: ['examName'],
  });
export const ventureBody = z.strictObject({
  name: text(2, 120),
  /** Registered as a company, LLP or firm (not just an idea). */
  registered: z.boolean(),
  year,
});
export const outcomeKindParams = z.strictObject({ kind: z.enum(OUTCOME_KINDS) });
export const outcomeParams = z.strictObject({ kind: z.enum(OUTCOME_KINDS), id: objectId });
export const outcomeDecisionBody = z
  .strictObject({ decision: z.enum(['verify', 'reject']), reason: text(3, 300).optional() })
  .refine((b) => b.decision !== 'reject' || !!b.reason, { message: 'Give a reason', path: ['reason'] });
export const outcomesQueueQuery = z.strictObject({
  status: z.enum(['reported', 'verified', 'rejected']).default('reported'),
  cursor: objectId.optional(),
});

export type HigherStudyFields = z.output<typeof higherStudyBody>;
export type ExamFields = { exam: Exam; examName: string; year: number; scoreBand: string; level: ExamLevel };
export type VentureFields = z.output<typeof ventureBody>;
interface OutcomeBase {
  id: string;
  status: OutcomeStatus;
  source: OutcomeSource;
  /** Why the placement cell could not verify it (the member sees this). */
  reason: string | null;
  /** Placement cell views. */
  member?: {
    userId: string | null;
    name: string;
    rollNumber: string | null;
    branch: string | null;
    gradYear: number | null;
  };
  createdAt: string;
}
export type OutcomeView = OutcomeBase &
  (
    | ({ kind: 'higher_study' } & HigherStudyFields)
    | ({ kind: 'exam' } & ExamFields)
    | ({ kind: 'venture' } & VentureFields)
  );
export interface OutcomeImportResult {
  created: number;
  updated: number;
  /** Roll numbers that are not on the college's list (never guessed). */
  unknown: string[];
  errors: { row: number; message: string }[];
}
export type { OutcomeKind };

// ── Reports ─────────────────────────────
export const reportQuery = z.strictObject({
  branch: z.enum(BRANCHES).optional(),
  /** The graduating batch (2026 is the academic year 2025-26); three-year reports end with it. */
  gradYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export const reportExportQuery = z.strictObject({
  branch: z.enum(BRANCHES).optional(),
  gradYear: z.coerce.number().int().min(2000).max(2100).optional(),
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
});
export const reportParams = z.strictObject({ id: z.enum(REPORT_IDS) });

/** A count (suppressed below 5 on screen and in summaries), a number, text, or nothing. */
export type ReportCell = string | number | null;
export interface ReportColumn {
  key: string;
  /** English heading, used in downloads (the app translates `reports.col.<key>`). */
  label: string;
  kind: 'text' | 'count' | 'number' | 'percent' | 'band';
}
export interface ReportDefinitionView {
  id: AccreditationReportId;
  framework: ReportFramework;
  title: string;
  version: string;
  sourceNote: string;
  /** Not yet checked against the framework's current manual: shown with a warning. */
  needsReview: boolean;
  /** Whether the report spans three batches ending with the chosen one. */
  threeYears: boolean;
}
export interface ReportResultView extends ReportDefinitionView {
  params: { branch: Branch | null; gradYear: number; gradYears: number[] };
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, ReportCell> | null;
  /** Lines under the table: how a figure was worked out, what was left out and why. */
  notes: string[];
  generatedAt: string;
}
export interface ReportsDashboardView {
  gradYear: number;
  /** Final-year students on the college's list. */
  finalYear: Count;
  /** Students who registered for a drive or reported an offer. */
  seeking: Count;
  placed: Count;
  /** Placed out of seeking; null when either count is suppressed or zero. */
  placementPct: number | null;
  medianBand: CtcBand | null;
  higherStudies: Count;
  topRecruiters: { company: string; students: Count }[];
  trend: { gradYear: number; placementPct: number | null }[];
}
