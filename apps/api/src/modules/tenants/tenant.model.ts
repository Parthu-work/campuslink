import { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { FEATURE_KEYS, NEW_TENANT_FEATURES } from '@campuslink/shared';
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
    /** The uploaded logo (a `branding` file); null shows the monogram. */
    logo: { fileId: { type: Schema.Types.ObjectId, default: null } },
    /** Feature switches (B1). A new college starts focused; see NEW_TENANT_FEATURES. */
    features: Object.fromEntries(
      FEATURE_KEYS.map((k) => [k, { type: Boolean, default: NEW_TENANT_FEATURES[k] }]),
    ) as Record<(typeof FEATURE_KEYS)[number], { type: BooleanConstructor; default: boolean }>,
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
