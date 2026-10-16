import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { BRANCHES, JOB_SOURCE_KINDS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** A college's job source: one ATS board, an Adzuna search, or an RSS/Atom feed. */
const sourceSchema = new Schema(
  {
    kind: { type: String, enum: JOB_SOURCE_KINDS, required: true },
    name: { type: String, required: true, maxlength: 80 },
    board: { type: String, default: null },
    query: { type: String, default: null },
    where: { type: String, default: null },
    url: { type: String, default: null },
    /** Display and uniqueness: board path, query or URL. */
    target: { type: String, required: true },
    /** Company name for boards and feeds that don't name it per posting. */
    company: { type: String, default: '' },
    branches: { type: [{ type: String, enum: BRANCHES }], default: [] },
    /** Keep only postings in India (boards often list worldwide). */
    indiaOnly: { type: Boolean, default: true },
    intervalMin: { type: Number, default: 720 },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    starterKey: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    etag: { type: String, default: null },
    lastModified: { type: String, default: null },
    nextFetchAt: { type: Date, default: () => new Date() },
    lastFetchedAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 300 },
    lastOutcome: { type: String, enum: ['ok', 'not_modified', 'blocked', 'error', null], default: null },
    consecutiveFailures: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);
sourceSchema.index({ tenantId: 1, kind: 1, target: 1 }, { unique: true });
sourceSchema.index({ tenantId: 1, status: 1, nextFetchAt: 1 });
export type JobSourceDoc = InferSchemaType<typeof sourceSchema> & { _id: Types.ObjectId; createdAt: Date };
export const JobSourceModel = defineTenantModel('JobSource', sourceSchema);
