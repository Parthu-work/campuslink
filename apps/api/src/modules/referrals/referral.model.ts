import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { REFERRAL_DECLINE_TEMPLATES, REFERRAL_STATUSES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** An alumnus's referral settings. Off by default: nobody is asked until they opt in. */
const prefsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    accepting: { type: Boolean, default: false },
    weeklyCap: { type: Number, default: 3, min: 1, max: 20 },
    note: { type: String, default: '', maxlength: 300 },
  },
  baseSchemaOptions,
);
prefsSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
prefsSchema.index({ tenantId: 1, accepting: 1, userId: 1 });
export type ReferralPrefsDoc = InferSchemaType<typeof prefsSchema> & { _id: Types.ObjectId };
export const ReferralPrefsModel = defineTenantModel('ReferralPrefs', prefsSchema);

/** A request to be referred for one job by one alumnus. */
const requestSchema = new Schema(
  {
    requesterId: { type: Schema.Types.ObjectId, required: true },
    referrerId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, required: true },
    /** Snapshot so the request still reads well after the listing ends. */
    jobTitle: { type: String, required: true },
    company: { type: String, required: true },
    why: { type: String, required: true, maxlength: 800 },
    resumeFileId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: REFERRAL_STATUSES, default: 'pending' },
    declineTemplate: { type: String, enum: [...REFERRAL_DECLINE_TEMPLATES, null], default: null },
    responseNote: { type: String, default: null, maxlength: 300 },
    respondedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
requestSchema.index(
  { tenantId: 1, requesterId: 1, referrerId: 1, jobId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'one_pending_referral' },
);
requestSchema.index({ tenantId: 1, referrerId: 1, status: 1, _id: -1 });
requestSchema.index({ tenantId: 1, requesterId: 1, status: 1, _id: -1 });
requestSchema.index({ tenantId: 1, referrerId: 1, createdAt: -1 });
requestSchema.index({ tenantId: 1, requesterId: 1, createdAt: -1 });
requestSchema.index({ tenantId: 1, resumeFileId: 1 }, { sparse: true });
export type ReferralDoc = InferSchemaType<typeof requestSchema> & { _id: Types.ObjectId; createdAt: Date };
export const ReferralRequestModel = defineTenantModel('ReferralRequest', requestSchema);
