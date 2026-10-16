import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { BRANCHES, ROADMAP_CATEGORIES, ROADMAP_STATUSES, VERSION_STATUSES } from '@campuslink/shared';
import type { RoadmapContent } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';
import { removalFragment } from '../../db/fragments.js';

/**
 * A roadmap: the published version's summary fields are copied here for listing and search. The
 * content of every version (draft, submitted, published, superseded) lives in RoadmapVersion.
 */
const roadmapSchema = new Schema(
  {
    slug: { type: String, required: true, maxlength: 80 },
    /** Set for roadmaps installed from the researched library. */
    libraryKey: { type: String, default: null },
    /** Hash of the library content last installed, to offer updates. */
    libraryHash: { type: String, default: null },
    status: { type: String, enum: ROADMAP_STATUSES, default: 'draft' },
    title: { type: String, required: true, maxlength: 100 },
    summary: { type: String, required: true, maxlength: 600 },
    category: { type: String, enum: ROADMAP_CATEGORIES, required: true },
    branches: { type: [{ type: String, enum: BRANCHES }], default: [] },
    nodeCount: { type: Number, default: 0 },
    needsReviewCount: { type: Number, default: 0 },
    featured: { type: Boolean, default: false },
    /** Who started it (null for library roadmaps, which are attributed to the platform's research). */
    createdBy: { type: Schema.Types.ObjectId, default: null },
    publishedVersion: { type: Number, default: null },
    latestVersion: { type: Number, default: 1 },
    /** The open (draft or submitted) version, if any; at most one at a time. */
    openVersion: { type: Number, default: null },
    lastReviewedAt: { type: Date, default: null },
    removal: removalFragment,
  },
  baseSchemaOptions,
);
roadmapSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
roadmapSchema.index(
  { tenantId: 1, libraryKey: 1 },
  { unique: true, partialFilterExpression: { libraryKey: { $type: 'string' } } },
);
roadmapSchema.index({ tenantId: 1, status: 1, category: 1, featured: -1, title: 1 });
roadmapSchema.index({ tenantId: 1, createdBy: 1 });
roadmapSchema.index(
  { tenantId: 1, title: 'text', summary: 'text' },
  { name: 'roadmap_search', weights: { title: 5, summary: 1 } },
);
export type RoadmapDoc = InferSchemaType<typeof roadmapSchema> & { _id: Types.ObjectId; createdAt: Date };
export const RoadmapModel = defineTenantModel('Roadmap', roadmapSchema);

/** One version of a roadmap's content. Published and superseded versions are never edited. */
const versionSchema = new Schema(
  {
    roadmapId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    status: { type: String, enum: VERSION_STATUSES, default: 'draft' },
    /** Validated with `roadmapContent` before every write. */
    content: { type: Schema.Types.Mixed, required: true },
    changeNote: { type: String, default: '', maxlength: 300 },
    /** Who started this version (null for library versions). */
    authorId: { type: Schema.Types.ObjectId, default: null },
    /** Everyone who saved this version: none of them may approve it. */
    editorIds: { type: [Schema.Types.ObjectId], default: [] },
    submittedAt: { type: Date, default: null },
    reviewerId: { type: Schema.Types.ObjectId, default: null },
    reviewNote: { type: String, default: '', maxlength: 1000 },
    reviewedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, minimize: false },
);
versionSchema.index({ tenantId: 1, roadmapId: 1, version: -1 }, { unique: true });
versionSchema.index({ tenantId: 1, status: 1, submittedAt: 1 });
export type VersionDoc = Omit<InferSchemaType<typeof versionSchema>, 'content'> & {
  _id: Types.ObjectId;
  content: RoadmapContent;
  createdAt: Date;
};
export const RoadmapVersionModel = defineTenantModel('RoadmapVersion', versionSchema);

/** A member's progress on one roadmap (node ids done, with when), and their weekly goal. */
const progressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    roadmapId: { type: Schema.Types.ObjectId, required: true },
    done: {
      type: [new Schema({ nodeId: String, at: Date }, { _id: false, strict: 'throw' })],
      default: [],
    },
    nodesPerWeek: { type: Number, default: 0, min: 0, max: 10 },
    /** When the next weekly check (and nudge if behind) is due; null when there is no goal. */
    nextNudgeAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
progressSchema.index({ tenantId: 1, userId: 1, roadmapId: 1 }, { unique: true });
progressSchema.index({ tenantId: 1, roadmapId: 1 });
progressSchema.index({ tenantId: 1, nextNudgeAt: 1 });
export type ProgressDoc = InferSchemaType<typeof progressSchema> & { _id: Types.ObjectId };
export const RoadmapProgressModel = defineTenantModel('RoadmapProgress', progressSchema);

/** A comment on one node of one version, for authors and reviewers. */
const commentSchema = new Schema(
  {
    roadmapId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    nodeId: { type: String, required: true, maxlength: 40 },
    authorId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['published', 'removed'], default: 'published' },
    removal: removalFragment,
  },
  baseSchemaOptions,
);
commentSchema.index({ tenantId: 1, roadmapId: 1, _id: 1 });
commentSchema.index({ tenantId: 1, authorId: 1 });
export type RoadmapCommentDoc = InferSchemaType<typeof commentSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const RoadmapCommentModel = defineTenantModel('RoadmapComment', commentSchema);
