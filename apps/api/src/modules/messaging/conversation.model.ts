import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** A 1:1 conversation. It only exists once a mentorship request has been accepted (no cold DMs). */
const conversationSchema = new Schema(
  {
    participants: { type: [Schema.Types.ObjectId], required: true },
    /** Sorted participant ids joined by '|': one conversation per pair. */
    pairKey: { type: String, required: true },
    status: { type: String, enum: ['open', 'blocked'], default: 'open' },
    lastMessageAt: { type: Date, default: null },
    reads: {
      type: [{ userId: Schema.Types.ObjectId, readAt: Date, lastReadId: Schema.Types.ObjectId, _id: false }],
      default: [],
    },
    /** Last "new message" email per recipient (throttle). */
    emailedAt: { type: [{ userId: Schema.Types.ObjectId, at: Date, _id: false }], default: [] },
  },
  baseSchemaOptions,
);
conversationSchema.index({ tenantId: 1, pairKey: 1 }, { unique: true });
conversationSchema.index({ tenantId: 1, participants: 1, lastMessageAt: -1 });
export type ConversationDoc = InferSchemaType<typeof conversationSchema> & { _id: Types.ObjectId };
export const ConversationModel = defineTenantModel('Conversation', conversationSchema);

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true },
    senderId: { type: Schema.Types.ObjectId, required: true },
    /** AES-256-GCM: database dumps and operators never see message text. */
    bodyEnc: { type: String, default: null },
    attachment: {
      type: { fileId: Schema.Types.ObjectId, name: String, mime: String, size: Number, _id: false },
      default: null,
    },
  },
  baseSchemaOptions,
);
messageSchema.index({ tenantId: 1, conversationId: 1, _id: -1 });
messageSchema.index({ tenantId: 1, 'attachment.fileId': 1 }, { sparse: true });
export type MessageDoc = InferSchemaType<typeof messageSchema> & { _id: Types.ObjectId; createdAt: Date };
export const MessageModel = defineTenantModel('Message', messageSchema);
