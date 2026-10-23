import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { ANSWER_MODES, CHAT_FEEDBACK_REASONS, SERVER_COMMANDS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * A member's conversation with the study assistant. Private to the member: nobody else reads it
 * (faculty see only suppressed aggregates). `expireAt` applies the college's chat retention.
 */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    /** null: every subject the member reads. */
    subjectId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, maxlength: 120 },
    mode: { type: String, enum: ANSWER_MODES, default: 'simple' },
    lastMessageAt: { type: Date, required: true },
    messageCount: { type: Number, default: 0 },
    expireAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
sessionSchema.index({ tenantId: 1, userId: 1, lastMessageAt: -1 });
sessionSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
export type ChatSessionDoc = InferSchemaType<typeof sessionSchema> & { _id: Types.ObjectId };
export const ChatSessionModel = defineTenantModel('ChatSession', sessionSchema);

const citationSchema = new Schema(
  {
    n: Number,
    chunkId: Schema.Types.ObjectId,
    materialId: Schema.Types.ObjectId,
    subjectId: Schema.Types.ObjectId,
    title: String,
    type: String,
    page: { type: Number, default: null },
    startSec: { type: Number, default: null },
    snippet: String,
  },
  { _id: false },
);

/**
 * One turn. Text is plain text (rendered by the web app's answer markdown, never as HTML);
 * `result` holds a command's structured result (videos, notes, quiz, flashcards) or why there is
 * no generated answer. Token counts and latency are kept for budgets and the admin dashboard.
 */
const messageSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, default: '', maxlength: 40_000 },
    command: { type: String, enum: [...SERVER_COMMANDS, null], default: null },
    arg: { type: String, default: '', maxlength: 2000 },
    mode: { type: String, enum: ANSWER_MODES, default: 'simple' },
    citations: { type: [citationSchema], default: [] },
    result: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['complete', 'stopped', 'failed', 'refused'], default: 'complete' },
    grounded: { type: Boolean, default: false },
    /** Replaced by a regenerated answer (kept for the record, hidden from the thread). */
    superseded: { type: Boolean, default: false },
    feedback: {
      rating: { type: String, enum: ['up', 'down', null], default: null },
      reason: { type: String, enum: [...CHAT_FEEDBACK_REASONS, null], default: null },
    },
    /** `provider:model` that wrote it; null for answers made without a model. */
    model: { type: String, default: null },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    expireAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
messageSchema.index({ tenantId: 1, sessionId: 1, createdAt: 1 });
messageSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
messageSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
export type ChatMessageDoc = InferSchemaType<typeof messageSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const ChatMessageModel = defineTenantModel('ChatMessage', messageSchema);

/**
 * A question the material did not cover, for the faculty's content-gap analytics (aggregates only).
 * The text has obvious personal details removed; `userId` is kept only so erasure can remove it.
 */
const unansweredSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, default: null },
    userId: { type: Schema.Types.ObjectId, required: true },
    text: { type: String, required: true, maxlength: 300 },
    language: { type: String, enum: ['en', 'te'], default: 'en' },
    /** Syllabus topics the question is near (by words), for grouping. */
    topicIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  baseSchemaOptions,
);
unansweredSchema.index({ tenantId: 1, subjectId: 1, createdAt: -1 });
unansweredSchema.index({ tenantId: 1, userId: 1 });
export type UnansweredQuestionDoc = InferSchemaType<typeof unansweredSchema> & { _id: Types.ObjectId };
export const UnansweredQuestionModel = defineTenantModel('UnansweredQuestion', unansweredSchema);

/** Flashcards a member kept from a `/flashcards` answer. */
const deckSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    subjectId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, maxlength: 120 },
    cards: {
      type: [
        { front: { type: String, maxlength: 500 }, back: { type: String, maxlength: 1000 }, _id: false },
      ],
      default: [],
    },
    sourceMessageId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
deckSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
export type FlashcardDeckDoc = InferSchemaType<typeof deckSchema> & { _id: Types.ObjectId; createdAt: Date };
export const FlashcardDeckModel = defineTenantModel('FlashcardDeck', deckSchema);
