import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { REPORT_REASONS, REPORT_TARGETS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

const blockSchema = new Schema(
  {
    blockerId: { type: Schema.Types.ObjectId, required: true },
    blockedId: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
blockSchema.index({ tenantId: 1, blockerId: 1, blockedId: 1 }, { unique: true });
blockSchema.index({ tenantId: 1, blockedId: 1 });
export const BlockModel = defineTenantModel('Block', blockSchema);

/**
 * A report. For messages and requests it keeps a snapshot of the reported text, so moderators
 * review exactly what was reported and never browse private conversations.
 */
const reportSchema = new Schema(
  {
    reporterId: { type: Schema.Types.ObjectId, required: true },
    targetType: { type: String, enum: REPORT_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    subjectUserId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    note: { type: String, default: '', maxlength: 500 },
    snapshot: { type: String, default: null, maxlength: 2500 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    outcome: { type: String, enum: ['actioned', 'dismissed', null], default: null },
    resolvedBy: { type: Schema.Types.ObjectId, default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: null, maxlength: 500 },
  },
  baseSchemaOptions,
);
reportSchema.index(
  { tenantId: 1, reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' }, name: 'one_open_report' },
);
reportSchema.index({ tenantId: 1, status: 1, _id: -1 });
export type ReportDoc = InferSchemaType<typeof reportSchema> & { _id: Types.ObjectId; createdAt: Date };
export const ReportModel = defineTenantModel('Report', reportSchema);
