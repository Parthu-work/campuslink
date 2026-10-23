import { Schema, type InferSchemaType, type Types } from 'mongoose';
import {
  CHUNK_EMBEDDING_STATUSES,
  MATERIAL_LANGUAGES,
  MATERIAL_TABS,
  MATERIAL_TYPES,
  MATERIAL_VISIBILITY,
  PROCESSING_STAGES,
} from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

/**
 * A piece of study material: a file (PDF, document, slides, notes, image, video, audio) or a video
 * link. The file itself lives in FilesService (`study_material`); this is its record, tags,
 * visibility, versions and processing summary.
 */
const materialSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 160 },
    description: { type: String, default: '', maxlength: 2000 },
    type: { type: String, enum: MATERIAL_TYPES, required: true },
    category: { type: String, enum: MATERIAL_TABS, required: true },
    language: { type: String, enum: MATERIAL_LANGUAGES, default: 'en' },
    /** null once the uploader's account is erased ("Former member"). */
    uploaderId: { type: Schema.Types.ObjectId, default: null },
    fileId: { type: Schema.Types.ObjectId, default: null },
    mime: { type: String, default: null },
    size: { type: Number, default: 0 },
    /** SHA-256 of the uploaded bytes, for duplicate detection within a subject. */
    checksum: { type: String, default: null },
    pageCount: { type: Number, default: null },
    durationSec: { type: Number, default: null },
    unitId: { type: Schema.Types.ObjectId, default: null },
    topicIds: { type: [Schema.Types.ObjectId], default: [] },
    visibility: { type: String, enum: MATERIAL_VISIBILITY, default: 'draft' },
    version: { type: Number, default: 1 },
    versions: {
      type: [
        {
          version: Number,
          checksum: String,
          size: Number,
          uploaderId: Schema.Types.ObjectId,
          at: Date,
          _id: false,
        },
      ],
      default: [],
    },
    link: {
      type: {
        provider: { type: String, enum: ['youtube', 'vimeo'] },
        url: String,
        videoId: String,
        embedUrl: String,
        author: String,
      },
      default: null,
      _id: false,
    },
    transcriptSource: { type: String, enum: ['none', 'uploaded', 'generated'], default: 'none' },
    thumbnailFileId: { type: Schema.Types.ObjectId, default: null },
    chapters: { type: [{ at: Number, title: String, _id: false }], default: [] },
    rightsAttestedAt: { type: Date, required: true },
    reviewNote: { type: String, default: null, maxlength: 500 },
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    takedown: {
      type: { reason: String, by: Schema.Types.ObjectId, at: Date },
      default: null,
      _id: false,
    },
    // Processing summary (the job keeps the detail).
    stage: { type: String, enum: PROCESSING_STAGES, default: 'uploaded' },
    progress: { type: Number, default: 0 },
    error: { type: String, default: null },
    chunkCount: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);
materialSchema.index({ tenantId: 1, subjectId: 1, visibility: 1, category: 1, createdAt: -1 });
materialSchema.index({ tenantId: 1, subjectId: 1, checksum: 1 });
materialSchema.index({ tenantId: 1, uploaderId: 1 });
materialSchema.index({ tenantId: 1, fileId: 1 });
materialSchema.index({ tenantId: 1, thumbnailFileId: 1 });
export type MaterialDoc = InferSchemaType<typeof materialSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export const MaterialModel = defineTenantModel('Material', materialSchema);

/** One run of the pipeline for one version of a material (resumable and idempotent). */
const jobSchema = new Schema(
  {
    materialId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    stage: { type: String, enum: PROCESSING_STAGES, default: 'uploaded' },
    progress: { type: Number, default: 0 },
    error: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    /** Gave up after the last attempt (dead letter); a manual re-process starts again. */
    dead: { type: Boolean, default: false },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    history: { type: [{ stage: String, at: Date, _id: false }], default: [] },
  },
  baseSchemaOptions,
);
jobSchema.index({ tenantId: 1, materialId: 1, version: 1 }, { unique: true });
jobSchema.index({ tenantId: 1, stage: 1, updatedAt: -1 });
export type MaterialJobDoc = InferSchemaType<typeof jobSchema> & { _id: Types.ObjectId };
export const MaterialJobModel = defineTenantModel('MaterialJob', jobSchema);

/** The text of each page (or slide), kept so re-chunking never needs re-extraction. */
const pageSchema = new Schema(
  {
    materialId: { type: Schema.Types.ObjectId, required: true },
    page: { type: Number, required: true },
    text: { type: String, default: '' },
    /** Text came from OCR (a scanned page). */
    ocr: { type: Boolean, default: false },
  },
  baseSchemaOptions,
);
pageSchema.index({ tenantId: 1, materialId: 1, page: 1 }, { unique: true });
export type MaterialPageDoc = InferSchemaType<typeof pageSchema> & { _id: Types.ObjectId };
export const MaterialPageModel = defineTenantModel('MaterialPage', pageSchema);

/**
 * A passage of a material for retrieval: its text, where it is (page or time range), the syllabus
 * topics it is tagged to, and its embedding (status, model and vector). `visibility` mirrors the
 * material so searches can filter to published material without a join.
 */
const chunkSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    index: { type: Number, required: true },
    text: { type: String, required: true },
    heading: { type: String, default: '' },
    page: { type: Number, default: null },
    startSec: { type: Number, default: null },
    endSec: { type: Number, default: null },
    unitId: { type: Schema.Types.ObjectId, default: null },
    topicIds: { type: [Schema.Types.ObjectId], default: [] },
    tokenCount: { type: Number, required: true },
    contentHash: { type: String, required: true },
    visibility: { type: String, enum: MATERIAL_VISIBILITY, required: true },
    embeddingStatus: { type: String, enum: CHUNK_EMBEDDING_STATUSES, default: 'embedding_pending' },
    /** `provider:model` that made the stored vector; a different one means re-index, never mix. */
    embeddingModel: { type: String, default: null },
    /**
     * The embedding as float32 bytes. The vector store is an index over these, so a lost or new
     * index is rebuilt without paying the provider again (and the in-memory store reloads them).
     */
    vector: { type: Buffer, default: null, select: false },
    embeddedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
chunkSchema.index({ tenantId: 1, materialId: 1, index: 1 });
chunkSchema.index({ tenantId: 1, subjectId: 1, visibility: 1 });
chunkSchema.index({ tenantId: 1, embeddingStatus: 1, embeddingModel: 1 });
chunkSchema.index(
  { tenantId: 1, text: 'text', heading: 'text' },
  { name: 'chunk_search', weights: { heading: 3, text: 1 }, default_language: 'english' },
);
export type ContentChunkDoc = InferSchemaType<typeof chunkSchema> & { _id: Types.ObjectId };
export const ContentChunkModel = defineTenantModel('ContentChunk', chunkSchema);

/** A timed piece of a video's transcript, for the transcript panel and `/videos` deep links. */
const segmentSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    index: { type: Number, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    text: { type: String, required: true },
    chapter: { type: String, default: '' },
    topicIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  baseSchemaOptions,
);
segmentSchema.index({ tenantId: 1, materialId: 1, start: 1 });
export type VideoSegmentDoc = InferSchemaType<typeof segmentSchema> & { _id: Types.ObjectId };
export const VideoSegmentModel = defineTenantModel('VideoSegment', segmentSchema);

/**
 * How often members opened each material, per UTC day: a counter with no member id, for the
 * faculty's "most used material" insight. Staff previews of their own subjects are not counted.
 * Rows go after about 13 months.
 */
const viewStatSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    views: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);
viewStatSchema.index({ tenantId: 1, materialId: 1, day: 1 }, { unique: true });
viewStatSchema.index({ tenantId: 1, subjectId: 1, day: 1 });
viewStatSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 86_400 });
export type MaterialViewStatDoc = InferSchemaType<typeof viewStatSchema> & { _id: Types.ObjectId };
export const MaterialViewStatModel = defineTenantModel('MaterialViewStat', viewStatSchema);
