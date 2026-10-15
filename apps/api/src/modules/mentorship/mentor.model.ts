import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { DEFAULT_TIMEZONE, MENTEE_AUDIENCES, SESSION_TYPES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

const windowSchema = new Schema({ start: String, end: String }, { _id: false, strict: 'throw' });

/** A member's mentor setup, including availability (embedded so it changes atomically with the settings). */
const mentorSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    accepting: { type: Boolean, default: false },
    weeklyCap: { type: Number, default: 5, min: 1, max: 30 },
    audience: { type: String, enum: MENTEE_AUDIENCES, default: 'both' },
    sessionTypes: {
      type: [
        { type: { type: String, enum: SESSION_TYPES }, enabled: Boolean, durationMin: Number, _id: false },
      ],
      default: [],
    },
    minNoticeHours: { type: Number, default: 12 },
    horizonDays: { type: Number, default: 30 },
    bufferMin: { type: Number, default: 0 },
    timezone: { type: String, default: DEFAULT_TIMEZONE },
    weekly: { type: [{ day: Number, windows: [windowSchema], _id: false }], default: [] },
    exceptions: { type: [{ date: String, windows: [windowSchema], _id: false }], default: [] },
  },
  baseSchemaOptions,
);
mentorSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
mentorSchema.index({ tenantId: 1, accepting: 1, _id: -1 });
export type MentorProfile = InferSchemaType<typeof mentorSchema>;
export type MentorDoc = MentorProfile & { _id: Types.ObjectId };
export const MentorProfileModel = defineTenantModel('MentorProfile', mentorSchema);

/** Private match inputs of a mentee; never shown to anyone else. */
const prefsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    goals: { type: [String], default: [] },
    targetCompanies: { type: [String], default: [] },
  },
  baseSchemaOptions,
);
prefsSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
export const MenteePrefsModel = defineTenantModel('MenteePrefs', prefsSchema);
