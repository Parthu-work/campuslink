import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { AI_USAGE_KINDS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * Tokens used per college, member (null for background work such as embeddings), day, kind and
 * model: the monthly budget, per-member limits and the admin dashboard read these counters.
 */
const aiUsageSchema = new Schema(
  {
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    userId: { type: Schema.Types.ObjectId, default: null },
    kind: { type: String, enum: AI_USAGE_KINDS, required: true },
    /** `provider:model`. */
    model: { type: String, required: true, maxlength: 160 },
    requests: { type: Number, default: 0 },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);
aiUsageSchema.index({ tenantId: 1, day: 1, userId: 1, kind: 1, model: 1 }, { unique: true });
aiUsageSchema.index({ tenantId: 1, userId: 1, day: 1 });
export type AiUsageDoc = InferSchemaType<typeof aiUsageSchema> & { _id: Types.ObjectId };
export const AiUsageModel = defineTenantModel('AiUsage', aiUsageSchema);
