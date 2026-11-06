import { Schema, type Types } from 'mongoose';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/** An alumnus who turned micro-asks off (prompt 2, G6). Absent means on. */
export interface MicroAskOptOutDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
}
const optOutSchema = new Schema(
  { userId: { type: Schema.Types.ObjectId, required: true } },
  baseSchemaOptions,
);
optOutSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
export const MicroAskOptOutModel = defineTenantModel('MicroAskOptOut', optOutSchema);
