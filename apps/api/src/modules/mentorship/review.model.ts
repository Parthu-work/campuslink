import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { REVIEW_MAX_LENGTH, SESSION_TYPES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';
import { removalFragment } from '../../db/fragments.js';

/**
 * A short public review of a mentor (B5), written after the mentee's private feedback and carrying
 * that feedback's rating. One per booking; plain text; moderatable.
 */
const reviewSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, required: true },
    mentorId: { type: Schema.Types.ObjectId, required: true },
    menteeId: { type: Schema.Types.ObjectId, required: true },
    sessionType: { type: String, enum: SESSION_TYPES, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, required: true, maxlength: REVIEW_MAX_LENGTH },
    status: { type: String, enum: ['published', 'removed'], default: 'published' },
    removal: removalFragment,
  },
  baseSchemaOptions,
);
reviewSchema.index({ tenantId: 1, bookingId: 1 }, { unique: true });
reviewSchema.index({ tenantId: 1, mentorId: 1, status: 1, _id: -1 });
reviewSchema.index({ tenantId: 1, menteeId: 1 });
export type ReviewDoc = InferSchemaType<typeof reviewSchema> & { _id: Types.ObjectId; createdAt: Date };
export const MentorReviewModel = defineTenantModel('MentorReview', reviewSchema);
