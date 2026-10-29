import { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ROLES, CAPABILITIES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

const userSchema = new Schema(
  {
    /** Optional since phone sign-up (B2); unique per college where present. */
    email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** Absent for members who signed up by phone (they sign in with one-time codes). */
    passwordHash: { type: String, select: false },
    roles: { type: [String], enum: ROLES, required: true },
    capabilities: { type: [String], enum: CAPABILITIES, default: [] },
    /** `deleting`: the member asked for erasure; it runs after the college's grace period. */
    /**
     * `guardian_pending`: under 18 and waiting for a guardian's consent (only verification and the
     * guardian step work).
     */
    status: {
      type: String,
      enum: ['active', 'guardian_pending', 'suspended', 'deleting'],
      default: 'active',
      required: true,
    },
    deletionRequestedAt: { type: Date, default: null },
    deletionPurgeAt: { type: Date, default: null },
    /** College verification (roll number / ID) — completed in Phase 2. */
    verified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },
    /** When the member's age was checked (a birth month at sign-up; before B2 a declaration). */
    ageCheckedAt: { type: Date, required: true },
    /**
     * For a member under 18 only: the first day they are certainly 18 (from the birth month, which
     * is not stored). Null means an adult; the daily job clears it once the day has passed, so an
     * adult's age is never kept (data minimisation).
     */
    adultOn: { type: Date, default: null },
    /** When a guardian confirmed consent for this member (DPDP Rules 2025, Rule 10). */
    guardianConsentAt: { type: Date, default: null },
    locale: { type: String, enum: ['en', 'te'], default: 'en' },
    /** Encrypted with FieldCipher; phoneIndex is a blind index for lookups. */
    phoneEnc: { type: String, default: null, select: false },
    phoneIndex: { type: String, default: null },
    phoneVerifiedAt: { type: Date, default: null },
    /** The member chose SMS over WhatsApp for codes (null: WhatsApp first). */
    otpChannel: { type: String, enum: ['whatsapp', 'sms', null], default: null },
    mfa: {
      enabled: { type: Boolean, default: false },
      secretEnc: { type: String, default: null, select: false },
      pendingSecretEnc: { type: String, default: null, select: false },
      lastTimeStep: { type: Number, default: 0, select: false },
      recoveryCodeHashes: { type: [String], default: [], select: false },
    },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    /** Bumped on password change, suspension or role change to invalidate outstanding access tokens. */
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
userSchema.index(
  { tenantId: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
userSchema.index(
  { tenantId: 1, phoneIndex: 1 },
  { unique: true, partialFilterExpression: { phoneIndex: { $type: 'string' } } },
);
userSchema.index({ tenantId: 1, adultOn: 1 });
userSchema.index({ tenantId: 1, roles: 1, _id: -1 });
userSchema.index({ tenantId: 1, name: 'text', email: 'text' }, { name: 'user_search' });
userSchema.index({ tenantId: 1, status: 1, deletionPurgeAt: 1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = defineTenantModel('User', userSchema);
