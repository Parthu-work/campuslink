import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { STORY_BACKGROUNDS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';
import { removalFragment } from '../../db/fragments.js';

/** 24-hour stories (events, job alerts). Deleted by TTL; their photos are purged with the file retention job. */
const storySchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['text', 'photo'], required: true },
    text: { type: String, default: '', maxlength: 200 },
    background: { type: String, enum: [...STORY_BACKGROUNDS, null], default: null },
    fileId: { type: Schema.Types.ObjectId, default: null },
    alt: { type: String, default: '', maxlength: 200 },
    link: { type: String, default: null },
    linkLabel: { type: String, default: null, maxlength: 40 },
    status: { type: String, enum: ['published', 'removed'], default: 'published' },
    removal: removalFragment,
    expiresAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
storySchema.index({ tenantId: 1, status: 1, expiresAt: -1 });
storySchema.index({ tenantId: 1, fileId: 1 }, { sparse: true });
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type StoryDoc = InferSchemaType<typeof storySchema> & { _id: Types.ObjectId; createdAt: Date };
export const StoryModel = defineTenantModel('Story', storySchema);

/** People, topics and sources a member follows. */
const followSchema = new Schema(
  {
    followerId: { type: Schema.Types.ObjectId, required: true },
    targetType: { type: String, enum: ['user', 'topic', 'source'], required: true },
    targetId: { type: String, required: true },
  },
  baseSchemaOptions,
);
followSchema.index({ tenantId: 1, followerId: 1, targetType: 1, targetId: 1 }, { unique: true });
followSchema.index({ tenantId: 1, targetType: 1, targetId: 1 });
export const FollowModel = defineTenantModel('Follow', followSchema);

/** The daily "One Useful Thing" (a staff pick; otherwise computed and cached for the day). */
const outSchema = new Schema(
  {
    date: { type: String, required: true },
    targetType: { type: String, enum: ['post', 'item'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    curatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
outSchema.index({ tenantId: 1, date: 1 }, { unique: true });
export const OneUsefulThingModel = defineTenantModel('OneUsefulThing', outSchema);
