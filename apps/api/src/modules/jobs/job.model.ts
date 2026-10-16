import { Schema, type InferSchemaType, type Types } from 'mongoose';
import {
  BRANCHES,
  JOB_LEVELS,
  JOB_MODES,
  JOB_SOURCE_KINDS,
  JOB_TYPES,
  TRACK_STATUSES,
} from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';
import { removalFragment } from '../../db/fragments.js';

/** An opening: posted in the app by a member, or imported from a job source. */
const jobSchema = new Schema(
  {
    origin: { type: String, enum: ['posted', ...JOB_SOURCE_KINDS], required: true },
    sourceId: { type: Schema.Types.ObjectId, default: null },
    externalId: { type: String, default: null },
    postedBy: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, maxlength: 160 },
    company: { type: String, required: true, maxlength: 100 },
    companyKey: { type: String, required: true },
    location: { type: String, default: '', maxlength: 160 },
    mode: { type: String, enum: [...JOB_MODES, null], default: null },
    type: { type: String, enum: JOB_TYPES, default: 'full_time' },
    level: { type: String, enum: [...JOB_LEVELS, null], default: null },
    skills: { type: [String], default: [] },
    /** Lowercased skills for filtering. */
    skillKeys: { type: [String], default: [] },
    branches: { type: [{ type: String, enum: BRANCHES }], default: [] },
    salary: {
      type: { min: Number, max: Number, currency: String, period: { type: String, enum: ['year', 'month'] } },
      default: null,
    },
    applyUrl: { type: String, required: true },
    /** Plain text: the poster's own words, or a snippet of an imported posting. */
    description: { type: String, default: '', maxlength: 5000 },
    freshersOk: { type: Boolean, default: false },
    postedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: null },
    status: { type: String, enum: ['open', 'closed', 'expired', 'removed'], default: 'open' },
    removal: removalFragment,
    dedupeKey: { type: String, required: true },
    /** Deleted from the database this long after the listing ends (TTL). */
    purgeAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
jobSchema.index({ tenantId: 1, dedupeKey: 1 }, { unique: true });
jobSchema.index({ tenantId: 1, status: 1, expiresAt: 1, _id: -1 });
jobSchema.index({ tenantId: 1, sourceId: 1, status: 1 });
jobSchema.index({ tenantId: 1, postedBy: 1, _id: -1 });
jobSchema.index({ tenantId: 1, companyKey: 1, status: 1 });
jobSchema.index({ tenantId: 1, status: 1, skillKeys: 1 });
jobSchema.index(
  { tenantId: 1, title: 'text', company: 'text', skills: 'text', description: 'text' },
  { name: 'job_search', weights: { title: 6, company: 4, skills: 3, description: 1 } },
);
jobSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
export type JobDoc = InferSchemaType<typeof jobSchema> & { _id: Types.ObjectId; createdAt: Date };
export const JobModel = defineTenantModel('Job', jobSchema);

/** A member's saved job and private application tracker entry (kept when the listing ends). */
const savedSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    company: { type: String, required: true },
    status: { type: String, enum: TRACK_STATUSES, default: 'saved' },
    note: { type: String, default: '', maxlength: 500 },
  },
  baseSchemaOptions,
);
savedSchema.index({ tenantId: 1, userId: 1, jobId: 1 }, { unique: true });
savedSchema.index({ tenantId: 1, userId: 1, updatedAt: -1 });
savedSchema.index({ tenantId: 1, jobId: 1 });
export type SavedJobDoc = InferSchemaType<typeof savedSchema> & { _id: Types.ObjectId; updatedAt: Date };
export const SavedJobModel = defineTenantModel('SavedJob', savedSchema);

/** A saved search checked once a day. */
const alertSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, maxlength: 60 },
    filters: {
      q: String,
      skills: [String],
      branch: { type: String, enum: BRANCHES },
      level: { type: String, enum: JOB_LEVELS },
      mode: { type: String, enum: JOB_MODES },
      type: { type: String, enum: JOB_TYPES },
      location: String,
      fresher: Boolean,
    },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
alertSchema.index({ tenantId: 1, userId: 1 });
alertSchema.index({ tenantId: 1, nextRunAt: 1 });
export type JobAlertDoc = InferSchemaType<typeof alertSchema> & { _id: Types.ObjectId; createdAt: Date };
export const JobAlertModel = defineTenantModel('JobAlert', alertSchema);
