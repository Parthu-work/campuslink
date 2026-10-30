import { z } from 'zod';
import { objectId } from './common.js';
import { gradYear, httpsUrl } from './people.js';
import { BRANCHES } from '../constants/people.js';
import {
  DRIVE_MODES,
  DRIVE_ROLE_TYPES,
  EXPORT_COLUMNS,
  FINAL_RESULTS,
  OFFER_SOURCES,
  QUESTION_KINDS,
  ROUND_KINDS,
  ROUND_RESULTS,
  type CtcBand,
  type DriveMode,
  type DriveRoleType,
  type DriveStatus,
  type FinalResult,
  type OfferSource,
  type OfferStatus,
  type QuestionKind,
  type RegistrationStatus,
  type RoundKind,
  type RoundResult,
  type AcademicSource,
} from '../constants/placements.js';
import type { EligibilityReason } from '../placements/eligibility.js';

/** Placement drives, registrations and offers (build B7). */
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const isoDate = z.iso.datetime({ offset: true });
const lpa = z.number().min(0).max(500);
const pct = z.number().min(0).max(100);

export const placementCompanyBody = z.strictObject({
  name: text(2, 120),
  website: httpsUrl.nullable().default(null),
  sector: text(0, 80).default(''),
  /** The placement cell's own notes; never shown to students. */
  notes: text(0, 2000).default(''),
});

const driveRole = z
  .strictObject({
    title: text(2, 120),
    ctcMinLpa: lpa.nullable().default(null),
    ctcMaxLpa: lpa.nullable().default(null),
    location: text(0, 120).default(''),
    type: z.enum(DRIVE_ROLE_TYPES),
  })
  .refine((r) => r.ctcMinLpa === null || r.ctcMaxLpa === null || r.ctcMaxLpa >= r.ctcMinLpa, {
    message: 'The top of the range is below the bottom',
    path: ['ctcMaxLpa'],
  });

export const eligibilityBody = z.strictObject({
  branches: z.array(z.enum(BRANCHES)).max(BRANCHES.length).default([]),
  gradYears: z.array(gradYear).max(6).default([]),
  minCgpa: z.number().min(0).max(10).nullable().default(null),
  maxActiveBacklogs: z.number().int().min(0).max(50).nullable().default(null),
  maxHistoryBacklogs: z.number().int().min(0).max(50).nullable().default(null),
  minTenthPct: pct.nullable().default(null),
  minTwelfthPct: pct.nullable().default(null),
});

const question = z
  .strictObject({
    label: text(2, 200),
    kind: z.enum(QUESTION_KINDS),
    options: z.array(text(1, 80)).max(10).default([]),
    required: z.boolean().default(true),
  })
  .refine((q) => q.kind !== 'choice' || q.options.length >= 2, {
    message: 'A choice needs at least two options',
    path: ['options'],
  });

const round = z.strictObject({
  name: text(2, 80),
  kind: z.enum(ROUND_KINDS),
  at: isoDate.nullable().default(null),
});

const driveFields = {
  /** An existing company, or a new one by name (matched on its normalised name). */
  companyId: objectId.optional(),
  companyName: text(2, 120).optional(),
  title: text(3, 160),
  description: text(0, 4000).default(''),
  roles: z.array(driveRole).min(1).max(10),
  mode: z.enum(DRIVE_MODES),
  venue: text(0, 200).default(''),
  driveDate: isoDate,
  registrationCloseAt: isoDate,
  eligibility: eligibilityBody.default({
    branches: [],
    gradYears: [],
    minCgpa: null,
    maxActiveBacklogs: null,
    maxHistoryBacklogs: null,
    minTenthPct: null,
    minTwelfthPct: null,
  }),
  questions: z.array(question).max(10).default([]),
  rounds: z.array(round).max(10).default([]),
  /** Students must attach a PDF résumé to register. */
  resumeRequired: z.boolean().default(true),
};
const driveRules = (
  d: {
    companyId?: string | undefined;
    companyName?: string | undefined;
    driveDate: string;
    registrationCloseAt: string;
  },
  ctx: z.RefinementCtx,
) => {
  if (!d.companyId && !d.companyName)
    ctx.addIssue({ code: 'custom', message: 'Pick or name the company', path: ['companyName'] });
  if (Date.parse(d.registrationCloseAt) > Date.parse(d.driveDate))
    ctx.addIssue({
      code: 'custom',
      message: 'Registration closes before the drive',
      path: ['registrationCloseAt'],
    });
};
export const driveBody = z
  .strictObject({
    ...driveFields,
    /** Also create a `drive` event (calendar, RSVP) linked to this drive. */
    createEvent: z.boolean().default(false),
  })
  .superRefine(driveRules);
export const driveUpdateBody = z.strictObject(driveFields).superRefine(driveRules);
export const driveStatusBody = z.strictObject({
  status: z.enum(['open', 'closed', 'in_progress', 'completed', 'cancelled']),
});
export const drivesQuery = z.strictObject({
  scope: z.enum(['eligible', 'all', 'registered']).default('eligible'),
  cursor: objectId.optional(),
});
export const adminDrivesQuery = z.strictObject({
  status: z.enum(['draft', 'open', 'closed', 'in_progress', 'completed', 'cancelled']).optional(),
  cursor: objectId.optional(),
});

export const registerBody = z.strictObject({
  answers: z
    .array(z.strictObject({ question: z.number().int().min(0).max(9), value: text(0, 2000) }))
    .max(10)
    .default([]),
  resumeFileId: objectId.optional(),
});
/** Let one ineligible student in: by member id or by the roll number the placement cell knows. */
export const overrideBody = z
  .strictObject({
    userId: objectId.optional(),
    rollNumber: z.string().trim().min(4).max(20).optional(),
    reason: text(5, 300),
  })
  .refine((b) => !!b.userId !== !!b.rollNumber, {
    message: 'Give the student’s roll number',
    path: ['rollNumber'],
  });
export const registrantsExportQuery = z.strictObject({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  columns: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(EXPORT_COLUMNS)).min(1).max(EXPORT_COLUMNS.length)),
});
export const roundResultsBody = z.strictObject({
  results: z
    .array(z.strictObject({ registrationId: objectId, result: z.enum(ROUND_RESULTS) }))
    .min(1)
    .max(2000),
});
export const roundParams = z.strictObject({
  id: objectId,
  round: z.coerce.number().int().min(0).max(9),
});
export const finalBody = z.strictObject({
  final: z.enum(FINAL_RESULTS),
  /** For a selection: the offer (role from the drive, CTC exact). */
  role: text(2, 120).optional(),
  ctcLpa: lpa.optional(),
  type: z.enum(DRIVE_ROLE_TYPES).optional(),
});

export const offerReportBody = z.strictObject({
  companyName: text(2, 120),
  role: text(2, 120),
  ctcLpa: lpa,
  offerDate: isoDate,
  type: z.enum(DRIVE_ROLE_TYPES),
  source: z.enum(
    OFFER_SOURCES.filter((s) => s !== 'drive') as ['off_campus', 'ppo', 'internship_conversion'],
  ),
  proofFileId: objectId,
});
export const offerDecisionBody = z
  .strictObject({ decision: z.enum(['verify', 'reject']), reason: text(3, 300).optional() })
  .refine((b) => b.decision !== 'reject' || !!b.reason, { message: 'Give a reason', path: ['reason'] });
export const offersQuery = z.strictObject({
  status: z.enum(['reported', 'verified', 'rejected', 'declined_by_student']).default('reported'),
  cursor: objectId.optional(),
});

export const academicSelfBody = z.strictObject({
  cgpa: z.number().min(0).max(10),
  activeBacklogs: z.number().int().min(0).max(50),
  historyBacklogs: z.number().int().min(0).max(50),
  tenthPct: pct.nullable().default(null),
  twelfthPct: pct.nullable().default(null),
  diplomaPct: pct.nullable().default(null),
});
export const academicVerifyBody = z.strictObject({ decision: z.enum(['verify', 'reject']) });

// ── Views ─────────────────────────────
export interface PlacementCompanyView {
  id: string;
  name: string;
  website: string | null;
  sector: string;
  /** Placement cell only. */
  notes?: string;
}
export interface DriveRoleView {
  title: string;
  ctcMinLpa: number | null;
  ctcMaxLpa: number | null;
  location: string;
  type: DriveRoleType;
}
export interface DriveView {
  id: string;
  company: PlacementCompanyView;
  title: string;
  description: string;
  roles: DriveRoleView[];
  mode: DriveMode;
  venue: string;
  driveDate: string;
  registrationCloseAt: string;
  eligibility: z.output<typeof eligibilityBody>;
  questions: { label: string; kind: QuestionKind; options: string[]; required: boolean }[];
  rounds: { name: string; kind: RoundKind; at: string | null }[];
  resumeRequired: boolean;
  status: DriveStatus;
  linkedEventId: string | null;
  /** Registration is open now (status open and before the close). */
  registrationOpen: boolean;
  /** For the viewer: can they register, and if not, why. */
  eligible: boolean;
  reasons: EligibilityReason[];
  overridden: boolean;
  myRegistration: MyRegistrationView | null;
  /** Placement cell only. */
  registrations?: number;
}
export interface MyRegistrationView {
  id: string;
  status: RegistrationStatus;
  final: FinalResult;
  roundResults: { round: number; result: RoundResult }[];
  createdAt: string;
}
export interface RegistrantView {
  id: string;
  userId: string | null;
  name: string;
  rollNumber: string | null;
  branch: string | null;
  gradYear: number | null;
  cgpa: number | null;
  status: RegistrationStatus;
  final: FinalResult;
  roundResults: { round: number; result: RoundResult }[];
  /** The résumé file (served to the placement cell only). */
  resumeFileId: string | null;
  createdAt: string;
}
export interface OfferView {
  id: string;
  companyName: string;
  role: string;
  /** Exact: only the member and the placement cell see it. */
  ctcLpa: number;
  ctcBand: CtcBand;
  offerDate: string;
  type: DriveRoleType;
  source: OfferSource;
  status: OfferStatus;
  reason: string | null;
  driveId: string | null;
  hasProof: boolean;
  /** Placement cell views. */
  member?: { userId: string | null; name: string; branch: string | null; gradYear: number | null };
  /** Placement cell views: the proof file (served to whoever verifies offers). */
  proofFileId?: string | null;
  createdAt: string;
}
export interface AcademicRecordView {
  cgpa: number | null;
  activeBacklogs: number | null;
  historyBacklogs: number | null;
  tenthPct: number | null;
  twelfthPct: number | null;
  diplomaPct: number | null;
  source: AcademicSource;
  verified: boolean;
  updatedAt: string;
}
export interface RoundImportResult {
  updated: number;
  unchanged: number;
  /** Roll numbers in the file that are not registered for this drive (never guessed). */
  unknown: string[];
  /** Rows that could not be read (row number and why). */
  errors: { row: number; message: string }[];
}
