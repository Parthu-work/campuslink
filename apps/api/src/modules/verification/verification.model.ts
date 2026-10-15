import { Schema } from 'mongoose';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** Short-lived OTP challenge (roll-number claim or company email). Code stored as a hash only. */
const challengeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    purpose: { type: String, enum: ['roll_claim', 'company_email'], required: true },
    targetId: { type: Schema.Types.ObjectId, default: null },
    company: { name: String, domain: String },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    /** Kept 24 h (for the daily cap), then deleted by TTL. */
    purgeAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
challengeSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
challengeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
export const OtpChallengeModel = defineTenantModel('OtpChallenge', challengeSchema);

const requestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    method: { type: String, enum: ['id_card'], required: true },
    rollNumber: { type: String, required: true },
    gradYear: { type: Number, default: null },
    note: { type: String, default: '' },
    fileId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewerId: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, default: null },
    decidedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
requestSchema.index({ tenantId: 1, status: 1, _id: -1 });
requestSchema.index({ tenantId: 1, userId: 1, status: 1 });
export const VerificationRequestModel = defineTenantModel('VerificationRequest', requestSchema);

/** Admin invitation by email. Accepting = confirming that email at sign-up. */
const inviteSchema = new Schema(
  {
    emailIndex: { type: String, required: true },
    kind: { type: String, enum: ['student', 'alumni'], default: null },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
    acceptedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
inviteSchema.index({ tenantId: 1, emailIndex: 1 }, { unique: true });
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const InviteModel = defineTenantModel('Invite', inviteSchema);
