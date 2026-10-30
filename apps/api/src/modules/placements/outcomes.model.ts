import { Schema, type Types } from 'mongoose';
import { BRANCHES, EXAM_LEVELS, EXAMS, OUTCOME_SOURCES, OUTCOME_STATUSES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * What every outcome record carries (B8): who it is about, how it got here and whether the
 * placement cell verified it. After erasure `userId` is null and `anonKey` (random, one per erased
 * member) lets reports still count the person once without saying who they were.
 */
const common = {
  userId: { type: Schema.Types.ObjectId, default: null },
  anonKey: { type: String, default: null },
  status: { type: String, enum: OUTCOME_STATUSES, default: 'reported' },
  source: { type: String, enum: OUTCOME_SOURCES, required: true },
  reason: { type: String, default: null, maxlength: 300 },
  verifiedBy: { type: Schema.Types.ObjectId, default: null },
  verifiedAt: { type: Date, default: null },
  /** The member's branch and batch when recorded (kept for the college's record). */
  branch: { type: String, enum: [...BRANCHES, null], default: null },
  gradYear: { type: Number, default: null },
};
/** Stored shape (spelled out: inference does not follow the shared `common` fields). */
interface CommonDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId | null;
  anonKey: string | null;
  status: string;
  source: string;
  reason: string | null;
  verifiedBy: Types.ObjectId | null;
  verifiedAt: Date | null;
  branch: string | null;
  gradYear: number | null;
  createdAt: Date;
}
const indexes = (s: Schema) => {
  s.index({ tenantId: 1, userId: 1, _id: -1 });
  s.index({ tenantId: 1, status: 1, _id: -1 });
  s.index({ tenantId: 1, status: 1, gradYear: 1 });
  return s;
};

const higherStudySchema = indexes(
  new Schema(
    {
      ...common,
      institution: { type: String, required: true, maxlength: 160 },
      program: { type: String, required: true, maxlength: 120 },
      country: { type: String, default: 'India', maxlength: 60 },
      admitYear: { type: Number, required: true },
      qualifyingExam: { type: String, enum: [...EXAMS, null], default: null },
    },
    baseSchemaOptions,
  ),
);
export interface HigherStudyDoc extends CommonDoc {
  institution: string;
  program: string;
  country: string;
  admitYear: number;
  qualifyingExam: string | null;
}
export const HigherStudyModel = defineTenantModel('HigherStudy', higherStudySchema);

const examSchema = indexes(
  new Schema(
    {
      ...common,
      exam: { type: String, enum: EXAMS, required: true },
      examName: { type: String, default: '', maxlength: 80 },
      year: { type: Number, required: true },
      scoreBand: { type: String, default: '', maxlength: 60 },
      level: { type: String, enum: EXAM_LEVELS, required: true },
    },
    baseSchemaOptions,
  ),
);
export interface ExamDoc extends CommonDoc {
  exam: string;
  examName: string;
  year: number;
  scoreBand: string;
  level: string;
}
export const ExamQualificationModel = defineTenantModel('ExamQualification', examSchema);

const ventureSchema = indexes(
  new Schema(
    {
      ...common,
      name: { type: String, required: true, maxlength: 120 },
      registered: { type: Boolean, required: true },
      year: { type: Number, required: true },
    },
    baseSchemaOptions,
  ),
);
export interface VentureDoc extends CommonDoc {
  name: string;
  registered: boolean;
  year: number;
}
export const VentureModel = defineTenantModel('Venture', ventureSchema);
