import { Schema, type InferSchemaType } from 'mongoose';
import { AUDIENCES, BRANCHES, DEFAULT_VISIBILITY, PROFILE_FIELDS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

const visibility = Object.fromEntries(
  PROFILE_FIELDS.map((f) => [f, { type: String, enum: AUDIENCES, default: DEFAULT_VISIBILITY[f] }]),
);

const profileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    /** Denormalised for directory listing/search; kept in sync by the users and verification services. */
    name: { type: String, required: true },
    roles: { type: [String], default: [] },
    verified: { type: Boolean, default: false },
    headline: { type: String, default: '' },
    company: { type: String, default: '' },
    jobTitle: { type: String, default: '' },
    location: { type: String, default: '' },
    bio: { type: String, default: '' },
    skills: { type: [String], default: [] },
    topics: { type: [String], default: [] },
    languages: { type: [String], default: [] },
    links: { type: [{ label: String, url: String, _id: false }], default: [] },
    phoneEnc: { type: String, default: null },
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    gradYear: { type: Number, default: null },
    avatarFileId: { type: Schema.Types.ObjectId, default: null },
    companyVerified: { company: String, domain: String, verifiedAt: Date },
    visibility: visibility,
  },
  baseSchemaOptions,
);
profileSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
profileSchema.index({ tenantId: 1, verified: 1, _id: -1 });
profileSchema.index({ tenantId: 1, verified: 1, roles: 1, branch: 1, gradYear: 1 });
profileSchema.index(
  { tenantId: 1, name: 'text', headline: 'text', company: 'text', skills: 'text' },
  { name: 'profile_search', weights: { name: 5, company: 3, skills: 2, headline: 1 } },
);

export type Profile = InferSchemaType<typeof profileSchema>;
export const ProfileModel = defineTenantModel('Profile', profileSchema);
