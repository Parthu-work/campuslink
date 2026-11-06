/**
 * The network (prompt 2, G12, ADR 0014): cross-college alumni discovery, the recruiter portal and
 * verified credentials. Zod-free: the web reads these on screens that do not load Zod.
 * Every number here is a claim in ADR 0014 and is tested at its edge.
 */

/** The terms a college accepts when it turns a network switch on (bump when they change). */
export const NETWORK_TERMS_VERSION = 1;
/** The college's three switches (`Tenant.network`), all off by default. */
export const NETWORK_SWITCHES = ['alumniDiscovery', 'employerAccess', 'credentials'] as const;
export type NetworkSwitch = (typeof NETWORK_SWITCHES)[number];

/**
 * The closed list of cross-tenant paths (ADR 0014 §5). `networkScope`/`networkInTenant` refuse any
 * other `network:` reason, and a test checks each is used and nothing else is.
 */
export const NETWORK_PATHS = [
  'network:alumni-search',
  'network:alumni-card',
  'network:intro-send',
  'network:intro-reply',
  'network:intro-expire',
  'network:intro-report',
  'network:pool-size',
  'network:posting-offer',
  'network:posting-decision',
  'network:posting-withdraw',
  'network:candidates',
  'network:candidate-resume',
  'network:candidate-readiness',
  'network:shortlist',
  'network:hire-billing',
  'network:employer-review',
  'network:revenue-statement',
] as const;
export type NetworkPath = (typeof NETWORK_PATHS)[number];

/** The reconcile cycle: every projection matches its sources again within this many minutes. */
export const NETWORK_RECONCILE_MINUTES = 15;

// ── Alumni discovery and intros ─────────────────────────────

export const NETWORK_INTROS_PER_WEEK = 3;
export const NETWORK_INTRO_PENDING_MAX = 3;
export const NETWORK_INTRO_TTL_DAYS = 7;
/** After a decline, the same pair waits this long before asking again. */
export const NETWORK_INTRO_REPEAT_DAYS = 30;
export const NETWORK_INTRO_NOTE_MAX = 300;
export const NETWORK_INTROS_RECEIVED_DEFAULT = 2;
export const NETWORK_INTROS_RECEIVED_MAX = 5;
/** Reports from this many different alumni pause a requester's network access. */
export const NETWORK_REPORTS_TO_PAUSE = 2;
export const NETWORK_SEARCH_PAGE = 20;
export const NETWORK_SKILLS_MAX = 10;
export const INTRO_GOALS = [
  'career_advice',
  'interview_prep',
  'resume_feedback',
  'company_insight',
  'higher_studies',
] as const;
export type IntroGoal = (typeof INTRO_GOALS)[number];
export const INTRO_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'withdrawn'] as const;
export type IntroStatus = (typeof INTRO_STATUSES)[number];
export const INTRO_DECLINE_REASONS = ['busy', 'not_my_area', 'not_now'] as const;
export type IntroDeclineReason = (typeof INTRO_DECLINE_REASONS)[number];
/** What an alumnus may hand over when accepting (one student, stored encrypted). */
export const INTRO_SHARE = ['linkedin', 'email'] as const;
export type IntroShare = (typeof INTRO_SHARE)[number];
export const NAME_STYLES = ['full', 'first'] as const;
export type NameStyle = (typeof NAME_STYLES)[number];
export const SEEKING = ['internship', 'full_time'] as const;
export type Seeking = (typeof SEEKING)[number];

// ── Employers ─────────────────────────────

/** Employer hosts are `emp-<name>`; colleges may not use the prefix (ADR 0014 N2). */
export const EMPLOYER_SLUG_PREFIX = 'emp-';
export const EMPLOYER_STATUSES = ['applied', 'verified', 'approved', 'suspended', 'rejected'] as const;
export type EmployerStatus = (typeof EMPLOYER_STATUSES)[number];
export const EMPLOYER_LIMITS = {
  seats: 10,
  openPostings: 10,
  postingsPerMonth: 20,
  collegesPerPosting: 50,
  poolQueriesPerHour: 60,
  candidateReadsPerHour: 120,
  resumeLinksPerDay: 200,
  readinessReadsPerDay: 200,
  appliesPerIpPerDay: 3,
  blocksToSuspend: 3,
  blockWindowDays: 90,
  reportsToHide: 3,
} as const;
export const POSTING_TYPES = ['internship', 'full_time'] as const;
export type PostingType = (typeof POSTING_TYPES)[number];
export const POSTING_STATUSES = ['draft', 'published', 'closed'] as const;
export type PostingStatus = (typeof POSTING_STATUSES)[number];
export const POSTING_DECISIONS = ['pending', 'approved', 'declined', 'withdrawn', 'hidden'] as const;
export type PostingDecision = (typeof POSTING_DECISIONS)[number];
export const POSTING_DECLINE_REASONS = [
  'not_relevant',
  'timing',
  'eligibility',
  'already_partnered',
  'other',
] as const;
export type PostingDeclineReason = (typeof POSTING_DECLINE_REASONS)[number];
export const CANDIDACY_STAGES = ['shared', 'shortlisted', 'not_selected', 'selected', 'withdrawn'] as const;
export type CandidacyStage = (typeof CANDIDACY_STAGES)[number];
export const BILLABLE_KINDS = ['posting', 'drive', 'hire'] as const;
export type BillableKind = (typeof BILLABLE_KINDS)[number];
/** Platform defaults; whole paise. `revenueShareBps` is the colleges' share (basis points). */
export const EMPLOYER_PRICING_DEFAULT = {
  perPosting: 0,
  perDrive: 0,
  perHire: 0,
  revenueShareBps: 2000,
} as const;

/** Mail providers and disposable domains an employer may not apply with (N23). */
export const EMPLOYER_BLOCKED_MAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.in',
  'ymail.com',
  'outlook.com',
  'outlook.in',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'rediffmail.com',
  'rediff.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'zohomail.in',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'tutanota.com',
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'sharklasers.com',
  'yopmail.com',
];
export const isFreeMailDomain = (domain: string): boolean => {
  const d = domain.toLowerCase();
  return EMPLOYER_BLOCKED_MAIL_DOMAINS.includes(d) || /^yahoo\./.test(d) || /^hotmail\./.test(d);
};

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** The GSTIN check digit (mod 36, alternating weights 1 and 2). */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i] ?? '') * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] ?? '0';
}
/** Shape, state code (01 to 38) and check digit (N24). A person still checks it on the GST portal. */
export function isValidGstin(value: string): boolean {
  const g = value.trim().toUpperCase();
  const m = GSTIN_SHAPE.exec(g);
  if (!m) return false;
  const state = Number(m[1]);
  if (state < 1 || state > 38) return false;
  return gstinCheckDigit(g.slice(0, 14)) === g[14];
}

/** Pool counts resist differencing (N29): `<5` below five, then down to a multiple of five. */
export const poolCount = (n: number): number | '<5' => (n > 0 && n < 5 ? '<5' : n - (n % 5));

// ── Verified credentials ─────────────────────────────

export const CREDENTIAL_TYPES = [
  'PlacementOfferCredential',
  'ReadinessMilestoneCredential',
  'MentorCertificateCredential',
  'MentorshipRecognitionCredential',
] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];
export const READINESS_MILESTONES = [60, 80] as const;
export type ReadinessMilestone = (typeof READINESS_MILESTONES)[number];
export const CREDENTIAL_STATUSES = ['active', 'revoked'] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];
export const CREDENTIAL_REVOKE_REASONS = ['source_changed', 'member', 'admin', 'erased'] as const;
export type CredentialRevokeReason = (typeof CREDENTIAL_REVOKE_REASONS)[number];
/** W3C Bitstring Status List: entries per list (16 KB). */
export const STATUS_LIST_SIZE = 131_072;
/** Issuer keys are rotated by the timer after this many days. */
export const ISSUER_KEY_ROTATE_DAYS = 365;
