import { Schema, type InferSchemaType } from 'mongoose';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** Preview: normalised rows parked in storage until the admin starts (or abandons) the import. */
const previewSchema = new Schema(
  {
    createdBy: { type: Schema.Types.ObjectId, required: true },
    sourceKind: { type: String, enum: ['csv', 'xlsx', 'gsheet', 'rest'], required: true },
    sourceLabel: { type: String, required: true, maxlength: 200 },
    fileId: { type: Schema.Types.ObjectId, required: true },
    headers: { type: [String], default: [] },
    totalRows: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
previewSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
previewSchema.index({ tenantId: 1, createdBy: 1 });
export const ImportPreviewModel = defineTenantModel('ImportPreview', previewSchema);

const changeSchema = new Schema(
  {
    recordId: Schema.Types.ObjectId,
    op: { type: String, enum: ['create', 'update'] },
    before: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false, strict: 'throw' },
);

const jobSchema = new Schema(
  {
    createdBy: { type: Schema.Types.ObjectId, required: true },
    sourceKind: { type: String, enum: ['csv', 'xlsx', 'gsheet', 'rest'], required: true },
    sourceLabel: { type: String, required: true },
    fileId: { type: Schema.Types.ObjectId, default: null },
    mapping: { type: Schema.Types.Mixed, required: true },
    dryRun: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed', 'rolled_back'],
      default: 'queued',
    },
    progress: { type: Number, default: 0 },
    counts: {
      total: { type: Number, default: 0 },
      created: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      unchanged: { type: Number, default: 0 },
      skippedClaimed: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
    },
    /** Row-level problems. Never contains cell values (data minimisation, CSV-injection safety). */
    rowErrors: { type: [{ row: Number, field: String, message: String, _id: false }], default: [] },
    changes: { type: [changeSchema], default: [], select: false },
    failureReason: { type: String, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    rollback: {
      at: { type: Date, default: null },
      by: { type: Schema.Types.ObjectId, default: null },
      restored: Number,
      removed: Number,
      keptClaimed: Number,
    },
  },
  baseSchemaOptions,
);
jobSchema.index({ tenantId: 1, _id: -1 });
jobSchema.index({ tenantId: 1, status: 1 });

export type ImportJob = InferSchemaType<typeof jobSchema>;
export const ImportJobModel = defineTenantModel('ImportJob', jobSchema);
