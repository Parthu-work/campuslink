import { Schema, type Types } from 'mongoose';
import { PRODUCT_EVENTS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * A product event (B9): who did one of a closed list of things, on which day. `props` holds ids
 * and enum values only (checked before saving), never text. Kept 13 months, then rolled up.
 */
const eventSchema = new Schema(
  {
    /** UTC day, YYYY-MM-DD. */
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    userId: { type: Schema.Types.ObjectId, default: null },
    /** Random, one per member whose events were detached (erasure, consent withdrawn). */
    anonKey: { type: String, default: null },
    name: { type: String, enum: PRODUCT_EVENTS, required: true },
    props: { type: Map, of: { type: String, maxlength: 40 }, default: {} },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
eventSchema.index({ tenantId: 1, name: 1, createdAt: -1 });
eventSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
eventSchema.index({ tenantId: 1, day: 1 });
// One `visited` per member and day: the write that loses a race is a no-op.
eventSchema.index(
  { tenantId: 1, userId: 1, day: 1 },
  { unique: true, partialFilterExpression: { name: 'visited' }, name: 'one_visit_a_day' },
);
export interface ProductEventDoc {
  _id: Types.ObjectId;
  day: string;
  userId: Types.ObjectId | null;
  anonKey: string | null;
  name: string;
  props: Map<string, string> | Record<string, string>;
  createdAt: Date;
}
export const ProductEventModel = defineTenantModel('ProductEvent', eventSchema);

/** Daily counts of events past retention: no member in them at all. */
const dailySchema = new Schema(
  {
    day: { type: String, required: true },
    name: { type: String, enum: PRODUCT_EVENTS, required: true },
    count: { type: Number, required: true },
    members: { type: Number, required: true },
  },
  baseSchemaOptions,
);
dailySchema.index({ tenantId: 1, day: 1, name: 1 }, { unique: true });
export const ProductEventDailyModel = defineTenantModel('ProductEventDaily', dailySchema);
