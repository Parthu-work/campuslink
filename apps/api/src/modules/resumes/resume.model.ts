import { Schema, type Types } from 'mongoose';
import {
  RESUME_COMMENT_SECTIONS,
  RESUME_TEMPLATES,
  type AtsReport,
  type ResumeContent,
} from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';
import { removalFragment } from '../../db/fragments.js';

/**
 * Résumés (prompt 2, G2). The content is validated by the shared Zod schema before it is stored, so
 * it is kept as a document of its own. The rendered PDF (file purpose `resume_pdf`) follows the
 * version; a stale one is rendered again on download.
 */
export interface ResumeDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  template: (typeof RESUME_TEMPLATES)[number];
  content: ResumeContent;
  version: number;
  pdfFileId: Types.ObjectId | null;
  pdfVersion: number;
  pages: number;
  atsReport: AtsReport | null;
  createdAt: Date;
  updatedAt: Date;
}

const resumeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, maxlength: 60 },
    template: { type: String, enum: RESUME_TEMPLATES, default: 'classic' },
    content: { type: Schema.Types.Mixed, required: true },
    version: { type: Number, default: 1 },
    pdfFileId: { type: Schema.Types.ObjectId, default: null },
    pdfVersion: { type: Number, default: 0 },
    pages: { type: Number, default: 0 },
    atsReport: { type: Schema.Types.Mixed, default: null },
  },
  baseSchemaOptions,
);
resumeSchema.index({ tenantId: 1, userId: 1, updatedAt: -1 });
export const ResumeModel = defineTenantModel('Resume', resumeSchema);

export interface ResumeCommentDoc {
  _id: Types.ObjectId;
  resumeId: Types.ObjectId;
  resumeVersion: number;
  authorId: Types.ObjectId | null;
  section: (typeof RESUME_COMMENT_SECTIONS)[number];
  body: string;
  status: 'visible' | 'removed';
  removal: { reason: string; note: string; by: Types.ObjectId; at: Date } | null;
  createdAt: Date;
}

/** A reviewer's (or the owner's) note on one section; moderatable like any member text. */
const commentSchema = new Schema(
  {
    resumeId: { type: Schema.Types.ObjectId, required: true },
    resumeVersion: { type: Number, required: true },
    authorId: { type: Schema.Types.ObjectId, default: null },
    section: { type: String, enum: RESUME_COMMENT_SECTIONS, required: true },
    body: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['visible', 'removed'], default: 'visible' },
    removal: removalFragment,
  },
  baseSchemaOptions,
);
commentSchema.index({ tenantId: 1, resumeId: 1, _id: 1 });
commentSchema.index({ tenantId: 1, authorId: 1 });
export const ResumeCommentModel = defineTenantModel('ResumeComment', commentSchema);
