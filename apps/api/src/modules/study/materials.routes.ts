import {
  MATERIAL_MAX_MB,
  materialLinkBody,
  materialUpdateBody,
  materialUploadFields,
  materialsQuery,
  materialReviewBody,
  studySearchQuery,
  takedownBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { MaterialsService } from './materials.service.js';
import type { RetrievalService } from './retrieval.service.js';

const READ = { kind: 'permission', permission: 'study:read' } as const;
const MANAGE = { kind: 'permission', permission: 'study:manage' } as const;
const tag = 'Study material';
const FILE = { field: 'file', maxBytes: MATERIAL_MAX_MB.media * 1048576 };

/**
 * Library routes. Upload rights depend on the subject (staff, granted contributors, and students
 * when the college allows it, with review), so they are checked in the service after `study:read`.
 */
export function materialRoutes(s: MaterialsService, retrieval: RetrievalService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/study/subjects/:id/materials',
      tag,
      summary: 'Material of a subject (published; your own uploads; managers can list review and drafts)',
      access: READ,
      params: idParams,
      query: materialsQuery,
      handler: async ({ req, params, query }) => ({ data: await s.list(authOf(req), params.id, query) }),
    },
    {
      method: 'post',
      path: '/study/materials',
      tag,
      summary:
        'Upload a file (sniffed, scanned and sanitised; rights attestation required); processing starts',
      access: READ,
      limiter: 'studyUpload',
      upload: FILE,
      body: materialUploadFields,
      handler: async ({ req, body, file }) => ({
        status: 201,
        data: await s.upload(authOf(req), body, file, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/study/materials/link',
      tag,
      summary: 'Add a YouTube or Vimeo link (official oEmbed metadata; never downloaded)',
      access: READ,
      limiter: 'studyUpload',
      idempotent: true,
      body: materialLinkBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.addLink(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/study/materials/:id',
      tag,
      summary: 'One material with its chapters, transcript and page text',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.get(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/study/materials/:id/file',
      tag,
      summary: 'A five-minute signed link to the file (for the viewer and player)',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.fileLink(authOf(req), params.id) }),
    },
    {
      method: 'patch',
      path: '/study/materials/:id',
      tag,
      summary: 'Edit title, description, tags, language or chapters (uploader or managers)',
      access: READ,
      params: idParams,
      body: materialUpdateBody,
      handler: async ({ req, params, body }) => ({ data: await s.update(authOf(req), params.id, body) }),
    },
    {
      method: 'delete',
      path: '/study/materials/:id',
      tag,
      summary: 'Delete a material everywhere: file, pages, chunks, vectors and transcript',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => {
        await s.remove(authOf(req), params.id, requestMeta(req));
        return { status: 204, data: null };
      },
    },
    {
      method: 'post',
      path: '/study/materials/:id/versions',
      tag,
      summary: 'Upload a new version (same kind of file); the material is re-indexed',
      access: READ,
      limiter: 'studyUpload',
      params: idParams,
      upload: FILE,
      handler: async ({ req, params, file }) => ({
        data: await s.newVersion(authOf(req), params.id, file, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/study/materials/:id/transcript',
      tag,
      summary: 'Add captions (WebVTT or SRT) to a video or audio; they become its transcript',
      access: READ,
      limiter: 'studyUpload',
      params: idParams,
      upload: { field: 'file', maxBytes: 2 * 1048576 },
      handler: async ({ req, params, file }) => ({
        data: await s.setTranscript(authOf(req), params.id, file, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/study/materials/:id/reprocess',
      tag,
      summary: 'Run processing again (after a failure, or a new OCR or transcription set-up)',
      access: READ,
      limiter: 'studyUpload',
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.reprocess(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/study/materials/:id/review',
      tag,
      summary: 'Publish or send back a contribution (subject owners and admins)',
      access: MANAGE,
      params: idParams,
      body: materialReviewBody,
      handler: async ({ req, params, body }) => ({
        data: await s.review(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/study/materials/:id/takedown',
      tag,
      summary: 'Take material down (copyright or policy); hidden from everyone and audit-logged',
      access: MANAGE,
      params: idParams,
      body: takedownBody,
      handler: async ({ req, params, body }) => ({
        data: await s.takedown(authOf(req), params.id, body.reason, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/study/search',
      tag,
      summary:
        'Search the material of the subjects I take, by meaning and by words (keyword-only without an embedding provider)',
      access: READ,
      limiter: 'search',
      query: studySearchQuery,
      handler: async ({ req, query }) => ({ data: await retrieval.search(authOf(req), query) }),
    },
  ];
}
