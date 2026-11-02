import type {
  AccreditationReportId,
  Branch,
  Count,
  CtcBand,
  ReportCell,
  ReportColumn,
  ReportFramework,
} from '@campuslink/shared';

/** One verified offer as reports see it (exact CTC is null once anonymised). */
export interface OfferRow {
  /** The member, or the random key an erased member's records share: counts people once. */
  subject: string;
  userId: string | null;
  branch: string | null;
  gradYear: number | null;
  companyKey: string;
  companyName: string;
  role: string;
  ctcLpa: number | null;
  ctcBand: CtcBand;
  type: string;
  source: string;
}
export type OutcomeRow = Record<string, unknown> & {
  subject: string;
  userId: string | null;
  branch: string | null;
  gradYear: number | null;
};

/**
 * What report definitions read (B8). Each method returns verified records or counts from the
 * module that owns them (through its service); definitions aggregate and suppress.
 */
export interface ReportData {
  /** Students on the college's list per branch and batch (the final-year count N). */
  roster(gradYears: number[]): Promise<{ branch: string | null; gradYear: number; n: number }[]>;
  offers(gradYears: number[]): Promise<OfferRow[]>;
  /** People who registered for a drive (not withdrawn), per branch and batch. */
  seekers(
    gradYears: number[],
  ): Promise<{ subject: string; branch: string | null; gradYear: number | null }[]>;
  higherStudies(gradYears: number[]): Promise<OutcomeRow[]>;
  /** Exams qualified in these calendar years. */
  exams(years: number[]): Promise<OutcomeRow[]>;
  ventures(gradYears: number[]): Promise<OutcomeRow[]>;
  /** Names and roll numbers, for evidence workbooks only. */
  people(userIds: string[]): Promise<Map<string, { name: string; rollNumber: string | null }>>;
  /** Alumni participation between two dates (events hosted, sessions, referrals). */
  alumniEngagement(
    from: Date,
    to: Date,
  ): Promise<{
    events: { title: string; kind: string; startsAt: Date; hostId: string }[];
    sessions: { mentorId: string }[];
    referrals: { referrerId: string }[];
  }>;
}

export interface ReportParams {
  branch: Branch | null;
  gradYear: number;
  /** The batches covered: the chosen one, or the three ending with it (oldest first). */
  gradYears: number[];
}

/** Counts are suppressed under 5 on screen and in summaries; the evidence workbook is exact. */
export type Counter = (n: number) => Count | number;

export interface ComputedReport {
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, ReportCell> | null;
  notes: string[];
}
export interface EvidenceTable {
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
}

export interface ReportDefinition {
  id: AccreditationReportId;
  framework: ReportFramework;
  title: string;
  version: string;
  sourceNote: string;
  needsReview: boolean;
  threeYears: boolean;
  compute(data: ReportData, p: ReportParams, count: Counter): Promise<ComputedReport>;
  evidence(data: ReportData, p: ReportParams): Promise<EvidenceTable>;
}
