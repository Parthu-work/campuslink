import { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { FEATURE_KEYS, NEW_TENANT_FEATURES, PLAN_IDS } from '@campuslink/shared';
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
    /** Plan and term (B10). `terms` is a custom deal: only the plan terms it changes. */
    subscription: {
      plan: { type: String, enum: PLAN_IDS, default: 'pilot' },
      /** Contracted seats: the enrolled students the college is quoted for (never a hard limit). */
      seats: { type: Number, default: 1000 },
      startedOn: { type: Date, default: null },
      renewalDate: { type: Date, default: null },
      terms: { type: Schema.Types.Mixed, default: null },
    },
    /** Invoicing and the state the billing timer keeps (B10). */
    billing: {
      buyer: {
        type: new Schema(
          {
            legalName: { type: String, required: true },
            address: { type: String, required: true },
            gstin: { type: String, default: null },
            stateCode: { type: String, required: true },
          },
          { _id: false, strict: 'throw' },
        ),
        default: null,
      },
      /** Seats in use (verified students + alumni active in 12 months), counted nightly. */
      seatsUsed: { type: Number, default: null },
      seatsCountedAt: { type: Date, default: null },
      /** Set when an invoice is 30 days overdue; cleared when it is paid. Nothing is deleted. */
      readOnlyAt: { type: Date, default: null },
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
