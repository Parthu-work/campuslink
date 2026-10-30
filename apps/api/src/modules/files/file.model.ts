import { Schema, type InferSchemaType } from 'mongoose';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';

export const FILE_PURPOSES = [
  'avatar',
  'id_card',
  'import_source',
  'message_attachment',
  'post_media',
  'story_media',
  'referral_resume',
  'study_material',
  'study_thumbnail',
  'study_transcript',
  'branding',
  // Placements (B7): a résumé attached to a drive registration, and proof of an offer.
  'placement_resume',
  'offer_proof',
  // Billing (B10): an issued invoice's PDF, served only through the billing routes.
  'invoice',
] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

const fileSchema = new Schema(
  {
    /** null for shared study material whose uploader's account was erased (it stays with the college). */
    ownerId: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
    purpose: { type: String, enum: FILE_PURPOSES, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    storageKey: { type: String, required: true },
    sha256: { type: String, required: true },
    scanStatus: { type: String, enum: ['skipped', 'clean', 'infected'], default: 'skipped' },
    /** Retention: a purge job deletes the blob and this record after this time. */
    deleteAfter: { type: Date, default: null },
    /** Upload-then-attach media: set once a post or story claims the file (claims are single-use). */
    attachedAt: { type: Date, default: null },
    durationSec: { type: Number, default: null },
  },
  { ...baseSchemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);
fileSchema.index({ tenantId: 1, ownerId: 1, purpose: 1 });
fileSchema.index({ tenantId: 1, deleteAfter: 1 });

export type StoredFile = InferSchemaType<typeof fileSchema> & { _id: Schema.Types.ObjectId };
export const FileModel = defineTenantModel('File', fileSchema);
