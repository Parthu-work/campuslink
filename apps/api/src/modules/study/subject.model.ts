import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { BRANCHES, SUBJECT_STATUSES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * A subject the college teaches (for example "FLAT: Formal Languages and Automata Theory"). Who
 * takes it is a rule (branches × batches, empty meaning all) plus per-student overrides
 * (`SubjectEnrollment`); faculty owners manage it, and an admin may grant alumni contributors.
 */
const subjectSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 120 },
    code: { type: String, required: true, maxlength: 20 },
    branches: { type: [{ type: String, enum: BRANCHES }], default: [] },
    batches: { type: [Number], default: [] },
    semester: { type: Number, default: null, min: 1, max: 8 },
    regulation: { type: String, default: '', maxlength: 20 },
    description: { type: String, default: '', maxlength: 2000 },
    ownerIds: { type: [Schema.Types.ObjectId], default: [] },
    /** Alumni or certified contributors an admin granted; their uploads are reviewed. */
    contributorIds: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: SUBJECT_STATUSES, default: 'active' },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
subjectSchema.index({ tenantId: 1, code: 1, regulation: 1 }, { unique: true });
subjectSchema.index({ tenantId: 1, status: 1, name: 1 });
subjectSchema.index({ tenantId: 1, ownerIds: 1 });
subjectSchema.index({ tenantId: 1, contributorIds: 1 });
subjectSchema.index(
  { tenantId: 1, name: 'text', code: 'text', description: 'text' },
  { name: 'subject_search', weights: { code: 5, name: 4, description: 1 } },
);
export type SubjectDoc = InferSchemaType<typeof subjectSchema> & {
  _id: Types.ObjectId;
  updatedAt: Date;
};
export const SubjectModel = defineTenantModel('Subject', subjectSchema);

/** Subject → Unit → Topic. Order is explicit so a re-ordered syllabus keeps its ids. */
const unitSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 160 },
    order: { type: Number, required: true, min: 0 },
  },
  baseSchemaOptions,
);
unitSchema.index({ tenantId: 1, subjectId: 1, order: 1 });
export type SyllabusUnitDoc = InferSchemaType<typeof unitSchema> & { _id: Types.ObjectId };
export const SyllabusUnitModel = defineTenantModel('SyllabusUnit', unitSchema);

const topicSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, required: true },
    unitId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 160 },
    order: { type: Number, required: true, min: 0 },
    /** Words that tag material and chunks to this topic (keyword and heading match). */
    keywords: { type: [String], default: [] },
  },
  baseSchemaOptions,
);
topicSchema.index({ tenantId: 1, subjectId: 1, unitId: 1, order: 1 });
export type SyllabusTopicDoc = InferSchemaType<typeof topicSchema> & { _id: Types.ObjectId };
export const SyllabusTopicModel = defineTenantModel('SyllabusTopic', topicSchema);

/** An override of the branch × batch rule for one student. */
const enrollmentSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['include', 'exclude'], required: true },
    by: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
enrollmentSchema.index({ tenantId: 1, subjectId: 1, userId: 1 }, { unique: true });
enrollmentSchema.index({ tenantId: 1, userId: 1, kind: 1 });
export type EnrollmentDoc = InferSchemaType<typeof enrollmentSchema> & { _id: Types.ObjectId };
export const SubjectEnrollmentModel = defineTenantModel('SubjectEnrollment', enrollmentSchema);
