import { Schema, type InferSchemaType, type Types } from 'mongoose';
import {
  ACADEMIC_SOURCES,
  BRANCHES,
  CTC_BANDS,
  DRIVE_MODES,
  DRIVE_ROLE_TYPES,
  DRIVE_STATUSES,
  FINAL_RESULTS,
  OFFER_SOURCES,
  OFFER_STATUSES,
  QUESTION_KINDS,
  REGISTRATION_STATUSES,
  ROUND_KINDS,
  ROUND_RESULTS,
} from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** A company that recruits through the college (B7). Notes are the placement cell's own. */
const companySchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 120 },
    /** lib/company.ts: the comparable name ("Nimbus Labs Pvt. Ltd." → "nimbus labs"). */
    companyKey: { type: String, required: true },
    website: { type: String, default: null },
    sector: { type: String, default: '', maxlength: 80 },
    notes: { type: String, default: '', maxlength: 2000 },
  },
  baseSchemaOptions,
);
companySchema.index({ tenantId: 1, companyKey: 1 }, { unique: true });
export type PlacementCompanyDoc = InferSchemaType<typeof companySchema> & { _id: Types.ObjectId };
export const PlacementCompanyModel = defineTenantModel('PlacementCompany', companySchema);

/**
 * A student's academic record, keyed by roll number (imports arrive before students join). Imported
 * and placement-cell records are trusted; self-reported ones count once the cell verified them.
 */
const academicSchema = new Schema(
  {
    rollNumber: { type: String, required: true, uppercase: true, trim: true },
    /** The member who reported it (self) or whose record it is; null after erasure. */
    userId: { type: Schema.Types.ObjectId, default: null },
    cgpa: { type: Number, default: null, min: 0, max: 10 },
    activeBacklogs: { type: Number, default: null, min: 0 },
    historyBacklogs: { type: Number, default: null, min: 0 },
    tenthPct: { type: Number, default: null, min: 0, max: 100 },
    twelfthPct: { type: Number, default: null, min: 0, max: 100 },
    diplomaPct: { type: Number, default: null, min: 0, max: 100 },
    source: { type: String, enum: ACADEMIC_SOURCES, required: true },
    verifiedBy: { type: Schema.Types.ObjectId, default: null },
    verifiedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
academicSchema.index({ tenantId: 1, rollNumber: 1 }, { unique: true });
academicSchema.index({ tenantId: 1, source: 1, verifiedAt: 1 });
export type AcademicRecordDoc = InferSchemaType<typeof academicSchema> & {
  _id: Types.ObjectId;
  updatedAt: Date;
};
export const AcademicRecordModel = defineTenantModel('AcademicRecord', academicSchema);

const driveSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 160 },
    description: { type: String, default: '', maxlength: 4000 },
    roles: {
      type: [
        {
          title: { type: String, required: true },
          ctcMinLpa: { type: Number, default: null },
          ctcMaxLpa: { type: Number, default: null },
          location: { type: String, default: '' },
          type: { type: String, enum: DRIVE_ROLE_TYPES, required: true },
          _id: false,
        },
      ],
      default: [],
    },
    mode: { type: String, enum: DRIVE_MODES, required: true },
    venue: { type: String, default: '' },
    driveDate: { type: Date, required: true },
    registrationCloseAt: { type: Date, required: true },
    eligibility: {
      branches: { type: [{ type: String, enum: BRANCHES }], default: [] },
      gradYears: { type: [Number], default: [] },
      minCgpa: { type: Number, default: null },
      maxActiveBacklogs: { type: Number, default: null },
      maxHistoryBacklogs: { type: Number, default: null },
      minTenthPct: { type: Number, default: null },
      minTwelfthPct: { type: Number, default: null },
    },
    questions: {
      type: [
        {
          label: { type: String, required: true },
          kind: { type: String, enum: QUESTION_KINDS, required: true },
          options: { type: [String], default: [] },
          required: { type: Boolean, default: true },
          _id: false,
        },
      ],
      default: [],
    },
    rounds: {
      type: [
        {
          name: { type: String, required: true },
          kind: { type: String, enum: ROUND_KINDS, required: true },
          at: { type: Date, default: null },
          _id: false,
        },
      ],
      default: [],
    },
    resumeRequired: { type: Boolean, default: true },
    status: { type: String, enum: DRIVE_STATUSES, default: 'draft' },
    linkedEventId: { type: Schema.Types.ObjectId, default: null },
    /** Ineligible students the placement cell let in (audited). */
    overrides: {
      type: [
        {
          userId: Schema.Types.ObjectId,
          by: Schema.Types.ObjectId,
          reason: String,
          at: Date,
          _id: false,
        },
      ],
      default: [],
    },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    /** Bumped when status or the closing time changes; the reminder job carries it. */
    version: { type: Number, default: 0 },
    openedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
driveSchema.index({ tenantId: 1, status: 1, registrationCloseAt: 1 });
driveSchema.index({ tenantId: 1, _id: -1 });
export type DriveDoc = InferSchemaType<typeof driveSchema> & { _id: Types.ObjectId; createdAt: Date };
export const PlacementDriveModel = defineTenantModel('PlacementDrive', driveSchema);

const registrationSchema = new Schema(
  {
    driveId: { type: Schema.Types.ObjectId, required: true },
    /** null after the member's account is erased: the institutional record stays, anonymised. */
    userId: { type: Schema.Types.ObjectId, default: null },
    answers: {
      type: [{ question: Number, value: { type: String, maxlength: 2000 }, _id: false }],
      default: [],
    },
    resumeFileId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: REGISTRATION_STATUSES, default: 'registered' },
    roundResults: {
      type: [{ round: Number, result: { type: String, enum: ROUND_RESULTS }, _id: false }],
      default: [],
    },
    final: { type: String, enum: FINAL_RESULTS, default: 'in_process' },
    /** Kept for the college's placement record (also after anonymisation). */
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    gradYear: { type: Number, default: null },
  },
  baseSchemaOptions,
);
// One registration per member and drive (races end here); anonymised rows (userId null) are exempt.
registrationSchema.index(
  { tenantId: 1, driveId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } }, name: 'one_per_drive' },
);
registrationSchema.index({ tenantId: 1, userId: 1, _id: -1 });
export type RegistrationDoc = InferSchemaType<typeof registrationSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const DriveRegistrationModel = defineTenantModel('DriveRegistration', registrationSchema);

const offerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, default: null },
    companyKey: { type: String, required: true },
    companyName: { type: String, required: true, maxlength: 120 },
    role: { type: String, required: true, maxlength: 120 },
    /** Exact; only the member and the placement cell see it. Cleared on anonymisation. */
    ctcLpa: { type: Number, default: null },
    ctcBand: { type: String, enum: CTC_BANDS, required: true },
    offerDate: { type: Date, required: true },
    type: { type: String, enum: DRIVE_ROLE_TYPES, required: true },
    source: { type: String, enum: OFFER_SOURCES, required: true },
    driveId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: OFFER_STATUSES, default: 'reported' },
    reason: { type: String, default: null, maxlength: 300 },
    proofFileId: { type: Schema.Types.ObjectId, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, default: null },
    verifiedAt: { type: Date, default: null },
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    gradYear: { type: Number, default: null },
  },
  baseSchemaOptions,
);
offerSchema.index({ tenantId: 1, userId: 1, _id: -1 });
offerSchema.index({ tenantId: 1, status: 1, _id: -1 });
offerSchema.index({ tenantId: 1, driveId: 1, userId: 1 });
export type OfferDoc = InferSchemaType<typeof offerSchema> & { _id: Types.ObjectId; createdAt: Date };
export const OfferModel = defineTenantModel('Offer', offerSchema);
