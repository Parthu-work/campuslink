import { Schema, type InferSchemaType } from 'mongoose';
import { CREDENTIAL_REVOKE_REASONS, CREDENTIAL_STATUSES, CREDENTIAL_TYPES } from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/**
 * Verified credentials (prompt 2, G12, ADR 0014 §12). One Ed25519 issuer key pair per college,
 * the private key encrypted with the field cipher (`privateKeyEnc`, ENCRYPTED_COLLECTIONS).
 */
const issuerKeySchema = new Schema(
  {
    /** JWK thumbprint of the public key. */
    kid: { type: String, required: true },
    publicJwk: { type: Schema.Types.Mixed, required: true },
    /** PKCS#8 PEM, encrypted (FieldCipher). Decrypted only in CredentialsService.sign(). */
    privateKeyEnc: { type: String, required: true, select: false },
    status: { type: String, enum: ['active', 'retired', 'compromised'], required: true },
    retiredAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
issuerKeySchema.index({ tenantId: 1, kid: 1 }, { unique: true });
issuerKeySchema.index({ tenantId: 1, status: 1, _id: -1 });
export const IssuerKeyModel = defineTenantModel('IssuerKey', issuerKeySchema);

const credentialSchema = new Schema(
  {
    /** Random 128-bit id: the public URL. */
    publicId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, default: null },
    type: { type: String, enum: CREDENTIAL_TYPES, required: true },
    /** The record it attests (an offer, a certificate, a recognition); null for a readiness milestone. */
    sourceId: { type: String, default: null },
    milestone: { type: Number, default: null },
    /** The subject's name as issued, and the claims (deleted on erasure: only the status stays). */
    name: { type: String, default: null },
    claims: { type: Schema.Types.Mixed, default: null },
    jwt: { type: String, default: null },
    kid: { type: String, required: true },
    /** Index in the college's W3C Bitstring Status List, assigned at random. */
    statusIndex: { type: Number, required: true },
    status: { type: String, enum: CREDENTIAL_STATUSES, default: 'active' },
    revokedReason: { type: String, enum: [...CREDENTIAL_REVOKE_REASONS, null], default: null },
    revokedAt: { type: Date, default: null },
    issuedAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
credentialSchema.index({ tenantId: 1, publicId: 1 }, { unique: true });
credentialSchema.index({ tenantId: 1, statusIndex: 1 }, { unique: true });
credentialSchema.index({ tenantId: 1, userId: 1, type: 1, sourceId: 1, milestone: 1 });
credentialSchema.index({ tenantId: 1, status: 1, kid: 1 });
export const CredentialModel = defineTenantModel('Credential', credentialSchema);
export type CredentialDoc = InferSchemaType<typeof credentialSchema> & { _id: Schema.Types.ObjectId };
