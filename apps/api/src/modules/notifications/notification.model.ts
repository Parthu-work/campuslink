import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { DEFAULT_TIMEZONE, NOTIFICATION_TYPES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    /** Ids and display names only, rendered with i18n on the client. Never message text. */
    data: { type: Map, of: String, default: {} },
    readAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
notificationSchema.index({ tenantId: 1, userId: 1, _id: -1 });
notificationSchema.index({ tenantId: 1, userId: 1, readAt: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type NotificationDoc = InferSchemaType<typeof notificationSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const NotificationModel = defineTenantModel('Notification', notificationSchema);

const channel = { inApp: Boolean, email: Boolean, push: Boolean };
const prefsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    channels: {
      requests: { type: channel, _id: false },
      sessions: { type: channel, _id: false },
      reminders: { type: channel, _id: false },
      messages: { type: channel, _id: false },
      community: { type: channel, _id: false },
      moderation: { type: channel, _id: false },
    },
    quietHours: {
      enabled: { type: Boolean, default: false },
      start: { type: String, default: '22:00' },
      end: { type: String, default: '07:00' },
      timezone: { type: String, default: DEFAULT_TIMEZONE },
    },
  },
  baseSchemaOptions,
);
prefsSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
export const NotificationPrefsModel = defineTenantModel('NotificationPrefs', prefsSchema);

/** Web push subscriptions. The endpoint is a capability URL, so it is stored encrypted. */
const pushSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    endpointEnc: { type: String, required: true },
    endpointIndex: { type: String, required: true },
    keysEnc: { type: String, required: true },
    failures: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
pushSchema.index({ tenantId: 1, endpointIndex: 1 }, { unique: true });
pushSchema.index({ tenantId: 1, userId: 1 });
export const PushSubscriptionModel = defineTenantModel('PushSubscription', pushSchema);
