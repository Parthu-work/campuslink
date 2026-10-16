import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { BADGES, REDEMPTION_STATUSES, REWARD_KINDS, XP_KINDS, XP_TRACKS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/** Append-only points ledger. Corrections are new entries (revoked, refund), never edits. */
const xpSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    track: { type: String, enum: XP_TRACKS, required: true },
    kind: { type: String, enum: [...XP_KINDS, 'revoked', 'redeemed', 'refund'], required: true },
    points: { type: Number, required: true },
    refId: { type: String, default: '' },
    /** Unique per tenant: the same action never pays twice. */
    dedupeKey: { type: String, default: null },
    /** Day in the college's timezone (YYYY-MM-DD), for caps and streaks. */
    day: { type: String, required: true },
    note: { type: String, default: '', maxlength: 300 },
    actorId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
xpSchema.index(
  { tenantId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
xpSchema.index({ tenantId: 1, userId: 1, track: 1, createdAt: -1 });
xpSchema.index({ tenantId: 1, userId: 1, kind: 1, day: 1 });
xpSchema.index({ tenantId: 1, track: 1, createdAt: -1 });
export type XpDoc = InferSchemaType<typeof xpSchema> & { _id: Types.ObjectId; createdAt: Date };
export const XpEventModel = defineTenantModel('XpEvent', xpSchema);

const badgeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    badge: { type: String, enum: BADGES, required: true },
  },
  baseSchemaOptions,
);
badgeSchema.index({ tenantId: 1, userId: 1, badge: 1 }, { unique: true });
export type BadgeDoc = InferSchemaType<typeof badgeSchema> & { _id: Types.ObjectId; createdAt: Date };
export const UserBadgeModel = defineTenantModel('UserBadge', badgeSchema);

/** Opt-ins: nobody appears on a leaderboard or the Wall of Mentors unless they choose to. */
const prefsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    showOnLeaderboard: { type: Boolean, default: false },
    showOnWall: { type: Boolean, default: false },
    /** Short lock so one member's redemptions run one at a time (no overspending). */
    redeemLockUntil: { type: Date, default: null },
  },
  baseSchemaOptions,
);
prefsSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
export type GamePrefsDoc = InferSchemaType<typeof prefsSchema> & { _id: Types.ObjectId };
export const GamificationPrefsModel = defineTenantModel('GamificationPrefs', prefsSchema);

const rewardSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 500 },
    kind: { type: String, enum: REWARD_KINDS, required: true },
    track: { type: String, enum: XP_TRACKS, required: true },
    cost: { type: Number, required: true, min: 1 },
    /** null = unlimited. */
    stock: { type: Number, default: null, min: 0 },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
rewardSchema.index({ tenantId: 1, active: 1, track: 1, cost: 1 });
export type RewardDoc = InferSchemaType<typeof rewardSchema> & { _id: Types.ObjectId };
export const RewardModel = defineTenantModel('Reward', rewardSchema);

const redemptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    rewardId: { type: Schema.Types.ObjectId, required: true },
    /** Snapshot so history reads well after the reward changes. */
    title: { type: String, required: true },
    kind: { type: String, enum: REWARD_KINDS, required: true },
    track: { type: String, enum: XP_TRACKS, required: true },
    cost: { type: Number, required: true },
    status: { type: String, enum: REDEMPTION_STATUSES, default: 'pending' },
    note: { type: String, default: '', maxlength: 300 },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
redemptionSchema.index({ tenantId: 1, userId: 1, _id: -1 });
redemptionSchema.index({ tenantId: 1, status: 1, _id: 1 });
export type RedemptionDoc = InferSchemaType<typeof redemptionSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const RedemptionModel = defineTenantModel('Redemption', redemptionSchema);
