import { Schema, type InferSchemaType, type MongooseQueryMiddleware } from 'mongoose';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * Append-only audit log. Every update/delete path throws; retention purge (if ever needed) must be
 * done by an operator with database credentials, never by the application.
 */
const auditSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true, maxlength: 60 },
    targetType: { type: String, default: null, maxlength: 40 },
    targetId: { type: String, default: null, maxlength: 40 },
    /** Non-personal metadata only (ids, enum values, counts). */
    meta: { type: Schema.Types.Mixed, default: {} },
    requestId: { type: String, default: null },
    ipPrefix: { type: String, default: null },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ tenantId: 1, _id: -1 });
auditSchema.index({ tenantId: 1, action: 1, _id: -1 });

const IMMUTABLE_OPS: MongooseQueryMiddleware[] = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];
auditSchema.pre(IMMUTABLE_OPS, { document: false, query: true }, function () {
  throw new Error('Audit log is append-only');
});
auditSchema.pre('save', function () {
  if (!this.isNew) throw new Error('Audit log is append-only');
});

export type AuditEntry = InferSchemaType<typeof auditSchema>;
export const AuditModel = defineTenantModel('AuditLog', auditSchema);
