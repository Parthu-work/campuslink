import { Schema, type InferSchemaType } from 'mongoose';
import {
  BRANCHES,
  CANDIDACY_STAGES,
  INTRO_DECLINE_REASONS,
  INTRO_GOALS,
  INTRO_STATUSES,
  NAME_STYLES,
  NETWORK_INTROS_RECEIVED_DEFAULT,
  SEEKING,
  SESSION_TYPES,
} from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel, definePlatformModel } from '../../db/models.js';

/**
 * The network (prompt 2, G12, ADR 0014). Every collection here lives in the member's own college.
 * `NetworkProfile` and `NetworkCandidacy` are the opt-in projections: the only member data another
 * tenant may read, rebuilt from the sources by `NetworkService` (never written by hand).
 */

/** The member's choices: what to show and whether they take intros (kept when consent is withdrawn). */
const prefsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    nameStyle: { type: String, enum: NAME_STYLES, default: 'first' },
    showCompany: { type: Boolean, default: true },
    showCity: { type: Boolean, default: false },
    showSkills: { type: Boolean, default: true },
    linkedinUrl: { type: String, default: null },
    helpWith: { type: [{ type: String, enum: SESSION_TYPES }], default: ['quick_chat'] },
    acceptingIntros: { type: Boolean, default: true },
    introsPerWeek: { type: Number, default: NETWORK_INTROS_RECEIVED_DEFAULT, min: 1, max: 5 },
    seeking: { type: String, enum: [...SEEKING, null], default: null },
    /** Alumni of other colleges who reported this member's intros (their profile refs). */
    reportedBy: { type: [String], default: [] },
    /** Two reports paused network access until the college reviewed it (N22). */
    pausedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
prefsSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
prefsSchema.index({ tenantId: 1, pausedAt: 1 });
export const NetworkPrefsModel = defineTenantModel('NetworkPrefs', prefsSchema);
export type NetworkPrefsDoc = InferSchemaType<typeof prefsSchema> & { _id: Schema.Types.ObjectId };

/**
 * The discovery projection. Its field list is pinned by `test/network.test.ts` (N9): no email,
 * phone, roll number, photo, age, marks, readiness, offers, CTC or activity, ever.
 */
const profileSchema = new Schema(
  {
    /** Random 128-bit id; the only id another tenant sees. New on every re-grant. */
    ref: { type: String, required: true },
    /** Never leaves the college: no cross-tenant read selects it. */
    userId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['student', 'alumni'], required: true },
    name: { type: String, required: true },
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    gradYear: { type: Number, default: null },
    company: { type: String, default: null },
    /** Normalised company name for search (lib/company.ts). */
    companyKey: { type: String, default: null },
    roleTitle: { type: String, default: null },
    city: { type: String, default: null },
    skills: { type: [String], default: [] },
    helpWith: { type: [{ type: String, enum: SESSION_TYPES }], default: [] },
    acceptingIntros: { type: Boolean, default: false },
    introsPerWeek: { type: Number, default: NETWORK_INTROS_RECEIVED_DEFAULT },
    seeking: { type: String, enum: [...SEEKING, null], default: null },
    linkedinUrl: { type: String, default: null },
    discoverable: { type: Boolean, required: true },
    employerVisible: { type: Boolean, required: true },
    consentVersions: {
      network_discovery: { type: Number, default: null },
      employer_visibility: { type: Number, default: null },
    },
    refreshedAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
profileSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
profileSchema.index({ tenantId: 1, ref: 1 }, { unique: true });
profileSchema.index({ tenantId: 1, discoverable: 1, kind: 1, companyKey: 1 });
profileSchema.index({ tenantId: 1, employerVisible: 1, gradYear: 1, branch: 1 });
export const NetworkProfileModel = defineTenantModel('NetworkProfile', profileSchema);
export type NetworkProfileDoc = InferSchemaType<typeof profileSchema>;
/** The fields another college may read (N14). */
export const NETWORK_PUBLIC_FIELDS =
  'ref name branch gradYear company roleTitle city skills helpWith linkedinUrl tenantId' as const;

/**
 * A student shared their résumé and readiness with one employer's posting (N10): no contact field.
 */
const candidacySchema = new Schema(
  {
    ref: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    driveId: { type: Schema.Types.ObjectId, required: true },
    employerTenantId: { type: Schema.Types.ObjectId, required: true },
    postingRef: { type: String, required: true },
    name: { type: String, required: true },
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    gradYear: { type: Number, default: null },
    resumeFileId: { type: Schema.Types.ObjectId, default: null },
    stage: { type: String, enum: CANDIDACY_STAGES, required: true },
    sharedAt: { type: Date, required: true },
    withdrawnAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
candidacySchema.index({ tenantId: 1, postingRef: 1, userId: 1 }, { unique: true });
candidacySchema.index({ tenantId: 1, ref: 1 }, { unique: true });
candidacySchema.index({ tenantId: 1, employerTenantId: 1, postingRef: 1, stage: 1 });
candidacySchema.index({ tenantId: 1, userId: 1 });
export const NetworkCandidacyModel = defineTenantModel('NetworkCandidacy', candidacySchema);
export type NetworkCandidacyDoc = InferSchemaType<typeof candidacySchema>;
/** The fields an employer may read (N14). */
export const CANDIDACY_EMPLOYER_FIELDS =
  'ref name branch gradYear stage resumeFileId sharedAt postingRef tenantId' as const;

/** An intro received by an alumnus (stored in the alumnus's college). Same `_id` as the sender's copy. */
const introSchema = new Schema(
  {
    toUserId: { type: Schema.Types.ObjectId, required: true },
    fromTenantId: { type: Schema.Types.ObjectId, required: true },
    fromRef: { type: String, required: true },
    fromName: { type: String, required: true },
    fromBranch: { type: String, enum: [...BRANCHES, null], default: null },
    fromGradYear: { type: Number, default: null },
    helpWith: { type: String, enum: SESSION_TYPES, required: true },
    goal: { type: String, enum: INTRO_GOALS, required: true },
    note: { type: String, default: '', maxlength: 300 },
    status: { type: String, enum: INTRO_STATUSES, required: true },
    declineReason: { type: String, enum: [...INTRO_DECLINE_REASONS, null], default: null },
    reportedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    answeredAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
introSchema.index({ tenantId: 1, toUserId: 1, _id: -1 });
introSchema.index({ tenantId: 1, status: 1, expiresAt: 1 });
introSchema.index({ tenantId: 1, fromTenantId: 1, fromRef: 1 });
export const NetworkIntroModel = defineTenantModel('NetworkIntro', introSchema);
export type NetworkIntroDoc = InferSchemaType<typeof introSchema> & { _id: Schema.Types.ObjectId };

/** The sender's copy (stored in the student's college). */
const introOutSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    toTenantId: { type: Schema.Types.ObjectId, required: true },
    toRef: { type: String, required: true },
    toName: { type: String, required: true },
    toCompany: { type: String, default: null },
    helpWith: { type: String, enum: SESSION_TYPES, required: true },
    goal: { type: String, enum: INTRO_GOALS, required: true },
    status: { type: String, enum: INTRO_STATUSES, required: true },
    declineReason: { type: String, enum: [...INTRO_DECLINE_REASONS, null], default: null },
    /** What the alumnus chose to share on accepting (FieldCipher; ENCRYPTED_COLLECTIONS). */
    sharedContactEnc: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    answeredAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
introOutSchema.index({ tenantId: 1, userId: 1, _id: -1 });
introOutSchema.index({ tenantId: 1, userId: 1, toTenantId: 1, toRef: 1, _id: -1 });
introOutSchema.index({ tenantId: 1, status: 1, expiresAt: 1 });
export const NetworkIntroOutModel = defineTenantModel('NetworkIntroOut', introOutSchema);
export type NetworkIntroOutDoc = InferSchemaType<typeof introOutSchema> & { _id: Schema.Types.ObjectId };

/** A named group of colleges employers may post to (platform-defined; no personal data). */
const clusterSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    colleges: { type: [Schema.Types.ObjectId], default: [] },
  },
  baseSchemaOptions,
);
export const NetworkClusterModel = definePlatformModel('NetworkCluster', clusterSchema);
