/**
 * Placement drives, registrations and offers (build B7): vocabulary, bands and limits.
 * Zod-free on purpose: screens that only need these values never load Zod (bundle budget).
 */
export const DRIVE_MODES = ['on_campus', 'off_campus', 'pool', 'virtual'] as const;
export type DriveMode = (typeof DRIVE_MODES)[number];
export const DRIVE_STATUSES = ['draft', 'open', 'closed', 'in_progress', 'completed', 'cancelled'] as const;
export type DriveStatus = (typeof DRIVE_STATUSES)[number];
export const DRIVE_ROLE_TYPES = ['full_time', 'internship', 'ppo'] as const;
export type DriveRoleType = (typeof DRIVE_ROLE_TYPES)[number];
export const ROUND_KINDS = ['aptitude', 'coding', 'technical', 'hr', 'group_discussion', 'other'] as const;
export type RoundKind = (typeof ROUND_KINDS)[number];
export const ROUND_RESULTS = ['pending', 'cleared', 'not_cleared', 'absent'] as const;
export type RoundResult = (typeof ROUND_RESULTS)[number];
export const QUESTION_KINDS = ['text', 'choice', 'file'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const REGISTRATION_STATUSES = ['registered', 'withdrawn', 'tpo_override'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export const FINAL_RESULTS = ['in_process', 'selected', 'not_selected', 'withdrawn'] as const;
export type FinalResult = (typeof FINAL_RESULTS)[number];

export const OFFER_SOURCES = ['drive', 'off_campus', 'ppo', 'internship_conversion'] as const;
export type OfferSource = (typeof OFFER_SOURCES)[number];
export const OFFER_STATUSES = ['reported', 'verified', 'rejected', 'declined_by_student'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export const ACADEMIC_SOURCES = ['import', 'tpo', 'self'] as const;
export type AcademicSource = (typeof ACADEMIC_SOURCES)[number];

/**
 * CTC bands in lakh per annum. Other students only ever see bands (and suppressed counts); the
 * exact figure is for the member and the placement cell.
 */
export const CTC_BANDS = ['under_3', '3_5', '5_8', '8_12', '12_20', '20_plus'] as const;
export type CtcBand = (typeof CTC_BANDS)[number];
export function ctcBand(lpa: number): CtcBand {
  if (lpa < 3) return 'under_3';
  if (lpa < 5) return '3_5';
  if (lpa < 8) return '5_8';
  if (lpa < 12) return '8_12';
  if (lpa < 20) return '12_20';
  return '20_plus';
}

/** Drive reminders go out this long before registration closes (critical on WhatsApp). */
export const DRIVE_REMINDER_HOURS = 24;
/** The overview counts drives whose registration closes within this window. */
export const DRIVE_CLOSING_SOON_HOURS = 48;
/** Offer proof files are kept this long after the offer is verified. */
export const OFFER_PROOF_RETENTION_DAYS = 30;

/** Columns a placement cell may export for a company (it ticks the ones it needs). */
export const EXPORT_COLUMNS = [
  'rollNumber',
  'name',
  'branch',
  'gradYear',
  'email',
  'phone',
  'cgpa',
  'activeBacklogs',
  'historyBacklogs',
  'tenthPct',
  'twelfthPct',
  'diplomaPct',
  'answers',
  'status',
  'final',
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

/** Fields an `academics` import maps (keyed by roll number). */
export const ACADEMIC_IMPORT_FIELDS = [
  'rollNumber',
  'cgpa',
  'activeBacklogs',
  'historyBacklogs',
  'tenthPct',
  'twelfthPct',
  'diplomaPct',
] as const;
export type AcademicImportField = (typeof ACADEMIC_IMPORT_FIELDS)[number];

/**
 * Students in their last two years get Placements as a main tab. Graduation is taken as June of
 * the graduation year.
 */
export function inFinalYears(gradYear: number | null | undefined, now = new Date()): boolean {
  if (!gradYear) return false;
  const monthsLeft = gradYear * 12 + 5 - (now.getUTCFullYear() * 12 + now.getUTCMonth());
  return monthsLeft >= -6 && monthsLeft <= 24;
}
