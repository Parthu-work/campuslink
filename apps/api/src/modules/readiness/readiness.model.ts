import { Schema, type Types } from 'mongoose';
import { READINESS_COMPONENTS } from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/**
 * Readiness (prompt 2, G5). Scores are never stored: they are computed from the owning modules on
 * every read, so they cannot go stale or outlive the data behind them. Two things are stored: the
 * college's weights (one document per college, no member in it) and the nudges sent (per member,
 * for the cool-off; exported and erased with the member).
 */
export interface ReadinessConfigDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  key: 'college';
  weights: Record<(typeof READINESS_COMPONENTS)[number], number>;
  threshold: number;
  closingDays: number;
  updatedAt: Date;
}

const configSchema = new Schema(
  {
    key: { type: String, enum: ['college'], default: 'college' },
    weights: new Schema(
      Object.fromEntries(
        READINESS_COMPONENTS.map((c) => [c, { type: Number, min: 0, max: 100, required: true }]),
      ),
      { _id: false, strict: 'throw' },
    ),
    threshold: { type: Number, min: 1, max: 100, required: true },
    closingDays: { type: Number, min: 1, max: 60, required: true },
  },
  baseSchemaOptions,
);
configSchema.index({ tenantId: 1, key: 1 }, { unique: true });
export const ReadinessConfigModel = defineTenantModel('ReadinessConfig', configSchema);

export interface ReadinessNudgeDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  /** The drive whose registration was about to close. */
  driveId: Types.ObjectId;
  createdAt: Date;
}

/** A nudge the placement cell sent: who and for which drive (the sender is in the audit log). */
const nudgeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    driveId: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
nudgeSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
export const ReadinessNudgeModel = defineTenantModel('ReadinessNudge', nudgeSchema);
