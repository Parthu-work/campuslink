import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { AI_PROVIDERS, EMBEDDING_PROVIDERS, KEY_STATUSES, PRICE_CURRENCIES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * One stored provider key. The key is encrypted with FieldCipher (`apiKeyEnc`, covered by
 * `rotate-field-key`); only its last four characters are ever shown, and it is never logged.
 */
const key = () => ({
  apiKeyEnc: { type: String, default: null },
  last4: { type: String, default: null },
  status: { type: String, enum: KEY_STATUSES, default: 'not_set' },
  validatedAt: { type: Date, default: null },
  models: { type: [String], default: [] },
  error: { type: String, default: null },
  setAt: { type: Date, default: null },
  setBy: { type: Schema.Types.ObjectId, default: null },
});

/** The college's AI study assistant settings (one document per college). */
const aiSettingsSchema = new Schema(
  {
    /** null until the admin chooses (members then get keyword search and extractive answers). */
    chatProvider: { type: String, enum: [...AI_PROVIDERS, null], default: null },
    chatModel: { type: String, default: '', maxlength: 120 },
    embeddingProvider: { type: String, enum: [...EMBEDDING_PROVIDERS, null], default: null },
    embeddingModel: { type: String, default: '', maxlength: 120 },
    baseUrl: { type: String, default: null },
    embeddingBaseUrl: { type: String, default: null },
    temperature: { type: Number, default: null, min: 0, max: 1 },
    maxAnswerTokens: { type: Number, default: 1024 },
    maxChunks: { type: Number, default: 6 },
    monthlyTokenBudget: { type: Number, default: 0 },
    dailyMessagesPerUser: { type: Number, default: 40 },
    chatRetentionDays: { type: Number, default: 180 },
    features: {
      chatbot: { type: Boolean, default: false },
      studentUploads: { type: Boolean, default: false },
      externalVideos: { type: Boolean, default: false },
      ocr: { type: Boolean, default: true },
      transcription: { type: Boolean, default: true },
      facultySeeChats: { type: Boolean, default: false },
    },
    killSwitch: { type: Boolean, default: false },
    /** Provider prices per million tokens as the admin entered them (cost estimate only). */
    prices: {
      currency: { type: String, enum: PRICE_CURRENCIES, default: 'USD' },
      chatInput: { type: Number, default: null },
      chatOutput: { type: Number, default: null },
      embedding: { type: Number, default: null },
    },
    /** Months (`YYYY-MM`) the admins were already told about the budget (once each per month). */
    alerts: {
      budgetWarned: { type: String, default: null },
      budgetReached: { type: String, default: null },
    },
    /** The last provider failure while answering (short, key-free), for the admin dashboard. */
    health: {
      lastError: { type: String, default: null },
      lastErrorAt: { type: Date, default: null },
    },
    keys: { chat: key(), embedding: key(), youtube: key() },
    /** The back-fill lease (one embedding run per college at a time) and its last outcome. */
    indexing: {
      owner: { type: String, default: null },
      until: { type: Date, default: null },
      lastRunAt: { type: Date, default: null },
      lastError: { type: String, default: null },
    },
    /** The admin's acceptance of the data-processing notice (versioned; also in the audit log). */
    consent: {
      version: { type: String, default: null },
      acceptedAt: { type: Date, default: null },
      acceptedBy: { type: Schema.Types.ObjectId, default: null },
    },
  },
  baseSchemaOptions,
);
aiSettingsSchema.index({ tenantId: 1 }, { unique: true });
export type AiSettingsDoc = InferSchemaType<typeof aiSettingsSchema> & { _id: Types.ObjectId };
export const AiSettingsModel = defineTenantModel('AiSettings', aiSettingsSchema);
