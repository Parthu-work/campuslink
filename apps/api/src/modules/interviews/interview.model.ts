import { Schema, type Types } from 'mongoose';
import {
  BRANCHES,
  INTERVIEW_DIFFICULTIES,
  INTERVIEW_LANGUAGES,
  INTERVIEW_MODES,
  INTERVIEW_QUESTION_SOURCES,
  INTERVIEW_QUESTION_STATUSES,
  INTERVIEW_TRACKS,
  type Branch,
  type InterviewDifficulty,
  type InterviewLanguage,
  type InterviewMode,
  type InterviewQuestionSource,
  type InterviewQuestionStatus,
  type InterviewSummary,
  type InterviewTrack,
  type InterviewTurnView,
  type RubricDimension,
  type RubricScores,
} from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/**
 * The college's own interview questions (prompt 2, G3): faculty write them, or approve the ones
 * the AI generated for a drive's role. The built-in starter set lives in code
 * (`starter-questions.ts`) and is drawn from alongside these.
 */
export interface InterviewQuestionDoc {
  _id: Types.ObjectId;
  track: 'hr' | 'technical';
  branch: Branch | null;
  difficulty: InterviewDifficulty;
  topic: string;
  text: string;
  rubric: string;
  source: InterviewQuestionSource;
  status: InterviewQuestionStatus;
  createdBy: Types.ObjectId | null;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

const questionSchema = new Schema(
  {
    track: { type: String, enum: ['hr', 'technical'], required: true },
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    difficulty: { type: String, enum: INTERVIEW_DIFFICULTIES, default: 'medium' },
    topic: { type: String, required: true, maxlength: 60 },
    text: { type: String, required: true, maxlength: 400 },
    rubric: { type: String, required: true, maxlength: 400 },
    source: { type: String, enum: INTERVIEW_QUESTION_SOURCES, required: true },
    status: { type: String, enum: INTERVIEW_QUESTION_STATUSES, required: true },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    reviewedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
questionSchema.index({ tenantId: 1, status: 1, track: 1, branch: 1 });
questionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const InterviewQuestionModel = defineTenantModel('InterviewQuestion', questionSchema);

export interface InterviewTurnDoc {
  kind: 'question' | 'follow_up';
  /** `starter:<id>`, `bank:<id>` or `generated`: where the question came from. */
  ref: string;
  topic: string;
  text: string;
  rubric: string;
  status: InterviewTurnView['status'];
  answer: string | null;
  answeredBy: 'text' | 'voice' | null;
  /** The recording while it is transcribed; cleared (and the file deleted) right after. */
  audioFileId: Types.ObjectId | null;
  scores: RubricScores | null;
  evidence: Partial<Record<RubricDimension, string>>;
  tip: string | null;
}

export interface InterviewDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  track: InterviewTrack;
  branch: Branch | null;
  driveId: Types.ObjectId | null;
  driveCompany: string | null;
  driveTitle: string | null;
  difficulty: InterviewDifficulty;
  language: InterviewLanguage;
  mode: InterviewMode;
  status: 'in_progress' | 'completed' | 'abandoned';
  planned: number;
  turns: InterviewTurnDoc[];
  summary: InterviewSummary | null;
  /** Bumped on every write: answers are applied only to the version they were read from. */
  rev: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const turnSchema = new Schema(
  {
    kind: { type: String, enum: ['question', 'follow_up'], required: true },
    ref: { type: String, required: true, maxlength: 60 },
    topic: { type: String, default: '', maxlength: 60 },
    text: { type: String, required: true, maxlength: 600 },
    rubric: { type: String, default: '', maxlength: 400 },
    status: {
      type: String,
      enum: ['open', 'transcribing', 'answered', 'skipped', 'voice_failed'],
      default: 'open',
    },
    answer: { type: String, default: null, maxlength: 4000 },
    answeredBy: { type: String, enum: ['text', 'voice', null], default: null },
    audioFileId: { type: Schema.Types.ObjectId, default: null },
    scores: { type: Schema.Types.Mixed, default: null },
    evidence: { type: Schema.Types.Mixed, default: {} },
    tip: { type: String, default: null, maxlength: 400 },
  },
  { _id: false },
);

const interviewSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    track: { type: String, enum: INTERVIEW_TRACKS, required: true },
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    driveId: { type: Schema.Types.ObjectId, default: null },
    driveCompany: { type: String, default: null, maxlength: 120 },
    driveTitle: { type: String, default: null, maxlength: 160 },
    difficulty: { type: String, enum: INTERVIEW_DIFFICULTIES, required: true },
    language: { type: String, enum: INTERVIEW_LANGUAGES, required: true },
    mode: { type: String, enum: INTERVIEW_MODES, required: true },
    status: { type: String, enum: ['in_progress', 'completed', 'abandoned'], default: 'in_progress' },
    planned: { type: Number, required: true },
    turns: { type: [turnSchema], default: [] },
    summary: { type: Schema.Types.Mixed, default: null },
    rev: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
interviewSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
export const InterviewModel = defineTenantModel('Interview', interviewSchema);
