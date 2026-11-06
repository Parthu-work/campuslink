import { Schema, type Types } from 'mongoose';
import type { NextStepView } from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/**
 * One member's Next Step for one ISO week (prompt 2, G7). Unique per member and week, so the weekly
 * job, a retry and the member opening Home early all end up with the same one.
 */
export interface NextStepDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  week: string;
  roadmapStep: NextStepView['roadmapStep'];
  opportunity: NextStepView['opportunity'];
  alumnus: NextStepView['alumnus'];
  /** The readiness score this week (the delta is computed against last week's). */
  readinessScore: number | null;
  readinessDelta: number | null;
  notifiedAt: Date | null;
  openedAt: Date | null;
  opened: string[];
  createdAt: Date;
}

const nextStepSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    week: { type: String, required: true, match: /^\d{4}-W\d{2}$/ },
    roadmapStep: {
      type: new Schema(
        { roadmapId: String, slug: String, roadmap: String, nodeId: String, title: String },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
    opportunity: {
      type: new Schema(
        {
          kind: { type: String, enum: ['drive', 'job'] },
          id: String,
          company: String,
          title: String,
          closesAt: { type: String, default: undefined },
        },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
    alumnus: {
      type: new Schema(
        { userId: String, name: String, company: String, jobTitle: String },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
    readinessScore: { type: Number, default: null },
    readinessDelta: { type: Number, default: null },
    notifiedAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    opened: { type: [String], default: [] },
  },
  baseSchemaOptions,
);
nextStepSchema.index({ tenantId: 1, userId: 1, week: 1 }, { unique: true });
nextStepSchema.index({ tenantId: 1, week: 1 });
export const NextStepModel = defineTenantModel('NextStep', nextStepSchema);
