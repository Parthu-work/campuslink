import { Schema, type Types } from 'mongoose';
import { READINESS_COMPONENTS, READINESS_SNAPSHOT_KEEP_DAYS } from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/**
 * Readiness (prompt 2, G5). Scores are computed from the owning modules on every read, so the one
 * shown cannot go stale or outlive the data behind it. Three things are stored: the college's
 * weights (one document per college, no member in it), the nudges sent (per member, for the
 * cool-off), and the student's own score once a day for their momentum (prompt 3, U7; kept 35
 * days). The last two are exported and erased with the member. The board's own daily totals
 * (prompt 3, U9c) hold counts and a median only, no member.
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

export interface ReadinessSnapshotDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  /** YYYY-MM-DD (UTC): one per student per day, the last score they saw that day. */
  day: string;
  score: number;
  createdAt: Date;
}

/**
 * The score the student saw on a day (prompt 3, U7): only for "+6 this week" on their own
 * Readiness. Written when they open it; never read by the board, never ranked; deleted after
 * READINESS_SNAPSHOT_KEEP_DAYS.
 */
const snapshotSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    score: { type: Number, min: 0, max: 100, required: true },
  },
  baseSchemaOptions,
);
snapshotSchema.index({ tenantId: 1, userId: 1, day: -1 }, { unique: true });
snapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: READINESS_SNAPSHOT_KEEP_DAYS * 86_400 });
export const ReadinessSnapshotModel = defineTenantModel('ReadinessSnapshot', snapshotSchema);

export interface ReadinessBoardDayDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  /** The board's filter: "gradYear|branch", empty parts for "all". */
  scope: string;
  /** YYYY-MM-DD (UTC): one per filter per day, the last the staff saw that day. */
  day: string;
  students: number;
  ready: number;
  median: number | null;
  needsHelp: number;
  /** The threshold "ready" was counted against: a changed threshold is not compared. */
  threshold: number;
  createdAt: Date;
}

/**
 * The board's totals for a day (prompt 3, U9c), for "Up 3 on last week" on its four numbers:
 * counts and a median for one filter, never a name or a student's score. Shown only through
 * `suppress()`; deleted after READINESS_SNAPSHOT_KEEP_DAYS.
 */
const boardDaySchema = new Schema(
  {
    scope: { type: String, default: '', maxlength: 40 },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    students: { type: Number, min: 0, required: true },
    ready: { type: Number, min: 0, required: true },
    median: { type: Number, min: 0, max: 100, default: null },
    needsHelp: { type: Number, min: 0, required: true },
    threshold: { type: Number, min: 0, max: 100, required: true },
  },
  baseSchemaOptions,
);
boardDaySchema.index({ tenantId: 1, scope: 1, day: -1 }, { unique: true });
boardDaySchema.index({ createdAt: 1 }, { expireAfterSeconds: READINESS_SNAPSHOT_KEEP_DAYS * 86_400 });
export const ReadinessBoardDayModel = defineTenantModel('ReadinessBoardDay', boardDaySchema);
