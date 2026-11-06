import { Schema, type Types } from 'mongoose';
import { BUDDY_CHECKLIST, type BuddyChecklistItem } from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/**
 * Peer mentors and the Senior Buddy (prompt 2, G7). A faculty nomination lets a student who has no
 * verified offer yet become a peer mentor; volunteers are seniors who will guide first-years.
 */
export interface PeerNominationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  nominatedBy: Types.ObjectId | null;
  createdAt: Date;
}
const nominationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    nominatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
nominationSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
export const PeerNominationModel = defineTenantModel('PeerNomination', nominationSchema);

export interface BuddyVolunteerDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  on: boolean;
}
const volunteerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    on: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);
volunteerSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
volunteerSchema.index({ tenantId: 1, on: 1 });
export const BuddyVolunteerModel = defineTenantModel('BuddyVolunteer', volunteerSchema);

/** A first-year and their senior buddy, with the four-week checklist. One buddy per first-year. */
export interface BuddyPairDoc {
  _id: Types.ObjectId;
  juniorId: Types.ObjectId;
  seniorId: Types.ObjectId;
  checklist: { item: BuddyChecklistItem; doneAt: Date | null; doneBy: Types.ObjectId | null }[];
  active: boolean;
  endedAt: Date | null;
  createdAt: Date;
}
const pairSchema = new Schema(
  {
    juniorId: { type: Schema.Types.ObjectId, required: true },
    seniorId: { type: Schema.Types.ObjectId, required: true },
    checklist: {
      type: [
        {
          _id: false,
          item: { type: String, enum: BUDDY_CHECKLIST, required: true },
          doneAt: { type: Date, default: null },
          doneBy: { type: Schema.Types.ObjectId, default: null },
        },
      ],
      default: () => BUDDY_CHECKLIST.map((item) => ({ item, doneAt: null, doneBy: null })),
    },
    /** Set when the senior steps down or either leaves: the first-year is matched again. */
    active: { type: Boolean, default: true },
    endedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
// One live buddy per first-year (ended pairs are kept for the record until erasure).
pairSchema.index({ tenantId: 1, juniorId: 1 }, { unique: true, partialFilterExpression: { active: true } });
pairSchema.index({ tenantId: 1, seniorId: 1, active: 1 });
export const BuddyPairModel = defineTenantModel('BuddyPair', pairSchema);
