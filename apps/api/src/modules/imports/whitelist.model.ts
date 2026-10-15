import { Schema, type InferSchemaType } from 'mongoose';
import { BRANCHES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * The college's verification list (from imports, manual adds and invites).
 * Email and phone are AES-GCM encrypted; *Index fields are blind indexes for equality lookups.
 */
const whitelistSchema = new Schema(
  {
    rollNumber: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    gradYear: { type: Number, default: null },
    kind: { type: String, enum: ['student', 'alumni'], required: true },
    emailEnc: { type: String, default: null },
    emailIndex: { type: String, default: null },
    phoneEnc: { type: String, default: null },
    phoneIndex: { type: String, default: null },
    status: { type: String, enum: ['unclaimed', 'claimed'], default: 'unclaimed' },
    claimedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    claimedAt: { type: Date, default: null },
    source: { type: String, enum: ['import', 'manual', 'invite'], required: true },
    lastImportJobId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
whitelistSchema.index({ tenantId: 1, rollNumber: 1 }, { unique: true });
whitelistSchema.index({ tenantId: 1, emailIndex: 1 });
whitelistSchema.index({ tenantId: 1, status: 1, _id: -1 });
whitelistSchema.index({ tenantId: 1, claimedBy: 1 });

export type WhitelistRecord = InferSchemaType<typeof whitelistSchema>;
export const WhitelistModel = defineTenantModel('WhitelistRecord', whitelistSchema);
