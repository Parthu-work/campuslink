import { Schema } from 'mongoose';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

export const OTP_PURPOSES = [
  'roll_claim',
  'company_email',
  'phone_signup',
  'phone_login',
  'phone_change',
  'guardian_consent',
] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/**
 * Short-lived one-time code (roll-number claim, company email, phone sign-up and sign-in, phone
 * change, guardian consent). The code is stored as a hash only.
 */
const challengeSchema = new Schema(
  {
    /** Null for a phone sign-up (the account does not exist yet). */
    userId: { type: Schema.Types.ObjectId, default: null },
    purpose: { type: String, enum: OTP_PURPOSES, required: true },
    targetId: { type: Schema.Types.ObjectId, default: null },
    company: { name: String, domain: String },
    /** The number the code went to (blind index for the per-phone cap; encrypted for sign-up). */
    phoneIndex: { type: String, default: null },
    phoneEnc: { type: String, default: null },
    /** Phone change: the new number, carried from the old-number step to the new-number step. */
    nextPhoneEnc: { type: String, default: null },
    step: { type: String, enum: ['old', 'new', null], default: null },
    channel: { type: String, enum: ['whatsapp', 'sms', 'email', null], default: null },
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
challengeSchema.index({ tenantId: 1, phoneIndex: 1, createdAt: -1 });
challengeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
export const OtpChallengeModel = defineTenantModel('OtpChallenge', challengeSchema);

const requestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    /** `guardian_manual`: a minor's guardian number for the college to check (no roster number). */
    method: { type: String, enum: ['id_card', 'guardian_manual'], required: true },
    rollNumber: { type: String, required: true },
    gradYear: { type: Number, default: null },
    note: { type: String, default: '' },
    fileId: { type: Schema.Types.ObjectId, default: null },
    guardianPhoneEnc: { type: String, default: null },
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
