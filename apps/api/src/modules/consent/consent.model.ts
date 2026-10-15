import { Schema, type InferSchemaType } from 'mongoose';
import { CONSENT_PURPOSE_KEYS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** Versioned consent events. Current state = latest event per purpose; history is never rewritten. */
const consentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    purpose: { type: String, enum: CONSENT_PURPOSE_KEYS, required: true },
    version: { type: Number, required: true },
    noticeVersion: { type: String, required: true },
    granted: { type: Boolean, required: true },
    source: { type: String, enum: ['signup', 'settings', 'admin_import'], required: true },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
consentSchema.index({ tenantId: 1, userId: 1, purpose: 1, _id: -1 });
consentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function () {
  throw new Error('Consent records are append-only');
});

export type ConsentRecord = InferSchemaType<typeof consentSchema>;
export const ConsentModel = defineTenantModel('Consent', consentSchema);
