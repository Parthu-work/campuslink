import { Schema, type Types } from 'mongoose';
import {
  COPILOT_COMMANDS,
  COPILOT_INDEXED_KINDS,
  type CopilotCitation,
  type CopilotCommand,
  type CopilotHandoff,
  type CopilotIndexedKind,
  type CopilotResult,
} from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/** Conversations are kept this long after their last message (data minimisation). */
export const COPILOT_KEEP_DAYS = 180;

/**
 * The Career Copilot's index (prompt 2, G11): college-wide sources as passages (company
 * summaries, published interview write-ups, published roadmaps, visible drives), rebuilt daily.
 * The vector is kept here; the vector store is only an index. Nothing private to a member is
 * indexed: their own facts and mentor cards are read live, with their rights, for each question.
 */
export interface CopilotChunkDoc {
  _id: Types.ObjectId;
  /** `kind:sourceId:part`, stable across runs. */
  key: string;
  kind: CopilotIndexedKind;
  sourceId: string;
  companyKey: string | null;
  title: string;
  text: string;
  href: string;
  hash: string;
  vector?: Buffer | null;
  /** `provider:model` that made the vector, or null while it waits for one. */
  embeddingModel: string | null;
  day: string;
}
const chunkSchema = new Schema(
  {
    key: { type: String, required: true },
    kind: { type: String, enum: COPILOT_INDEXED_KINDS, required: true },
    sourceId: { type: String, required: true },
    companyKey: { type: String, default: null },
    title: { type: String, required: true, maxlength: 200 },
    text: { type: String, required: true, maxlength: 4000 },
    href: { type: String, required: true },
    hash: { type: String, required: true },
    vector: { type: Buffer, default: null, select: false },
    embeddingModel: { type: String, default: null },
    day: { type: String, required: true },
  },
  baseSchemaOptions,
);
chunkSchema.index({ tenantId: 1, key: 1 }, { unique: true });
chunkSchema.index({ tenantId: 1, kind: 1, companyKey: 1 });
chunkSchema.index({ tenantId: 1, embeddingModel: 1 });
chunkSchema.index(
  { tenantId: 1, title: 'text', text: 'text' },
  { name: 'copilot_search', weights: { title: 4, text: 1 } },
);
export const CopilotChunkModel = defineTenantModel('CopilotChunk', chunkSchema);

/** A member's conversation with the copilot: theirs alone (nobody else reads it). */
export interface CopilotSessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  messageCount: number;
  lastMessageAt: Date;
  purgeAt: Date;
}
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 120 },
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, required: true },
    purgeAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
sessionSchema.index({ tenantId: 1, userId: 1, lastMessageAt: -1 });
sessionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
export const CopilotSessionModel = defineTenantModel('CopilotSession', sessionSchema);

export interface CopilotMessageDoc {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'user' | 'assistant';
  text: string;
  command: CopilotCommand | null;
  citations: CopilotCitation[];
  handoffs: CopilotHandoff[];
  result: CopilotResult | null;
  status: 'streaming' | 'done' | 'failed';
  purgeAt: Date;
  createdAt: Date;
}
const messageSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, default: '', maxlength: 12_000 },
    command: { type: String, enum: [...COPILOT_COMMANDS, null], default: null },
    citations: { type: [Schema.Types.Mixed], default: [] },
    handoffs: { type: [Schema.Types.Mixed], default: [] },
    result: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['streaming', 'done', 'failed'], default: 'done' },
    purgeAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
messageSchema.index({ tenantId: 1, sessionId: 1, _id: 1 });
messageSchema.index({ tenantId: 1, userId: 1, _id: -1 });
messageSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
export const CopilotMessageModel = defineTenantModel('CopilotMessage', messageSchema);
