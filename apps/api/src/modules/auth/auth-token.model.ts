import { Schema, type InferSchemaType } from 'mongoose';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** Single-use, short-lived tokens for email verification and password reset (hash only). */
const authTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    purpose: { type: String, enum: ['email_verify', 'password_reset'], required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
authTokenSchema.index({ tenantId: 1, tokenHash: 1 }, { unique: true });
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthToken = InferSchemaType<typeof authTokenSchema>;
export const AuthTokenModel = defineTenantModel('AuthToken', authTokenSchema);
