import { Schema, type InferSchemaType } from 'mongoose';
import {
  BILLABLE_KINDS,
  BRANCHES,
  POSTING_DECISIONS,
  POSTING_DECLINE_REASONS,
  POSTING_STATUSES,
  POSTING_TYPES,
} from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/**
 * The recruiter portal (prompt 2, G12, ADR 0014 §9 to §11). `Posting`, `BillableEvent` and
 * `EmployerUsage` live in the employer's tenant; `PostingOffer` is the copy each college receives
 * (the posting's text only, no personal data) and decides on.
 */

const postingFields = {
  title: { type: String, required: true, maxlength: 120 },
  role: { type: String, required: true, maxlength: 120 },
  type: { type: String, enum: POSTING_TYPES, required: true },
  location: { type: String, required: true, maxlength: 120 },
  ctcRange: { type: String, default: '', maxlength: 60 },
  description: { type: String, required: true, maxlength: 4000 },
  branches: { type: [{ type: String, enum: BRANCHES }], default: [] },
  gradYears: { type: [Number], default: [] },
  closesAt: { type: Date, required: true },
};

const postingSchema = new Schema(
  {
    /** Random 128-bit id: what colleges and candidacies refer to. */
    ref: { type: String, required: true },
    ...postingFields,
    status: { type: String, enum: POSTING_STATUSES, default: 'draft' },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    publishedAt: { type: Date, default: null },
    colleges: {
      type: [
        new Schema(
          {
            tenantId: { type: Schema.Types.ObjectId, required: true },
            decision: { type: String, enum: POSTING_DECISIONS, default: 'pending' },
            declineReason: { type: String, enum: [...POSTING_DECLINE_REASONS, null], default: null },
            decidedAt: { type: Date, default: null },
          },
          { _id: false, strict: 'throw' },
        ),
      ],
      default: [],
    },
  },
  baseSchemaOptions,
);
postingSchema.index({ tenantId: 1, ref: 1 }, { unique: true });
postingSchema.index({ tenantId: 1, status: 1, _id: -1 });
postingSchema.index({ tenantId: 1, publishedAt: -1 });
export const PostingModel = defineTenantModel('Posting', postingSchema);
export type PostingDoc = InferSchemaType<typeof postingSchema> & { _id: Schema.Types.ObjectId };

const offerSchema = new Schema(
  {
    employerTenantId: { type: Schema.Types.ObjectId, required: true },
    employerName: { type: String, required: true },
    postingRef: { type: String, required: true },
    ...postingFields,
    decision: { type: String, enum: POSTING_DECISIONS, default: 'pending' },
    declineReason: { type: String, enum: [...POSTING_DECLINE_REASONS, null], default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    /** The drive the approval created (B7). */
    driveId: { type: Schema.Types.ObjectId, default: null },
    /** Members who reported the posting; three hide it until a moderator decides (N28). */
    reportedBy: { type: [Schema.Types.ObjectId], default: [] },
    hiddenAt: { type: Date, default: null },
    offeredAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
offerSchema.index({ tenantId: 1, employerTenantId: 1, postingRef: 1 }, { unique: true });
offerSchema.index({ tenantId: 1, decision: 1, _id: -1 });
offerSchema.index({ tenantId: 1, driveId: 1 });
export const PostingOfferModel = defineTenantModel('PostingOffer', offerSchema);
export type PostingOfferDoc = InferSchemaType<typeof offerSchema> & { _id: Schema.Types.ObjectId };

/** A billable moment, unique per key so a retry never charges twice (§11). No member data. */
const billableSchema = new Schema(
  {
    kind: { type: String, enum: BILLABLE_KINDS, required: true },
    key: { type: String, required: true },
    postingRef: { type: String, required: true },
    collegeTenantId: { type: Schema.Types.ObjectId, default: null },
    /** Whole paise, at the price in force when it happened. */
    amount: { type: Number, required: true },
    revenueShareBps: { type: Number, required: true },
    at: { type: Date, required: true },
  },
  baseSchemaOptions,
);
billableSchema.index({ tenantId: 1, key: 1 }, { unique: true });
billableSchema.index({ tenantId: 1, at: -1 });
billableSchema.index({ tenantId: 1, collegeTenantId: 1, at: -1 });
export const BillableEventModel = defineTenantModel('BillableEvent', billableSchema);

/** Per-employer counters for the limits in EMPLOYER_LIMITS (N26); one document per kind and window. */
const usageSchema = new Schema(
  {
    kind: { type: String, required: true },
    window: { type: String, required: true },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
usageSchema.index({ tenantId: 1, kind: 1, window: 1 }, { unique: true });
usageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const EmployerUsageModel = defineTenantModel('EmployerUsage', usageSchema);
