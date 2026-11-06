import { Schema, type Types } from 'mongoose';
import {
  ALUMNI_OF_MONTH_STATUSES,
  BRANCHES,
  CERTIFICATE_STATUSES,
  FUND_STATUSES,
  MICRO_ASK_KINDS,
  MICRO_ASK_STATUSES,
  PLEDGE_PURPOSES,
  PLEDGE_STATUSES,
  type AlumniOfMonthStatus,
  type Branch,
  type CertificateStatus,
  type MicroAskKind,
  type MicroAskStatus,
  type PledgePurpose,
  type PledgeStatus,
} from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/** Alumni engagement (prompt 2, G6, docs/specs/alumni.md). */

// ── Micro-asks ─────────────────────────────

export interface MicroAskDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  kind: MicroAskKind;
  fromUserId: Types.ObjectId | null;
  /** The alumnus it is with now (null while routing, unmatched or after their erasure). */
  toUserId: Types.ObjectId | null;
  audience: { company?: string; companyKey?: string; branch?: Branch; topic?: string };
  resumeId: Types.ObjectId | null;
  questionId: Types.ObjectId | null;
  note: string;
  status: MicroAskStatus;
  /** Alumni already asked (declined or silent): never asked again for this one. */
  tried: Types.ObjectId[];
  assignedAt: Date | null;
  expiresAt: Date | null;
  /** Bumped on every hand-over: the expiry job no-ops when it changed. */
  version: number;
  doneAt: Date | null;
  createdAt: Date;
}

const microAskSchema = new Schema(
  {
    kind: { type: String, enum: MICRO_ASK_KINDS, required: true },
    fromUserId: { type: Schema.Types.ObjectId, default: null },
    toUserId: { type: Schema.Types.ObjectId, default: null },
    audience: new Schema(
      {
        company: { type: String, maxlength: 80 },
        companyKey: { type: String, maxlength: 80 },
        branch: { type: String, enum: BRANCHES },
        topic: { type: String, maxlength: 40 },
      },
      { _id: false, strict: 'throw' },
    ),
    resumeId: { type: Schema.Types.ObjectId, default: null },
    questionId: { type: Schema.Types.ObjectId, default: null },
    note: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: MICRO_ASK_STATUSES, default: 'routing' },
    tried: { type: [Schema.Types.ObjectId], default: [] },
    assignedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
    doneAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
microAskSchema.index({ tenantId: 1, fromUserId: 1, createdAt: -1 });
// The weekly cap counts asks handed to an alumnus by `assignedAt`.
microAskSchema.index({ tenantId: 1, toUserId: 1, assignedAt: -1 });
microAskSchema.index({ tenantId: 1, tried: 1 });
export const MicroAskModel = defineTenantModel('MicroAsk', microAskSchema);

/**
 * Each hand-over of an ask to an alumnus, kept for the weekly cap (a hand-over counts even when the
 * alumnus passes or the ask later moves on). The unique (alumnus, week slot) index makes the cap
 * hold under races: a third hand-over in the same rolling week cannot be written.
 */
export interface MicroAskOfferDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  askId: Types.ObjectId;
  createdAt: Date;
}
const offerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    askId: { type: Schema.Types.ObjectId, required: true },
    /** `<week index>:<slot>`: at most MICRO_ASKS_PER_WEEK slots per alumnus and rolling week. */
    slot: { type: String, required: true, maxlength: 40 },
  },
  baseSchemaOptions,
);
offerSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
offerSchema.index({ tenantId: 1, userId: 1, slot: 1 }, { unique: true });
export const MicroAskOfferModel = defineTenantModel('MicroAskOffer', offerSchema);

// ── Recognition ─────────────────────────────

export interface MentorCertificateDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  academicYear: string;
  /** Printed on the certificate (the member's name when it was issued). */
  name: string;
  sessions: number;
  mentees: number;
  asks: number;
  events: number;
  /**
   * The public verification code: 128 random bits, stored as is (owner decision, G6: no signing key;
   * an unknown code is simply not found, and revoking is a status change).
   */
  code: string;
  status: CertificateStatus;
  pdfFileId: Types.ObjectId | null;
  revokedAt: Date | null;
  createdAt: Date;
}
const certificateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    academicYear: { type: String, required: true, maxlength: 7 },
    name: { type: String, required: true, maxlength: 120 },
    sessions: { type: Number, default: 0 },
    mentees: { type: Number, default: 0 },
    asks: { type: Number, default: 0 },
    events: { type: Number, default: 0 },
    code: { type: String, required: true, maxlength: 32 },
    status: { type: String, enum: CERTIFICATE_STATUSES, default: 'rendering' },
    pdfFileId: { type: Schema.Types.ObjectId, default: null },
    revokedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
// One certificate per member and academic year.
certificateSchema.index({ tenantId: 1, userId: 1, academicYear: 1 }, { unique: true });
certificateSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const MentorCertificateModel = defineTenantModel('MentorCertificate', certificateSchema);

export interface AlumniOfMonthDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  month: string;
  citation: string;
  status: AlumniOfMonthStatus;
  nominatedBy: Types.ObjectId | null;
  postId: Types.ObjectId | null;
  createdAt: Date;
}
const ofMonthSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    month: { type: String, required: true, maxlength: 7 },
    citation: { type: String, required: true, maxlength: 300 },
    status: { type: String, enum: ALUMNI_OF_MONTH_STATUSES, default: 'proposed' },
    nominatedBy: { type: Schema.Types.ObjectId, default: null },
    postId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
// One alumnus of the month per month (a declined nomination frees the month: see the service).
ofMonthSchema.index(
  { tenantId: 1, month: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['proposed', 'published'] } } },
);
ofMonthSchema.index({ tenantId: 1, userId: 1 });
export const AlumniOfMonthModel = defineTenantModel('AlumniOfMonth', ofMonthSchema);

// ── Giving ─────────────────────────────

export interface FundDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  title: string;
  purpose: PledgePurpose;
  description: string;
  targetPaise: number | null;
  payLink: string | null;
  bankDetails: string;
  status: (typeof FUND_STATUSES)[number];
  createdAt: Date;
}
const fundSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 100 },
    purpose: { type: String, enum: PLEDGE_PURPOSES, required: true },
    description: { type: String, required: true, maxlength: 2000 },
    targetPaise: { type: Number, default: null, min: 0 },
    payLink: { type: String, default: null, maxlength: 2000 },
    bankDetails: { type: String, default: '', maxlength: 600 },
    status: { type: String, enum: FUND_STATUSES, default: 'open' },
  },
  baseSchemaOptions,
);
fundSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const FundModel = defineTenantModel('Fund', fundSchema);

export interface PledgeDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  /** null once the member is erased: the college's record stays, with `anonKey`. */
  userId: Types.ObjectId | null;
  anonKey: string | null;
  fundId: Types.ObjectId;
  purpose: PledgePurpose;
  amountPaise: number;
  status: PledgeStatus;
  reference: string;
  receivedPaise: number | null;
  receivedOn: Date | null;
  receivedReference: string;
  receiptNo: string | null;
  /** The acknowledgement says "tax receipt" only when the college was registered when it was issued. */
  taxReceipt: boolean;
  ackFileId: Types.ObjectId | null;
  /** Who was recording, for the next status change: changes are refused when it moved on. */
  version: number;
  createdAt: Date;
}
const pledgeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, default: null },
    anonKey: { type: String, default: null },
    fundId: { type: Schema.Types.ObjectId, required: true },
    purpose: { type: String, enum: PLEDGE_PURPOSES, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    status: { type: String, enum: PLEDGE_STATUSES, default: 'pledged' },
    reference: { type: String, default: '', maxlength: 80 },
    receivedPaise: { type: Number, default: null },
    receivedOn: { type: Date, default: null },
    receivedReference: { type: String, default: '', maxlength: 80 },
    receiptNo: { type: String, default: null },
    taxReceipt: { type: Boolean, default: false },
    ackFileId: { type: Schema.Types.ObjectId, default: null },
    version: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);
pledgeSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
pledgeSchema.index({ tenantId: 1, fundId: 1, status: 1 });
pledgeSchema.index({ tenantId: 1, status: 1, receivedOn: 1 });
// A receipt number is used once in a college.
pledgeSchema.index(
  { tenantId: 1, receiptNo: 1 },
  { unique: true, partialFilterExpression: { receiptNo: { $type: 'string' } } },
);
export const PledgeModel = defineTenantModel('Pledge', pledgeSchema);

/** The college's receipt numbering, per financial year (`ACK/2026-27/0001`). */
const receiptCounterSchema = new Schema(
  {
    year: { type: String, required: true, maxlength: 7 },
    seq: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);
receiptCounterSchema.index({ tenantId: 1, year: 1 }, { unique: true });
export const ReceiptCounterModel = defineTenantModel('ReceiptCounter', receiptCounterSchema);

/** One per college: whether it is registered to issue tax receipts, and what the receipts say. */
export interface GivingSettingsDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  key: 'college';
  taxReceipts: boolean;
  registration: string;
  signatory: string;
}
const givingSettingsSchema = new Schema(
  {
    key: { type: String, enum: ['college'], default: 'college' },
    taxReceipts: { type: Boolean, default: false },
    registration: { type: String, default: '', maxlength: 200 },
    signatory: { type: String, default: '', maxlength: 80 },
  },
  baseSchemaOptions,
);
givingSettingsSchema.index({ tenantId: 1, key: 1 }, { unique: true });
export const GivingSettingsModel = defineTenantModel('GivingSettings', givingSettingsSchema);
