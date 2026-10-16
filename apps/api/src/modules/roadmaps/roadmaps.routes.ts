import { z } from 'zod';
import {
  createRoadmapBody,
  nodeCommentBody,
  progressBody,
  reviewBody,
  roadmapFlagsBody,
  roadmapsQuery,
  saveDraftBody,
  versionParams,
  weeklyGoalBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta as meta } from '../../lib/request-meta.js';
import type { RoadmapsService } from './roadmaps.service.js';

const READ = { kind: 'permission', permission: 'roadmaps:read' } as const;
const PROGRESS = { kind: 'permission', permission: 'roadmaps:progress' } as const;
const WRITE = { kind: 'permission', permission: 'roadmaps:write' } as const;
const REVIEW = { kind: 'permission', permission: 'roadmaps:review' } as const;
const tag = 'Roadmaps';
const slugParams = z.strictObject({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/) });
const keyParams = z.strictObject({ key: z.string().regex(/^[a-z0-9-]{2,40}$/) });

export function roadmapRoutes(s: RoadmapsService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/roadmaps',
      tag,
      summary: 'Published roadmaps (filters: category, branch, search, mine); reviewers can list drafts',
      access: READ,
      limiter: 'search',
      query: roadmapsQuery,
      handler: async ({ req, query }) => ({ data: await s.list(authOf(req), query) }),
    },
    {
      method: 'get',
      path: '/roadmaps/review-queue',
      tag,
      summary: 'Versions waiting for review, oldest first',
      access: REVIEW,
      handler: async ({ req }) => ({ data: await s.reviewQueue(authOf(req)) }),
    },
    {
      method: 'get',
      path: '/roadmaps/library',
      tag,
      summary: 'The researched roadmap library, with what this college has installed',
      access: REVIEW,
      handler: async () => ({ data: await s.library() }),
    },
    {
      method: 'post',
      path: '/roadmaps/library/:key',
      tag,
      summary: 'Install a library roadmap, or propose its researched update for review',
      access: REVIEW,
      params: keyParams,
      handler: async ({ req, params }) => ({
        data: await s.installFromLibrary(authOf(req), params.key, meta(req)),
      }),
    },
    {
      method: 'post',
      path: '/roadmaps',
      tag,
      summary: 'Start a new roadmap (a draft only its editors and reviewers can see)',
      access: WRITE,
      limiter: 'interact',
      idempotent: true,
      body: createRoadmapBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.create(authOf(req), body.content, meta(req)),
      }),
    },
    {
      method: 'get',
      path: '/roadmaps/:slug',
      tag,
      summary: 'One roadmap: the published content, my progress, and the open draft for editors',
      access: READ,
      params: slugParams,
      handler: async ({ req, params }) => ({ data: await s.get(authOf(req), params.slug) }),
    },
    {
      method: 'put',
      path: '/roadmaps/:id/draft',
      tag,
      summary: 'Save the open draft, or start a new version of a published roadmap',
      access: WRITE,
      limiter: 'interact',
      params: idParams,
      body: saveDraftBody,
      handler: async ({ req, params, body }) => ({ data: await s.saveDraft(authOf(req), params.id, body) }),
    },
    {
      method: 'delete',
      path: '/roadmaps/:id/draft',
      tag,
      summary: 'Discard the open draft (a never-published roadmap is deleted)',
      access: WRITE,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.discardDraft(authOf(req), params.id, meta(req)) }),
    },
    {
      method: 'post',
      path: '/roadmaps/:id/submit',
      tag,
      summary: 'Submit the draft for review (needs sources, and a project node)',
      access: WRITE,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.submit(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/roadmaps/:id/review',
      tag,
      summary: 'Approve (publish) or request changes; reviewers cannot approve their own edits',
      access: REVIEW,
      params: idParams,
      body: reviewBody,
      handler: async ({ req, params, body }) => ({
        data: await s.review(authOf(req), params.id, body, meta(req)),
      }),
    },
    {
      method: 'patch',
      path: '/roadmaps/:id',
      tag,
      summary: 'Feature or archive a roadmap',
      access: REVIEW,
      params: idParams,
      body: roadmapFlagsBody,
      handler: async ({ req, params, body }) => ({
        data: await s.setFlags(authOf(req), params.id, body, meta(req)),
      }),
    },
    {
      method: 'get',
      path: '/roadmaps/:id/versions',
      tag,
      summary: 'Version history (open versions only for editors and reviewers)',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.versions(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/roadmaps/:id/versions/:version',
      tag,
      summary: 'One version’s content and its publish checklist',
      access: READ,
      params: versionParams,
      handler: async ({ req, params }) => ({
        data: await s.version(authOf(req), params.id, params.version),
      }),
    },
    {
      method: 'put',
      path: '/roadmaps/:id/progress',
      tag,
      summary: 'Mark a step done or not done',
      access: PROGRESS,
      limiter: 'interact',
      params: idParams,
      body: progressBody,
      handler: async ({ req, params, body }) => ({ data: await s.setProgress(authOf(req), params.id, body) }),
    },
    {
      method: 'put',
      path: '/roadmaps/:id/goal',
      tag,
      summary: 'Follow a roadmap with a weekly goal (0 = no goal, no nudges)',
      access: PROGRESS,
      params: idParams,
      body: weeklyGoalBody,
      handler: async ({ req, params, body }) => ({
        data: await s.setGoal(authOf(req), params.id, body.nodesPerWeek),
      }),
    },
    {
      method: 'delete',
      path: '/roadmaps/:id/progress',
      tag,
      summary: 'Stop following a roadmap and forget my progress on it',
      access: PROGRESS,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.unfollow(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/roadmaps/:id/comments',
      tag,
      summary: 'Per-step comments for authors and reviewers',
      access: WRITE,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.comments(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/roadmaps/:id/comments',
      tag,
      summary: 'Comment on one step of the current version',
      access: WRITE,
      limiter: 'interact',
      params: idParams,
      body: nodeCommentBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await s.addComment(authOf(req), params.id, body),
      }),
    },
    {
      method: 'delete',
      path: '/roadmap-comments/:id',
      tag,
      summary: 'Delete my comment (reviewers can delete any)',
      access: WRITE,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.deleteComment(authOf(req), params.id) }),
    },
  ];
}
