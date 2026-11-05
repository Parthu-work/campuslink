import { z } from 'zod';
import { objectId } from './common.js';
import { httpsUrl } from './people.js';
import type { PersonRef } from './mentorship.js';
import type { Count } from './analytics.js';
import { BRANCHES, type Branch } from '../constants/people.js';
import {
  ACADEMIC_YEAR_PATTERN,
  MICRO_ASK_KINDS,
  MICRO_ASK_NOTE_MAX,
  PLEDGE_MAX_PAISE,
  PLEDGE_MIN_PAISE,
  PLEDGE_PURPOSES,
  FUND_STATUSES,
  type AlumniOfMonthStatus,
  type CertificateStatus,
  type MicroAskKind,
  type MicroAskStatus,
  type PledgePurpose,
  type PledgeStatus,
} from '../constants/alumni.js';

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ── Micro-asks ─────────────────────────────

export const microAskBody = z
  .strictObject({
    kind: z.enum(MICRO_ASK_KINDS),
    /** Who should get it: alumni at a company, of a branch, or who know a topic (any one or more). */
    audience: z
      .strictObject({
        company: text(2, 80).optional(),
        branch: z.enum(BRANCHES).optional(),
        topic: text(2, 40).optional(),
      })
      .default({}),
    /** The résumé to review, or the Q&A question to answer. */
    resumeId: objectId.optional(),
    questionId: objectId.optional(),
    note: text(10, MICRO_ASK_NOTE_MAX),
  })
  .superRefine((b, ctx) => {
    if (b.kind === 'review_resume' && !b.resumeId)
      ctx.addIssue({ code: 'custom', message: 'Pick the résumé to review', path: ['resumeId'] });
    if (b.kind === 'answer_question' && !b.questionId)
      ctx.addIssue({ code: 'custom', message: 'Pick the question to answer', path: ['questionId'] });
    if (b.kind !== 'review_resume' && b.resumeId)
      ctx.addIssue({ code: 'custom', message: 'Only a résumé review takes a résumé', path: ['resumeId'] });
    if (b.kind !== 'answer_question' && b.questionId)
      ctx.addIssue({ code: 'custom', message: 'Only an answer takes a question', path: ['questionId'] });
  });
export const microAskReplyBody = z.strictObject({ action: z.enum(['accept', 'decline', 'done']) });
export const microAsksQuery = z.strictObject({ box: z.enum(['sent', 'received']).default('sent') });

// ── Office hours ─────────────────────────────

export const officeHoursSubscriptionBody = z.strictObject({ on: z.boolean() });

// ── Recognition ─────────────────────────────

export const certificateBody = z.strictObject({
  academicYear: z.string().regex(ACADEMIC_YEAR_PATTERN, 'Use a year like 2025-26'),
});
export const certificateCodeParams = z.strictObject({ code: z.string().regex(/^[a-f0-9]{32}$/) });
export const alumniOfMonthBody = z.strictObject({
  userId: objectId,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
  citation: text(10, 300),
});
export const alumniOfMonthReplyBody = z.strictObject({ accept: z.boolean() });
export const announceBody = z.strictObject({ body: text(10, 2000) });

// ── Giving ─────────────────────────────

export const fundBody = z.strictObject({
  title: text(3, 100),
  purpose: z.enum(PLEDGE_PURPOSES),
  description: text(10, 2000),
  /** Whole paise; null for no target. */
  targetPaise: z
    .number()
    .int()
    .min(PLEDGE_MIN_PAISE)
    .max(100 * PLEDGE_MAX_PAISE)
    .nullable()
    .default(null),
  /** The college's own payment page (Razorpay or any https link): money never passes through us. */
  payLink: httpsUrl.nullable().default(null),
  bankDetails: text(0, 600).default(''),
  status: z.enum(FUND_STATUSES).default('open'),
});
export const givingSettingsBody = z.strictObject({
  /** The college is registered to issue tax receipts (for example under section 80G). */
  taxReceipts: z.boolean(),
  registration: text(0, 200).default(''),
  signatory: text(0, 80).default(''),
});
export const pledgeBody = z.strictObject({
  fundId: objectId,
  amountPaise: z.number().int().min(PLEDGE_MIN_PAISE).max(PLEDGE_MAX_PAISE),
});
export const pledgePaidBody = z.strictObject({ reference: text(3, 80) });
export const pledgeReceiveBody = z.strictObject({
  amountPaise: z.number().int().min(PLEDGE_MIN_PAISE).max(PLEDGE_MAX_PAISE),
  receivedOn: day,
  reference: text(0, 80).default(''),
});
export const pledgesQuery = z.strictObject({
  status: z.enum(['pledged', 'paid', 'received', 'cancelled']).optional(),
  fundId: objectId.optional(),
});

// ── LinkedIn import ─────────────────────────────

export const linkedinApplyBody = z.strictObject({
  company: text(0, 100),
  jobTitle: text(0, 100),
  skills: z.array(text(1, 50)).max(50),
});

// ── Batch pages ─────────────────────────────

export const batchParams = z.strictObject({
  gradYear: z.coerce.number().int().min(1950).max(2100),
  branch: z.enum(BRANCHES),
});

// ── Views ─────────────────────────────

export interface MicroAskView {
  id: string;
  kind: MicroAskKind;
  status: MicroAskStatus;
  /** The viewer's side of it. */
  role: 'asker' | 'helper';
  asker: PersonRef;
  helper: PersonRef | null;
  audience: { company?: string; branch?: Branch; topic?: string };
  note: string;
  resumeId: string | null;
  questionId: string | null;
  /** When the current helper's time to reply runs out. */
  expiresAt: string | null;
  doneAt: string | null;
  createdAt: string;
}
export interface MicroAskInbox {
  asks: MicroAskView[];
  /** Asks received this rolling week, and the cap (helpers only). */
  week: { received: number; cap: number };
}

export interface OfficeHoursSubscriptionView {
  host: PersonRef;
  since: string;
}

export interface CertificateView {
  id: string;
  academicYear: string;
  status: CertificateStatus;
  sessions: number;
  mentees: number;
  asks: number;
  events: number;
  /** The public verification code (shown on the PDF, checked at /verify-certificate/:code). */
  code: string;
  issuedAt: string;
}
export interface CertificateEligibility {
  academicYear: string;
  sessions: number;
  mentees: number;
  asks: number;
  events: number;
  /** Something to certify: at least one session, ask or hosted event in the year. */
  eligible: boolean;
  certificateId: string | null;
}
export interface VerifiedCertificateView {
  valid: boolean;
  status: CertificateStatus;
  name: string;
  college: string;
  academicYear: string;
  sessions: number;
  mentees: number;
  asks: number;
  events: number;
  issuedAt: string;
}

export interface AlumniOfMonthView {
  id: string;
  person: PersonRef;
  month: string;
  citation: string;
  status: AlumniOfMonthStatus;
  announced: boolean;
  createdAt: string;
}

export interface FundView {
  id: string;
  title: string;
  purpose: PledgePurpose;
  description: string;
  targetPaise: number | null;
  payLink: string | null;
  bankDetails: string;
  status: (typeof FUND_STATUSES)[number];
  /** Totals: received is what the college recorded; pledged is promised and not yet received. */
  receivedPaise: number;
  pledgedPaise: number;
  donors: Count;
}
export interface PledgeView {
  id: string;
  fund: { id: string; title: string; purpose: PledgePurpose };
  /** Only for the college's own view (and the member's own pledges). */
  person: PersonRef | null;
  amountPaise: number;
  status: PledgeStatus;
  reference: string;
  receivedPaise: number | null;
  receivedOn: string | null;
  receiptNo: string | null;
  /** An acknowledgement PDF is ready (a tax receipt when the college is registered for it). */
  acknowledgement: boolean;
  createdAt: string;
}
export interface GivingSettingsView {
  taxReceipts: boolean;
  registration: string;
  signatory: string;
}

export interface LinkedinPreview {
  positions: { company: string; title: string; from: string | null; to: string | null; current: boolean }[];
  education: { school: string; degree: string; from: string | null; to: string | null }[];
  skills: string[];
  /** Skills already on the profile (so the preview can show what is new). */
  existingSkills: string[];
  /** Files found in the upload and read. */
  read: string[];
}

export interface BatchView {
  gradYear: number;
  branch: Branch;
  /** Members of the batch the viewer may see, with what their visibility allows. */
  members: (PersonRef & { headline: string; company: string; jobTitle: string })[];
  /** Verified members of the batch (suppressed), and where they work: counts through suppress(). */
  total: Count;
  companies: { company: string; count: Count }[];
  reunions: { id: string; title: string; startsAt: string; kind: string }[];
  /** On the college's list but not here yet (suppressed): the "find your batchmates" invite. */
  notJoined: Count;
}
