import { z } from 'zod';
import {
  aiConsentBody,
  aiKeyBody,
  aiKeyTargetParams,
  aiSettingsBody,
  aiTestBody,
  contributorBody,
  enrollmentBody,
  objectId,
  subjectBody,
  subjectUpdateBody,
  subjectsQuery,
  syllabusBody,
  syllabusParseBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { SubjectsService } from './subjects.service.js';
import type { AiSettingsService } from './ai-settings.service.js';
import type { IndexingService } from './indexing.service.js';
import { parseSyllabus } from './syllabus-parse.js';

const READ = { kind: 'permission', permission: 'study:read' } as const;
const MANAGE = { kind: 'permission', permission: 'study:manage' } as const;
const AI = { kind: 'permission', permission: 'ai:settings' } as const;
const tag = 'Study';
const enrollmentParams = z.strictObject({ id: objectId, userId: objectId });

export function studyRoutes(s: { subjects: SubjectsService; ai: AiSettingsService }): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/study/subjects',
      tag,
      summary: 'Subjects I take (students) or all subjects (staff, alumni); `scope=mine` for my own',
      access: READ,
      query: subjectsQuery,
      handler: async ({ req, query }) => ({ data: await s.subjects.list(authOf(req), query) }),
    },
    {
      method: 'post',
      path: '/study/subjects',
      tag,
      summary: 'Create a subject (faculty become its owner)',
      access: MANAGE,
      limiter: 'adminWrite',
      idempotent: true,
      body: subjectBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.subjects.create(authOf(req), tenantOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/study/subjects/:id',
      tag,
      summary: 'One subject I may read',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.subjects.get(authOf(req), params.id) }),
    },
    {
      method: 'patch',
      path: '/study/subjects/:id',
      tag,
      summary: 'Edit or archive a subject (owners and admins)',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      body: subjectUpdateBody,
      handler: async ({ req, params, body }) => ({
        data: await s.subjects.update(authOf(req), tenantOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/study/subjects/:id/syllabus',
      tag,
      summary: 'The syllabus tree (units and topics)',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.subjects.syllabus(authOf(req), params.id) }),
    },
    {
      method: 'put',
      path: '/study/subjects/:id/syllabus',
      tag,
      summary: 'Replace the syllabus tree (owners and admins); kept ids keep their material tags',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      body: syllabusBody,
      handler: async ({ req, params, body }) => ({
        data: await s.subjects.saveSyllabus(authOf(req), params.id, body),
      }),
    },
    {
      method: 'post',
      path: '/study/syllabus/parse',
      tag,
      summary: 'Suggest a syllabus tree from pasted text (reviewed before saving; nothing is stored)',
      access: MANAGE,
      limiter: 'interact',
      body: syllabusParseBody,
      handler: async ({ body }) => ({ data: parseSyllabus(body.text) }),
    },
    {
      method: 'get',
      path: '/study/subjects/:id/enrollments',
      tag,
      summary: 'Students added to or excluded from a subject by hand',
      access: MANAGE,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.subjects.enrollments(authOf(req), params.id) }),
    },
    {
      method: 'put',
      path: '/study/subjects/:id/enrollments',
      tag,
      summary: 'Include or exclude one student (overrides the branch and batch rule)',
      access: MANAGE,
      limiter: 'adminWrite',
      params: idParams,
      body: enrollmentBody,
      handler: async ({ req, params, body }) => ({
        data: await s.subjects.setEnrollment(authOf(req), tenantOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'delete',
      path: '/study/subjects/:id/enrollments/:userId',
      tag,
      summary: 'Remove a by-hand override',
      access: MANAGE,
      limiter: 'adminWrite',
      params: enrollmentParams,
      handler: async ({ req, params }) => ({
        data: await s.subjects.removeEnrollment(authOf(req), params.id, params.userId, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/study/subjects/:id/contributors',
      tag,
      summary: 'Alumni and certified contributors granted to a subject',
      access: MANAGE,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.subjects.contributors(authOf(req), params.id) }),
    },
    {
      method: 'put',
      path: '/study/subjects/:id/contributors',
      tag,
      summary: 'Grant or revoke a contributor for a subject (admins)',
      access: { kind: 'permission', permission: 'capabilities:grant' },
      limiter: 'adminWrite',
      params: idParams,
      body: contributorBody,
      handler: async ({ req, params, body }) => ({
        data: await s.subjects.setContributor(authOf(req), tenantOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/study/ai-status',
      tag,
      summary: 'Whether AI answers and semantic search are on for my college (no settings detail)',
      access: READ,
      handler: async () => ({ data: await s.ai.status() }),
    },
  ];
}

export function aiSettingsRoutes(ai: AiSettingsService, indexing: IndexingService): AnyRouteSpec[] {
  const tag = 'AI assistant settings';
  return [
    {
      method: 'get',
      path: '/admin/ai',
      tag,
      summary: 'AI assistant settings (keys appear only as their last four characters)',
      access: AI,
      handler: async () => ({ data: await ai.view() }),
    },
    {
      method: 'put',
      path: '/admin/ai',
      tag,
      summary: 'Save provider, models, limits and toggles (changing a provider removes its key)',
      access: AI,
      limiter: 'adminWrite',
      body: aiSettingsBody,
      handler: async ({ req, body }) => ({ data: await ai.update(authOf(req), body, requestMeta(req)) }),
    },
    {
      // Not idempotent on purpose: the idempotency store keeps request bodies, and this one holds a key.
      method: 'put',
      path: '/admin/ai/keys',
      tag,
      summary: 'Store an API key (encrypted at rest; never returned) and test it',
      access: AI,
      limiter: 'aiTest',
      body: aiKeyBody,
      handler: async ({ req, body }) => ({
        data: await ai.setKey(authOf(req), body.target, body.key, requestMeta(req)),
      }),
    },
    {
      method: 'delete',
      path: '/admin/ai/keys/:target',
      tag,
      summary: 'Remove a stored API key',
      access: AI,
      limiter: 'adminWrite',
      params: aiKeyTargetParams,
      handler: async ({ req, params }) => ({
        data: await ai.removeKey(authOf(req), params.target, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/admin/ai/test',
      tag,
      summary: 'Test connection: one tiny request with the stored key; lists the models it can use',
      access: AI,
      limiter: 'aiTest',
      body: aiTestBody,
      handler: async ({ req, body }) => ({ data: await ai.test(authOf(req), body.target, requestMeta(req)) }),
    },
    {
      method: 'post',
      path: '/admin/ai/consent',
      tag,
      summary: 'Accept the data-processing notice (versioned and audit-logged)',
      access: AI,
      limiter: 'adminWrite',
      body: aiConsentBody,
      handler: async ({ req, body }) => ({
        data: await ai.acceptConsent(authOf(req), body.version, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/ai/index',
      tag,
      summary:
        'Semantic index: passages with vectors, waiting and refused, and whether a back-fill is running',
      access: AI,
      handler: async () => ({ data: await indexing.progress() }),
    },
    {
      method: 'post',
      path: '/admin/ai/reindex',
      tag,
      summary:
        'Rebuild the semantic index from stored vectors, then embed whatever is missing (audit-logged)',
      access: AI,
      limiter: 'adminWrite',
      idempotent: true,
      handler: async ({ req }) => ({ data: await indexing.reindex(authOf(req), requestMeta(req)) }),
    },
  ];
}
