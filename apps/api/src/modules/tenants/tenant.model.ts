import { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { definePlatformModel, baseSchemaOptions } from '../../db/models.js';

/** The tenant registry is the only platform-level collection besides nothing else in Phase 1. */
const tenantSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    kind: { type: String, enum: ['college', 'platform'], default: 'college', required: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', required: true },
    branding: {
      displayName: { type: String, required: true },
      shortName: { type: String, required: true },
      primary: { type: String, required: true },
      secondary: { type: String, required: true },
      accent: { type: String, required: true },
      monogram: { type: String, required: true },
      city: { type: String },
    },
    features: {
      studentPosting: { type: Boolean, default: false },
      stories: { type: Boolean, default: true },
      leaderboards: { type: Boolean, default: false },
      alumniMatch: { type: Boolean, default: true },
      jobsAggregation: { type: Boolean, default: true },
    },
    allowedEmailDomains: { type: [String], default: [] },
    limits: {
      mentorshipRequestsPerWeek: { type: Number, default: 5 },
      referralRequestsPerWeek: { type: Number, default: 3 },
    },
    permissionOverrides: {
      grant: { type: Schema.Types.Mixed, default: {} },
      revoke: { type: Schema.Types.Mixed, default: {} },
    },
    subscription: {
      plan: { type: String, enum: ['trial', 'standard', 'premium'], default: 'trial' },
      seatLimit: { type: Number, default: 1000 },
      renewalDate: { type: Date, default: null },
    },
    retention: {
      inactiveAccountDays: { type: Number, default: 1095 },
      deletedAccountGraceDays: { type: Number, default: 30 },
    },
    suspendedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

export type TenantDoc = HydratedDocument<InferSchemaType<typeof tenantSchema>>;
export const TenantModel = definePlatformModel('Tenant', tenantSchema);
