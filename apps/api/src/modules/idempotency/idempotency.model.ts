import { Schema, type InferSchemaType } from 'mongoose';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** Replay store for `Idempotency-Key` (24 hours). Responses here never include secrets. */
const schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    state: { type: String, enum: ['pending', 'done'], default: 'pending' },
    status: { type: Number, default: null },
    response: { type: Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
schema.index({ tenantId: 1, userId: 1, key: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type IdempotencyDoc = InferSchemaType<typeof schema>;
export const IdempotencyModel = defineTenantModel('IdempotencyRecord', schema);
