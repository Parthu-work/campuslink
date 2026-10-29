import { Schema, type InferSchemaType } from 'mongoose';
import { CONSENT_PURPOSE_KEYS, GUARDIAN_CONSENT } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** Versioned consent events. Current state = latest event per purpose; history is never rewritten. */
const consentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    purpose: { type: String, enum: [...CONSENT_PURPOSE_KEYS, GUARDIAN_CONSENT.purpose], required: true },
    version: { type: Number, required: true },
    noticeVersion: { type: String, required: true },
    granted: { type: Boolean, required: true },
    source: { type: String, enum: ['signup', 'settings', 'admin_import', 'guardian'], required: true },
    /**
     * Guardian consent only: how it was verified (the roster record whose guardian number got the
     * code, the declaration's language and the channel). The guardian's number itself is not kept.
     */
    evidence: {
      type: {
        whitelistId: Schema.Types.ObjectId,
        language: String,
        channel: String,
        _id: false,
      },
      default: null,
    },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
consentSchema.index({ tenantId: 1, userId: 1, purpose: 1, _id: -1 });
consentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function () {
  throw new Error('Consent records are append-only');
});

export type ConsentRecord = InferSchemaType<typeof consentSchema>;
export const ConsentModel = defineTenantModel('Consent', consentSchema);
