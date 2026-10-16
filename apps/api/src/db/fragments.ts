import { Schema } from 'mongoose';
import { REMOVAL_REASONS } from '@campuslink/shared';

/** Moderation removal, shared by every kind of user content (shown to the author with the reason). */
export const removalFragment = {
  type: new Schema(
    {
      reason: { type: String, enum: REMOVAL_REASONS, required: true },
      note: { type: String, default: '', maxlength: 500 },
      by: { type: Schema.Types.ObjectId, required: true },
      at: { type: Date, required: true },
    },
    { _id: false, strict: 'throw' },
  ),
  default: null,
};
