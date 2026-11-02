import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { BRANCHES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * A personal invite link for one roster record (B4). The token is 256 random bits, kept only as a
 * hash, single use; accepting it sends a code to the contact on the record, never to one typed in.
 */
const inviteLinkSchema = new Schema(
  {
    whitelistId: { type: Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    channel: { type: String, enum: ['whatsapp', 'csv'], required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    usedBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
inviteLinkSchema.index({ tenantId: 1, tokenHash: 1 }, { unique: true });
inviteLinkSchema.index({ tenantId: 1, whitelistId: 1, createdAt: -1 });
export type InviteLinkDoc = InferSchemaType<typeof inviteLinkSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const InviteLinkModel = defineTenantModel('InviteLink', inviteLinkSchema);

/** A class join code for a poster or a WhatsApp group (B4): the roll number then finds the record. */
const joinCodeSchema = new Schema(
  {
    code: { type: String, required: true },
    kind: { type: String, enum: ['student', 'alumni'], required: true },
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    gradYear: { type: Number, default: null },
    expiresAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    uses: { type: Number, default: 0 },
    revokedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
joinCodeSchema.index({ tenantId: 1, code: 1 }, { unique: true });
joinCodeSchema.index({ tenantId: 1, _id: -1 });
export type JoinCodeDoc = InferSchemaType<typeof joinCodeSchema> & { _id: Types.ObjectId; createdAt: Date };
export const JoinCodeModel = defineTenantModel('JoinCode', joinCodeSchema);
