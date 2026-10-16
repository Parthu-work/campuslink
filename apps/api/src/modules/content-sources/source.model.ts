import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { BRANCHES, TOPICS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';
import { removalFragment } from '../../db/fragments.js';

const sourceSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    url: { type: String, required: true },
    host: { type: String, required: true },
    starterKey: { type: String, default: null },
    topics: { type: [{ type: String, enum: TOPICS }], default: [] },
    branches: { type: [{ type: String, enum: BRANCHES }], default: [] },
    intervalMin: { type: Number, default: 180 },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    etag: { type: String, default: null },
    lastModified: { type: String, default: null },
    nextFetchAt: { type: Date, default: () => new Date() },
    lastFetchedAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 300 },
    lastOutcome: { type: String, enum: ['ok', 'not_modified', 'blocked', 'error', null], default: null },
    consecutiveFailures: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);
sourceSchema.index({ tenantId: 1, url: 1 }, { unique: true });
sourceSchema.index({ tenantId: 1, status: 1, nextFetchAt: 1 });
export type SourceDoc = InferSchemaType<typeof sourceSchema> & { _id: Types.ObjectId; createdAt: Date };
export const ContentSourceModel = defineTenantModel('ContentSource', sourceSchema);

/** An ingested item: snippet + link-out with attribution. Never the full article. */
const itemSchema = new Schema(
  {
    sourceId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 200 },
    snippet: { type: String, default: '', maxlength: 300 },
    url: { type: String, required: true },
    host: { type: String, required: true },
    urlHash: { type: String, required: true },
    contentHash: { type: String, required: true },
    publishedAt: { type: Date, required: true },
    topics: { type: [{ type: String, enum: TOPICS }], default: [] },
    branches: { type: [{ type: String, enum: BRANCHES }], default: [] },
    status: { type: String, enum: ['published', 'held', 'rejected', 'removed'], default: 'published' },
    quality: { type: [String], default: [] },
    removal: removalFragment,
    expiresAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
itemSchema.index({ tenantId: 1, urlHash: 1 }, { unique: true });
itemSchema.index({ tenantId: 1, contentHash: 1, publishedAt: -1 });
itemSchema.index({ tenantId: 1, status: 1, publishedAt: -1 });
itemSchema.index({ tenantId: 1, sourceId: 1, publishedAt: -1 });
itemSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type ItemDoc = InferSchemaType<typeof itemSchema> & { _id: Types.ObjectId; createdAt: Date };
export const ContentItemModel = defineTenantModel('ContentItem', itemSchema);
