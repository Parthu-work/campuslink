import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { DECLINE_TEMPLATES, REQUEST_STATUSES, SESSION_TYPES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

const requestSchema = new Schema(
  {
    menteeId: { type: Schema.Types.ObjectId, required: true },
    mentorId: { type: Schema.Types.ObjectId, required: true },
    sessionType: { type: String, enum: SESSION_TYPES, required: true },
    // One message (owner decision Q12), or the three parts older clients sent.
    message: { type: String, default: null, maxlength: 1500 },
    goal: { type: String, default: null, maxlength: 300 },
    background: { type: String, default: null, maxlength: 600 },
    need: { type: String, default: null, maxlength: 600 },
    slotStart: { type: Date, default: null },
    status: { type: String, enum: REQUEST_STATUSES, default: 'pending' },
    declineTemplate: { type: String, enum: [...DECLINE_TEMPLATES, null], default: null },
    declineNote: { type: String, default: null, maxlength: 300 },
    respondedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    bookingId: { type: Schema.Types.ObjectId, default: null },
    conversationId: { type: Schema.Types.ObjectId, default: null },
    /** Bumped on every change of status; the nudge and rematch jobs carry it and no-op on a mismatch. */
    version: { type: Number, default: 0 },
    nudgedAt: { type: Date, default: null },
    rematchOfferedAt: { type: Date, default: null },
    /** Sent from a rematch offer: does not count against the college's weekly request limit. */
    rematchOf: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
// One open request per mentee → mentor pair, enforced by the database (no race window).
requestSchema.index(
  { tenantId: 1, menteeId: 1, mentorId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'one_pending_per_pair' },
);
requestSchema.index({ tenantId: 1, mentorId: 1, status: 1, _id: -1 });
requestSchema.index({ tenantId: 1, menteeId: 1, status: 1, _id: -1 });
requestSchema.index({ tenantId: 1, mentorId: 1, createdAt: -1 });
requestSchema.index({ tenantId: 1, menteeId: 1, createdAt: -1 });
export type MentorshipRequest = InferSchemaType<typeof requestSchema>;
export type RequestDoc = MentorshipRequest & { _id: Types.ObjectId; createdAt: Date };
export const MentorshipRequestModel = defineTenantModel('MentorshipRequest', requestSchema);
