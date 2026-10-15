import { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * One document per signed-in device = one refresh-token family. Only SHA-256 hashes of refresh
 * tokens are stored. Presenting a hash from `usedTokenHashes` means a token was replayed:
 * the whole session is revoked (theft detection, ADR 0004).
 */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    currentTokenHash: { type: String, required: true },
    usedTokenHashes: { type: [String], default: [] },
    device: { type: String, default: 'Unknown device', maxlength: 80 },
    createdIpPrefix: { type: String, default: null },
    lastUsedAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  baseSchemaOptions,
);
sessionSchema.index({ tenantId: 1, currentTokenHash: 1 }, { unique: true });
sessionSchema.index({ tenantId: 1, usedTokenHashes: 1 });
sessionSchema.index({ tenantId: 1, userId: 1, revokedAt: 1 });
// Hard-delete sessions 30 days after they expire (retention policy).
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export type SessionDoc = HydratedDocument<InferSchemaType<typeof sessionSchema>>;
export const SessionModel = defineTenantModel('Session', sessionSchema);
