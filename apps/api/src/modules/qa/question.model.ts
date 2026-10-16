import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { REMOVAL_REASONS, TOPICS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';
import { removalFragment } from '../../db/fragments.js';

/** Moderated Q&A: questions start `pending` and appear only once a moderator approves them. */
const questionSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 150 },
    body: { type: String, default: '', maxlength: 2000 },
    topics: { type: [{ type: String, enum: TOPICS }], default: [] },
    status: { type: String, enum: ['pending', 'published', 'rejected', 'removed'], default: 'pending' },
    rejection: {
      type: { reason: { type: String, enum: REMOVAL_REASONS }, by: Schema.Types.ObjectId, at: Date },
      default: null,
    },
    removal: removalFragment,
    answers: { type: Number, default: 0 },
    acceptedAnswerId: { type: Schema.Types.ObjectId, default: null },
    lastActivityAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);
questionSchema.index({ tenantId: 1, status: 1, lastActivityAt: -1 });
questionSchema.index({ tenantId: 1, authorId: 1, _id: -1 });
questionSchema.index({ tenantId: 1, topics: 1, status: 1 });
questionSchema.index(
  { tenantId: 1, title: 'text', body: 'text' },
  { name: 'question_search', weights: { title: 3, body: 1 } },
);
export type QuestionDoc = InferSchemaType<typeof questionSchema> & { _id: Types.ObjectId; createdAt: Date };
export const QuestionModel = defineTenantModel('Question', questionSchema);

const answerSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true, maxlength: 3000 },
    helpful: { type: Number, default: 0 },
    status: { type: String, enum: ['published', 'removed'], default: 'published' },
    removal: removalFragment,
  },
  baseSchemaOptions,
);
answerSchema.index({ tenantId: 1, questionId: 1, _id: 1 });
answerSchema.index({ tenantId: 1, authorId: 1 });
export type AnswerDoc = InferSchemaType<typeof answerSchema> & { _id: Types.ObjectId; createdAt: Date };
export const AnswerModel = defineTenantModel('Answer', answerSchema);

const answerVoteSchema = new Schema(
  {
    answerId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
answerVoteSchema.index({ tenantId: 1, answerId: 1, userId: 1 }, { unique: true });
export const AnswerVoteModel = defineTenantModel('AnswerVote', answerVoteSchema);
