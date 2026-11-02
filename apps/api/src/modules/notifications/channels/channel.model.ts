import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { NOTIFICATION_CATEGORIES } from '@campuslink/shared';
import { defineTenantModel, definePlatformModel, baseSchemaOptions } from '../../../db/models.js';

export const CHANNEL_STATUSES = ['sent', 'delivered', 'read', 'failed'] as const;

/**
 * One outbound WhatsApp message (B3): what was sent to whom and how it fared. Holds ids and the
 * template name only, never text. The per-member weekly cap counts these.
 */
const channelMessageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    channel: { type: String, enum: ['whatsapp', 'sms'], required: true },
    template: { type: String, required: true },
    category: { type: String, enum: [...NOTIFICATION_CATEGORIES, 'authentication'], required: true },
    /** Codes, session reminders and drive deadlines: exempt from the member's weekly cap. */
    critical: { type: Boolean, default: false },
    providerMessageId: { type: String, required: true },
    status: { type: String, enum: CHANNEL_STATUSES, default: 'sent' },
    statusAt: { type: Date, default: null },
    /** Deleted with the member, or after 90 days. */
    expiresAt: { type: Date, required: true },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
channelMessageSchema.index({ tenantId: 1, providerMessageId: 1 }, { unique: true });
channelMessageSchema.index({ tenantId: 1, userId: 1, channel: 1, createdAt: -1 });
channelMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type ChannelMessageDoc = InferSchemaType<typeof channelMessageSchema> & { _id: Types.ObjectId };
export const ChannelMessageModel = defineTenantModel('ChannelMessage', channelMessageSchema);

/** Messages per day, channel and category (metering against the plan's allowance; no member ids). */
const channelUsageSchema = new Schema(
  {
    day: { type: String, required: true },
    channel: { type: String, enum: ['whatsapp', 'sms'], required: true },
    category: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);
channelUsageSchema.index({ tenantId: 1, day: 1, channel: 1, category: 1 }, { unique: true });
export const ChannelUsageModel = defineTenantModel('ChannelUsage', channelUsageSchema);

/**
 * Webhook deliveries already handled (Meta retries; a message id is processed once). Platform-level:
 * the webhook does not know the college until it has looked the message up.
 */
const webhookReceiptSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
webhookReceiptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const WebhookReceiptModel = definePlatformModel('WebhookReceipt', webhookReceiptSchema);
