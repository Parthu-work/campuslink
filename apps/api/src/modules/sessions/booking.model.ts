import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { BOOKING_STATUSES, FEEDBACK_TAGS, SESSION_TYPES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

const bookingSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, required: true },
    mentorId: { type: Schema.Types.ObjectId, required: true },
    menteeId: { type: Schema.Types.ObjectId, required: true },
    participants: { type: [Schema.Types.ObjectId], required: true },
    sessionType: { type: String, enum: SESSION_TYPES, required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    status: { type: String, enum: BOOKING_STATUSES, default: 'scheduled' },
    /**
     * `<userId>|<15-minute block ISO>` for every block each participant is busy (mentor buffer
     * included). A unique multikey index over scheduled bookings makes double booking impossible,
     * for mentors and mentees alike, without transactions.
     */
    holds: { type: [String], required: true },
    room: { type: String, required: true },
    /** Bumped on every reschedule; delayed jobs carry it and do nothing when it no longer matches. */
    version: { type: Number, default: 0 },
    rescheduleCount: { type: Number, default: 0 },
    cancelledBy: { type: String, enum: ['mentor', 'mentee', null], default: null },
    cancelReason: { type: String, default: null, maxlength: 300 },
    lateCancel: { type: Boolean, default: false },
    noShowBy: { type: String, enum: ['mentor', 'mentee', null], default: null },
    completedAt: { type: Date, default: null },
    conversationId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
bookingSchema.index(
  { tenantId: 1, holds: 1 },
  { unique: true, partialFilterExpression: { status: 'scheduled' }, name: 'no_double_booking' },
);
bookingSchema.index({ tenantId: 1, participants: 1, start: -1 });
bookingSchema.index({ tenantId: 1, mentorId: 1, status: 1, end: -1 });
bookingSchema.index({ tenantId: 1, status: 1, end: 1 });
export type Booking = InferSchemaType<typeof bookingSchema>;
export type BookingDoc = Booking & { _id: Types.ObjectId };
export const BookingModel = defineTenantModel('Booking', bookingSchema);

/** Mentee's rating of a completed session. Visible to the mentor and to admins only. */
const feedbackSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, required: true },
    mentorId: { type: Schema.Types.ObjectId, required: true },
    menteeId: { type: Schema.Types.ObjectId, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    tags: { type: [{ type: String, enum: FEEDBACK_TAGS }], default: [] },
    comment: { type: String, default: '', maxlength: 1000 },
  },
  baseSchemaOptions,
);
feedbackSchema.index({ tenantId: 1, bookingId: 1 }, { unique: true });
feedbackSchema.index({ tenantId: 1, mentorId: 1, _id: -1 });
export type FeedbackDoc = InferSchemaType<typeof feedbackSchema> & { _id: Types.ObjectId; createdAt: Date };
export const FeedbackModel = defineTenantModel('SessionFeedback', feedbackSchema);
