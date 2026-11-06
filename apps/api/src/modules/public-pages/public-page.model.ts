import { Schema, type Types } from 'mongoose';
import {
  PUBLIC_NAME_STYLES,
  PUBLIC_PAGE_KINDS,
  type PublicNameStyle,
  type PublicPageKind,
} from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/**
 * An opt-in public page (prompt 2, G8, E4): a member chose to show one achievement at
 * /p/<slug>. What it says is computed when it is served (from the verified offer, the finished
 * roadmap or the mentoring record), so a revoked offer or a page taken down is gone at once.
 */
export interface PublicPageDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  kind: PublicPageKind;
  refId: Types.ObjectId | null;
  slug: string;
  nameStyle: PublicNameStyle;
  indexable: boolean;
  status: 'live' | 'revoked';
  views: number;
  /** The last day a view was recorded as an event (at most one event per page a day). */
  lastViewDay: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}
const pageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: PUBLIC_PAGE_KINDS, required: true },
    refId: { type: Schema.Types.ObjectId, default: null },
    slug: { type: String, required: true, match: /^[a-z0-9][a-z0-9-]{2,79}$/ },
    nameStyle: { type: String, enum: PUBLIC_NAME_STYLES, default: 'full' },
    indexable: { type: Boolean, default: false },
    status: { type: String, enum: ['live', 'revoked'], default: 'live' },
    views: { type: Number, default: 0 },
    lastViewDay: { type: String, default: null },
    revokedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
pageSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
pageSchema.index({ tenantId: 1, userId: 1, status: 1 });
// One live page per member, kind and subject.
pageSchema.index(
  { tenantId: 1, userId: 1, kind: 1, refId: 1 },
  { unique: true, partialFilterExpression: { status: 'live' } },
);
export const PublicPageModel = defineTenantModel('PublicPage', pageSchema);

/**
 * The college's growth settings (one per college): member invites (the college confirms the people
 * on its list agreed to hear from it on WhatsApp) and the public outcomes page (opt-in).
 */
export interface GrowthSettingsDoc {
  _id: Types.ObjectId;
  key: 'growth';
  memberInvites: { enabled: boolean; attestedBy: Types.ObjectId | null; attestedAt: Date | null };
  outcomesPage: { enabled: boolean; by: Types.ObjectId | null; at: Date | null };
}
const settingsSchema = new Schema(
  {
    key: { type: String, enum: ['growth'], default: 'growth' },
    memberInvites: {
      enabled: { type: Boolean, default: false },
      attestedBy: { type: Schema.Types.ObjectId, default: null },
      attestedAt: { type: Date, default: null },
    },
    outcomesPage: {
      enabled: { type: Boolean, default: false },
      by: { type: Schema.Types.ObjectId, default: null },
      at: { type: Date, default: null },
    },
  },
  baseSchemaOptions,
);
settingsSchema.index({ tenantId: 1, key: 1 }, { unique: true });
export const GrowthSettingsModel = defineTenantModel('GrowthSettings', settingsSchema);
