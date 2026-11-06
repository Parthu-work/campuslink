import { Schema, type Types } from 'mongoose';
import {
  BRANCHES,
  CTC_BANDS,
  EXPERIENCE_BASES,
  EXPERIENCE_DIFFICULTIES,
  EXPERIENCE_RESULTS,
  REMOVAL_REASONS,
  ROUND_KINDS,
  type Branch,
  type CtcBand,
  type ExperienceBasis,
  type ExperienceDifficulty,
  type ExperienceResult,
  type RoundKind,
} from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';
import type { Removal } from '../moderation/moderation.service.js';

/**
 * The Placement Graph (prompt 2, G10): one row per company per college, rebuilt each night from
 * verified records only. Raw counts are kept here; every number is suppressed when it is shown.
 * Nothing in it names or points to a member.
 */
export interface CompanyGraphDoc {
  _id: Types.ObjectId;
  companyKey: string;
  name: string;
  /** The India-time day of the run that wrote it (`20261106`). */
  day: string;
  /** Distinct students with a verified job offer (internships are not placements). */
  offers: number;
  batches: { gradYear: number; offers: number; band: CtcBand | null }[];
  branches: { branch: Branch; offers: number }[];
  drives: number;
  rounds: { kind: RoundKind; appeared: number; cleared: number }[];
  alumni: number;
  mentors: number;
  sessions: number;
  referrals: { referred: number; reported: number; converted: number };
  computedAt: Date;
}
const count = { type: Number, default: 0, min: 0 };
const graphSchema = new Schema(
  {
    companyKey: { type: String, required: true },
    name: { type: String, required: true },
    day: { type: String, required: true },
    offers: count,
    batches: {
      type: [
        {
          _id: false,
          gradYear: Number,
          offers: Number,
          band: { type: String, enum: [...CTC_BANDS, null], default: null },
        },
      ],
      default: [],
    },
    branches: {
      type: [{ _id: false, branch: { type: String, enum: BRANCHES }, offers: Number }],
      default: [],
    },
    drives: count,
    rounds: {
      type: [{ _id: false, kind: { type: String, enum: ROUND_KINDS }, appeared: Number, cleared: Number }],
      default: [],
    },
    alumni: count,
    mentors: count,
    sessions: count,
    referrals: { referred: count, reported: count, converted: count },
    computedAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
graphSchema.index({ tenantId: 1, companyKey: 1 }, { unique: true });
graphSchema.index({ tenantId: 1, offers: -1 });
export const CompanyGraphModel = defineTenantModel('CompanyGraph', graphSchema);

/**
 * What a mentor's mentees and referrals led to (outcome-proven matching), rebuilt nightly with the
 * graph. Each mentee is a line without an id: their branch, the companies where they reached an
 * interview or offer after a session, and how far they got. Erased with the mentor.
 */
export interface MentorOutcomeDoc {
  _id: Types.ObjectId;
  mentorId: Types.ObjectId;
  mentees: { branch: Branch | null; companyKeys: string[]; reached: 'interview' | 'offer' }[];
  /** Referrals of theirs that led to an interview or an offer (as the students reported). */
  referralsConverted: number;
  day: string;
}
const outcomeSchema = new Schema(
  {
    mentorId: { type: Schema.Types.ObjectId, required: true },
    mentees: {
      type: [
        {
          _id: false,
          branch: { type: String, enum: [...BRANCHES, null], default: null },
          companyKeys: { type: [String], default: [] },
          reached: { type: String, enum: ['interview', 'offer'], required: true },
        },
      ],
      default: [],
    },
    referralsConverted: count,
    day: { type: String, required: true },
  },
  baseSchemaOptions,
);
outcomeSchema.index({ tenantId: 1, mentorId: 1 }, { unique: true });
outcomeSchema.index({ tenantId: 1, day: 1 });
export const MentorOutcomeModel = defineTenantModel('MentorOutcome', outcomeSchema);

/** An Interview Experience Bank write-up (prompt 2, G10). */
export interface ExperienceDoc {
  _id: Types.ObjectId;
  authorId: Types.ObjectId | null;
  companyKey: string;
  companyName: string;
  role: string;
  year: number;
  rounds: {
    kind: RoundKind;
    name: string;
    questions: { text: string; sent: 'bank' | 'practice' | null }[];
    notes: string;
  }[];
  tips: string;
  difficulty: ExperienceDifficulty;
  result: ExperienceResult;
  named: boolean;
  basis: ExperienceBasis;
  /** Kept with the write-up (the author's batch at the time), shown instead of a hidden name. */
  branch: Branch | null;
  gradYear: number | null;
  status: 'pending' | 'published' | 'rejected' | 'removed';
  reason: string | null;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  removal: Removal | null;
  createdAt: Date;
  updatedAt: Date;
}
const experienceSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, default: null },
    companyKey: { type: String, required: true },
    companyName: { type: String, required: true, maxlength: 120 },
    role: { type: String, required: true, maxlength: 120 },
    year: { type: Number, required: true },
    rounds: {
      type: [
        {
          _id: false,
          kind: { type: String, enum: ROUND_KINDS, required: true },
          name: { type: String, default: '', maxlength: 60 },
          questions: {
            type: [
              {
                _id: false,
                text: { type: String, required: true, maxlength: 400 },
                sent: { type: String, enum: ['bank', 'practice', null], default: null },
              },
            ],
            default: [],
          },
          notes: { type: String, default: '', maxlength: 1000 },
        },
      ],
      default: [],
    },
    tips: { type: String, default: '', maxlength: 2000 },
    difficulty: { type: String, enum: EXPERIENCE_DIFFICULTIES, required: true },
    result: { type: String, enum: EXPERIENCE_RESULTS, required: true },
    named: { type: Boolean, default: true },
    basis: { type: String, enum: EXPERIENCE_BASES, required: true },
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    gradYear: { type: Number, default: null },
    status: { type: String, enum: ['pending', 'published', 'rejected', 'removed'], default: 'pending' },
    reason: { type: String, default: null, maxlength: 300 },
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    reviewedAt: { type: Date, default: null },
    removal: {
      type: new Schema(
        {
          reason: { type: String, enum: REMOVAL_REASONS, required: true },
          note: { type: String, default: '' },
          by: { type: Schema.Types.ObjectId, required: true },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  baseSchemaOptions,
);
experienceSchema.index({ tenantId: 1, companyKey: 1, status: 1, _id: -1 });
experienceSchema.index({ tenantId: 1, status: 1, _id: -1 });
experienceSchema.index({ tenantId: 1, authorId: 1, _id: -1 });
export const ExperienceModel = defineTenantModel('InterviewExperience', experienceSchema);

/** The 7-day "share your interview" ask, once per verified offer (the unique index is the claim). */
const promptSchema = new Schema(
  {
    offerId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    companyKey: { type: String, required: true },
    dueAt: { type: Date, required: true },
    sentAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
promptSchema.index({ tenantId: 1, offerId: 1 }, { unique: true });
promptSchema.index({ tenantId: 1, userId: 1 });
export const ExperiencePromptModel = defineTenantModel('ExperiencePrompt', promptSchema);
