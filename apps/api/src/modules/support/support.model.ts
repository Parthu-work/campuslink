import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { SUPPORT_CATEGORIES, SUPPORT_LIMITS, SUPPORT_STATUSES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * A problem report (build B14): sent by a member, answered by the college's admins (`college`) or,
 * for bugs, by the platform owner (`platform`). Plain text only. The reporter's account erasure
 * deletes their reports (they are about the member's own problem, not the college's record).
 */
const replySchema = new Schema(
  {
    from: { type: String, enum: ['member', 'college', 'platform'], required: true },
    /** The writer (the reporter, a college admin, or a platform admin in the platform's tenant). */
    authorId: { type: Schema.Types.ObjectId, required: true },
    /** Kept so platform replies show a name without reading another college's users. */
    authorName: { type: String, required: true, maxlength: 100 },
    body: { type: String, required: true, maxlength: SUPPORT_LIMITS.body },
    at: { type: Date, required: true },
  },
  { _id: true, strict: 'throw' },
);

const ticketSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    category: { type: String, enum: SUPPORT_CATEGORIES, required: true },
    desk: { type: String, enum: ['college', 'platform'], required: true },
    subject: { type: String, required: true, maxlength: SUPPORT_LIMITS.subject },
    body: { type: String, required: true, maxlength: SUPPORT_LIMITS.body },
    screenshotFileId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: SUPPORT_STATUSES, default: 'open' },
    replies: { type: [replySchema], default: [] },
    lastActivityAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
ticketSchema.index({ tenantId: 1, userId: 1, _id: -1 });
ticketSchema.index({ tenantId: 1, desk: 1, status: 1, lastActivityAt: -1 });

export type SupportTicketDoc = InferSchemaType<typeof ticketSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export const SupportTicketModel = defineTenantModel('SupportTicket', ticketSchema);
