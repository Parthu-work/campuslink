import { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ROLES, CAPABILITIES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true, select: false },
    roles: { type: [String], enum: ROLES, required: true },
    capabilities: { type: [String], enum: CAPABILITIES, default: [] },
    /** `deleting`: the member asked for erasure; it runs after the college's grace period. */
    status: { type: String, enum: ['active', 'suspended', 'deleting'], default: 'active', required: true },
    deletionRequestedAt: { type: Date, default: null },
    deletionPurgeAt: { type: Date, default: null },
    /** College verification (roll number / ID) — completed in Phase 2. */
    verified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },
    ageDeclaredAt: { type: Date, required: true },
    locale: { type: String, enum: ['en', 'te'], default: 'en' },
    /** Encrypted with FieldCipher; phoneIndex is a blind index for lookups. */
    phoneEnc: { type: String, default: null, select: false },
    phoneIndex: { type: String, default: null },
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
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, roles: 1, _id: -1 });
userSchema.index({ tenantId: 1, name: 'text', email: 'text' }, { name: 'user_search' });
userSchema.index({ tenantId: 1, status: 1, deletionPurgeAt: 1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = defineTenantModel('User', userSchema);
