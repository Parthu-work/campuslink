/**
 * Alumni engagement (prompt 2, G6, docs/specs/alumni.md): micro-asks, recognition, giving, LinkedIn
 * import and batch pages. Zod-free: the alumni screens read these without loading Zod.
 */

/** Small, specific asks an alumnus can do in minutes. */
export const MICRO_ASK_KINDS = [
  'review_resume',
  'answer_question',
  'quick_intro',
  'feedback_on_project',
] as const;
export type MicroAskKind = (typeof MICRO_ASK_KINDS)[number];

/**
 * `routing`: looking for an alumnus. `assigned`: waiting for their reply. `accepted`: they said yes.
 * `done`: they did it. `unmatched`: nobody suitable was free. `cancelled`: the asker withdrew it.
 */
export const MICRO_ASK_STATUSES = [
  'routing',
  'assigned',
  'accepted',
  'done',
  'unmatched',
  'cancelled',
] as const;
export type MicroAskStatus = (typeof MICRO_ASK_STATUSES)[number];

/** An alumnus receives at most this many micro-asks in a rolling week. */
export const MICRO_ASKS_PER_WEEK = 2;
/** An asker may have this many asks open at once. */
export const MICRO_ASKS_OPEN_MAX = 3;
/** An assigned alumnus has this long to reply before the ask moves on. */
export const MICRO_ASK_REPLY_HOURS = 72;
/** After this many alumni (declined or silent), the ask is unmatched. */
export const MICRO_ASK_MAX_TRIES = 3;
export const MICRO_ASK_NOTE_MAX = 500;

/** Office hours repeat weekly until a date at most this far ahead. */
export const OFFICE_HOURS_MAX_WEEKS = 26;

/** Academic years run June to May: "2025-26" covers 1 June 2025 to 31 May 2026. */
export const academicYearOf = (d: Date): string => {
  const y = d.getUTCMonth() >= 5 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};
export const academicYearRange = (ay: string): { from: Date; to: Date } => {
  const y = Number(ay.slice(0, 4));
  return { from: new Date(Date.UTC(y, 5, 1)), to: new Date(Date.UTC(y + 1, 5, 1)) };
};
export const ACADEMIC_YEAR_PATTERN = /^\d{4}-\d{2}$/;

export const CERTIFICATE_STATUSES = ['rendering', 'issued', 'revoked'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export const ALUMNI_OF_MONTH_STATUSES = ['proposed', 'published', 'declined'] as const;
export type AlumniOfMonthStatus = (typeof ALUMNI_OF_MONTH_STATUSES)[number];

/** What a fund or pledge is for. */
export const PLEDGE_PURPOSES = ['scholarship', 'lab', 'event', 'general'] as const;
export type PledgePurpose = (typeof PLEDGE_PURPOSES)[number];
/**
 * `pledged`: promised. `paid`: the alumnus says they paid the college (with a reference).
 * `received`: the college recorded the money (a receipt number is given). `cancelled`.
 */
export const PLEDGE_STATUSES = ['pledged', 'paid', 'received', 'cancelled'] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];
export const FUND_STATUSES = ['open', 'closed'] as const;
/** Amounts are whole rupees in the UI and whole paise in the API (₹1 to ₹1 crore a pledge). */
export const PLEDGE_MIN_PAISE = 100;
export const PLEDGE_MAX_PAISE = 1_000_000_000;

/** LinkedIn's data export: the files we read (anything else in the archive is ignored). */
export const LINKEDIN_FILES = ['Positions.csv', 'Education.csv', 'Skills.csv'] as const;
export const LINKEDIN_MAX_BYTES = 10 * 1024 * 1024;
