import {
  atsCheckBody,
  resumeCommentBody,
  resumeCreateBody,
  resumeIdParams,
  resumeUpdateBody,
  rewriteBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import type { ResumesService } from './resumes.service.js';

const tag = 'Résumés';
const manage = { kind: 'permission', permission: 'resumes:manage' } as const;
/** Reviewers are alumni or staff without `resumes:manage`: access is decided per résumé. */
const signedIn = { kind: 'authenticated' } as const;

/** Résumé builder, ATS check, rewrites and alumni review (prompt 2, G2). */
export function resumeRoutes(s: ResumesService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/resumes',
      tag,
      summary: 'My résumés',
      access: manage,
      handler: async ({ req }) => ({ data: await s.list(authOf(req)) }),
    },
    {
      method: 'get',
      path: '/resumes/prefill',
      tag,
      summary: 'A first draft from my profile, academic record and finished roadmaps',
      access: manage,
      handler: async ({ req }) => ({ data: await s.prefill(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/resumes',
      tag,
      summary: 'Create a résumé (prefilled unless content is given)',
      access: manage,
      limiter: 'posting',
      idempotent: true,
      body: resumeCreateBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.create(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/resumes/:id',
      tag,
      summary: 'A résumé (mine, or one I was asked to review)',
      access: signedIn,
      params: resumeIdParams,
      handler: async ({ req, params }) => ({ data: await s.get(authOf(req), params.id) }),
    },
    {
      method: 'put',
      path: '/resumes/:id',
      tag,
      summary: 'Save a résumé (refused if it changed since the version I started from)',
      access: manage,
      limiter: 'posting',
      params: resumeIdParams,
      body: resumeUpdateBody,
      handler: async ({ req, params, body }) => ({ data: await s.update(authOf(req), params.id, body) }),
    },
    {
      method: 'delete',
      path: '/resumes/:id',
      tag,
      summary: 'Delete one of my résumés',
      access: manage,
      params: resumeIdParams,
      handler: async ({ req, params }) => ({ data: await s.remove(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/resumes/:id/pdf',
      tag,
      summary: 'Download the résumé as an ATS-friendly PDF (mine, or one I review)',
      access: signedIn,
      params: resumeIdParams,
      handler: async ({ req, params }) => {
        const f = await s.pdf(authOf(req), params.id);
        return {
          data: null,
          raw: {
            body: f.data,
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="${f.name}"`,
              'X-Content-Type-Options': 'nosniff',
              'Cache-Control': 'private, no-store',
            },
          },
        };
      },
    },
    {
      method: 'post',
      path: '/resumes/:id/ats',
      tag,
      summary: 'Check the résumé: parseability, and keywords against a pasted job description or a drive',
      access: manage,
      limiter: 'aiChat',
      params: resumeIdParams,
      body: atsCheckBody,
      handler: async ({ req, params, body }) => ({ data: await s.ats(authOf(req), params.id, body) }),
    },
    {
      method: 'post',
      path: '/resumes/:id/rewrite',
      tag,
      summary: 'Three tighter versions of one bullet that keep its facts (AI when available, else rules)',
      access: manage,
      limiter: 'aiChat',
      params: resumeIdParams,
      body: rewriteBody,
      handler: async ({ req, params, body }) => ({ data: await s.rewrite(authOf(req), params.id, body) }),
    },
    {
      method: 'get',
      path: '/resumes/:id/comments',
      tag,
      summary: 'Review comments on a résumé (its owner and its reviewers)',
      access: signedIn,
      params: resumeIdParams,
      handler: async ({ req, params }) => ({ data: await s.comments(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/resumes/:id/comments',
      tag,
      summary: 'Comment on a section of a résumé I review (or my own)',
      access: signedIn,
      limiter: 'interact',
      bot: true,
      params: resumeIdParams,
      body: resumeCommentBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await s.comment(authOf(req), params.id, body),
      }),
    },
  ];
}
