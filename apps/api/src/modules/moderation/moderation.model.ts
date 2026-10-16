import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { CONTENT_TARGETS, REMOVAL_REASONS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** Append-only record of every moderation decision (updates and deletes are refused). */
const actionSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, required: true },
    targetType: { type: String, enum: CONTENT_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    subjectUserId: { type: Schema.Types.ObjectId, default: null },
    action: {
      type: String,
      enum: ['remove', 'restore', 'approve', 'reject', 'publish', 'appeal_upheld', 'appeal_reversed'],
      required: true,
    },
    reason: { type: String, enum: [...REMOVAL_REASONS, null], default: null },
    note: { type: String, default: '', maxlength: 500 },
    reportId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
actionSchema.index({ tenantId: 1, targetType: 1, targetId: 1, _id: -1 });
actionSchema.index({ tenantId: 1, _id: -1 });
const refuse = function () {
  throw new Error('moderationActions is append-only');
};
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndReplace',
] as const)
  actionSchema.pre(op, refuse);
export const ModerationActionModel = defineTenantModel('ModerationAction', actionSchema);

/** One appeal per removed item, decided by a moderator. */
const appealSchema = new Schema(
  {
    targetType: { type: String, enum: CONTENT_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    message: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['open', 'upheld', 'reversed'], default: 'open' },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decisionNote: { type: String, default: null, maxlength: 500 },
    decidedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
appealSchema.index({ tenantId: 1, targetType: 1, targetId: 1 }, { unique: true });
appealSchema.index({ tenantId: 1, status: 1, _id: -1 });
export type AppealDoc = InferSchemaType<typeof appealSchema> & { _id: Types.ObjectId; createdAt: Date };
export const AppealModel = defineTenantModel('Appeal', appealSchema);
