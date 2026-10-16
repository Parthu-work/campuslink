import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { BRANCHES, POST_KINDS, REACTIONS, TOPICS } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';
import { removalFragment } from '../../db/fragments.js';

const postSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: POST_KINDS, required: true },
    /** Plain text (markup stripped on write); a markdown subset is rendered by the client. */
    body: { type: String, default: '', maxlength: 3000 },
    hashtags: { type: [String], default: [] },
    topics: { type: [{ type: String, enum: TOPICS }], default: [] },
    media: {
      type: [
        {
          fileId: Schema.Types.ObjectId,
          alt: String,
          kind: { type: String, enum: ['image', 'video'] },
          mime: String,
          durationSec: { type: Number, default: null },
          _id: false,
        },
      ],
      default: [],
    },
    poll: {
      type: {
        options: [{ text: String, votes: { type: Number, default: 0 }, _id: false }],
        closesAt: Date,
      },
      default: null,
    },
    link: {
      type: { url: String, host: String, title: String, description: String, siteName: String },
      default: null,
    },
    announcement: { type: Boolean, default: false },
    /** Denormalised author facts for ranking. */
    authorAlumni: { type: Boolean, default: false },
    authorBranch: { type: String, enum: [...BRANCHES, null], default: null },
    counts: {
      helpful: { type: Number, default: 0 },
      insightful: { type: Number, default: 0 },
      celebrate: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      saves: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
    },
    status: { type: String, enum: ['published', 'removed'], default: 'published' },
    removal: removalFragment,
  },
  baseSchemaOptions,
);
postSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
postSchema.index({ tenantId: 1, authorId: 1, createdAt: -1 });
postSchema.index({ tenantId: 1, kind: 1, status: 1, createdAt: -1 });
postSchema.index({ tenantId: 1, topics: 1, createdAt: -1 });
postSchema.index({ tenantId: 1, 'media.fileId': 1 }, { sparse: true });
postSchema.index(
  { tenantId: 1, body: 'text', hashtags: 'text' },
  { name: 'post_search', weights: { hashtags: 3, body: 1 } },
);
export type Post = InferSchemaType<typeof postSchema>;
export type PostDoc = Post & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const PostModel = defineTenantModel('Post', postSchema);

const commentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    parentId: { type: Schema.Types.ObjectId, default: null },
    body: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['published', 'removed'], default: 'published' },
    removal: removalFragment,
  },
  baseSchemaOptions,
);
commentSchema.index({ tenantId: 1, postId: 1, _id: 1 });
commentSchema.index({ tenantId: 1, authorId: 1, _id: -1 });
export type CommentDoc = InferSchemaType<typeof commentSchema> & { _id: Types.ObjectId; createdAt: Date };
export const CommentModel = defineTenantModel('Comment', commentSchema);

const reactionSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    reaction: { type: String, enum: REACTIONS, required: true },
  },
  baseSchemaOptions,
);
reactionSchema.index({ tenantId: 1, postId: 1, userId: 1 }, { unique: true });
reactionSchema.index({ tenantId: 1, userId: 1 });
export const ReactionModel = defineTenantModel('Reaction', reactionSchema);

const saveSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
saveSchema.index({ tenantId: 1, postId: 1, userId: 1 }, { unique: true });
saveSchema.index({ tenantId: 1, userId: 1, _id: -1 });
export const SaveModel = defineTenantModel('SavedPost', saveSchema);

const voteSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    option: { type: Number, required: true, min: 0, max: 3 },
  },
  baseSchemaOptions,
);
voteSchema.index({ tenantId: 1, postId: 1, userId: 1 }, { unique: true });
export const PollVoteModel = defineTenantModel('PollVote', voteSchema);
