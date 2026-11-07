import { z } from 'zod';
import {
  candidateStageBody,
  clusterBody,
  employerApplyBody,
  employerDecisionBody,
  networkRefParams,
  objectId,
  poolQuery,
  postingBody,
  postingPublishBody,
  recruiterBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { EmployersService } from './employers.service.js';

const tag = 'Employers';
const post = { kind: 'permission', permission: 'employer:post' } as const;
const candidates = { kind: 'permission', permission: 'employer:candidates' } as const;
const manage = { kind: 'permission', permission: 'employer:manage' } as const;
const platform = { kind: 'permission', permission: 'platform:employers' } as const;
const idParams = z.strictObject({ id: objectId });
const tokenParams = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{10,400}\.[A-Za-z0-9_-]{43}$/) });
const listQuery = z.strictObject({
  status: z.enum(['applied', 'verified', 'approved', 'suspended', 'rejected']).optional(),
});
const monthQuery = z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
const E = 'employer' as const;

/** The recruiter portal (employer hosts), applying and the platform's registry (ADR 0014 §9 to §11). */
export function employerRoutes(s: EmployersService): AnyRouteSpec[] {
  return [
    // ── Applying: the platform host, before an account exists ─────────────────────────────
    {
      method: 'post',
      path: '/employers/apply',
      tag,
      summary: 'Apply as an employer (work email at the company’s domain, GSTIN; approved by a person)',
      access: { kind: 'public' },
      scope: 'platform',
      limiter: 'employerApply',
      bot: true,
      body: employerApplyBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.apply(body, requestMeta(req)) }),
    },
    // ── The employer's host ─────────────────────────────
    {
      method: 'get',
      path: '/employer',
      tag,
      summary: 'The employer’s verification state, recruiters, limits and prices',
      access: post,
      scope: E,
      handler: async () => ({ data: await s.account() }),
    },
    {
      method: 'post',
      path: '/employer/verify-domain',
      tag,
      summary: 'Check the DNS TXT record on the company’s domain',
      access: manage,
      scope: E,
      limiter: 'verify',
      handler: async ({ req }) => ({ data: await s.verifyDomain(authOf(req), requestMeta(req)) }),
    },
    {
      method: 'post',
      path: '/employer/recruiters',
      tag,
      summary: 'Add a recruiter at the verified domain (10 seats)',
      access: manage,
      scope: E,
      limiter: 'adminWrite',
      body: recruiterBody,
      handler: async ({ req, body }) => ({ data: await s.addRecruiter(authOf(req), body, requestMeta(req)) }),
    },
    {
      method: 'delete',
      path: '/employer/recruiters/:id',
      tag,
      summary: 'Remove a recruiter',
      access: manage,
      scope: E,
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await s.removeRecruiter(authOf(req), params.id, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/employer/colleges',
      tag,
      summary: 'Colleges that take postings from this employer, and the clusters',
      access: post,
      scope: E,
      handler: async () => ({ data: await s.colleges() }),
    },
    {
      method: 'get',
      path: '/employer/postings',
      tag,
      summary: 'The employer’s postings and each college’s decision',
      access: post,
      scope: E,
      handler: async () => ({ data: await s.postings() }),
    },
    {
      method: 'post',
      path: '/employer/postings',
      tag,
      summary: 'Write a posting (a draft until it is offered to colleges)',
      access: post,
      scope: E,
      limiter: 'posting',
      body: postingBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.createPosting(authOf(req), body) }),
    },
    {
      method: 'put',
      path: '/employer/postings/:id',
      tag,
      summary: 'Edit a posting (colleges approve it again)',
      access: post,
      scope: E,
      limiter: 'posting',
      params: idParams,
      body: postingBody,
      handler: async ({ req, params, body }) => ({
        data: await s.updatePosting(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/employer/postings/:id/publish',
      tag,
      summary: 'Offer a posting to chosen colleges or a cluster (P8)',
      access: post,
      scope: E,
      limiter: 'posting',
      params: idParams,
      body: postingPublishBody,
      handler: async ({ req, params, body }) => ({
        data: await s.publish(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/employer/postings/:id/close',
      tag,
      summary: 'Close a posting (pending offers are withdrawn; P10)',
      access: post,
      scope: E,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.close(authOf(req), params.id, requestMeta(req)) }),
    },
    {
      method: 'get',
      path: '/employer/pool',
      tag,
      summary: 'How many opted-in students fit (counts only, suppressed and rounded; P7)',
      access: candidates,
      scope: E,
      query: poolQuery,
      handler: async ({ req, query }) => ({ data: await s.pool(authOf(req), query, requestMeta(req)) }),
    },
    {
      method: 'get',
      path: '/employer/postings/:id/candidates',
      tag,
      summary: 'Students who applied and shared with this posting (P11; no contact details)',
      access: candidates,
      scope: E,
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await s.candidates(authOf(req), params.id, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/employer/candidates/:ref/resume-link',
      tag,
      summary: 'A five-minute link to a candidate’s shared résumé (P12)',
      access: candidates,
      scope: E,
      params: networkRefParams,
      handler: async ({ req, params }) => ({
        data: await s.resumeLink(authOf(req), params.ref, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/employer/resume/:token',
      tag,
      summary: 'Read a shared résumé through its link (candidacy and consent checked again)',
      access: candidates,
      scope: E,
      params: tokenParams,
      handler: async ({ req, params }) => ({
        data: null,
        raw: {
          body: await s.resumeFile(authOf(req), params.token, requestMeta(req)),
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'inline; filename="resume.pdf"',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cache-Control': 'no-store',
          },
        },
      }),
    },
    {
      method: 'get',
      path: '/employer/candidates/:ref/readiness',
      tag,
      summary: 'A candidate’s readiness, computed now by their college (P13; never stored)',
      access: candidates,
      scope: E,
      params: networkRefParams,
      handler: async ({ req, params }) => ({
        data: await s.readiness(authOf(req), params.ref, requestMeta(req)),
      }),
    },
    {
      method: 'put',
      path: '/employer/candidates/:ref/stage',
      tag,
      summary: 'Propose a shortlist decision (P14; the college publishes results)',
      access: candidates,
      scope: E,
      params: networkRefParams,
      body: candidateStageBody,
      handler: async ({ req, params, body }) => ({
        data: await s.setStage(authOf(req), params.ref, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/employer/billing',
      tag,
      summary: 'Billable postings, drives and hires',
      access: manage,
      scope: E,
      handler: async () => ({ data: await s.billing() }),
    },
    // ── The platform ─────────────────────────────
    {
      method: 'get',
      path: '/platform/employers',
      tag,
      summary: 'Employers by status (the registry)',
      access: platform,
      scope: 'platform',
      query: listQuery,
      handler: async ({ query }) => ({ data: await s.list(query.status) }),
    },
    {
      method: 'get',
      path: '/platform/employers/:id',
      tag,
      summary: 'One employer’s application (P16)',
      access: platform,
      scope: 'platform',
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await s.review(authOf(req), params.id, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/platform/employers/:id/decision',
      tag,
      summary: 'Approve, reject, suspend or reinstate an employer',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      params: idParams,
      body: employerDecisionBody,
      handler: async ({ req, params, body }) => ({
        data: await s.decide(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/platform/network/clusters',
      tag,
      summary: 'College clusters employers may post to',
      access: platform,
      scope: 'platform',
      handler: async () => ({ data: await s.clusters() }),
    },
    {
      method: 'post',
      path: '/platform/network/clusters',
      tag,
      summary: 'Create a cluster',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      body: clusterBody,
      handler: async ({ req, body }) => ({ data: await s.saveCluster(authOf(req), body, requestMeta(req)) }),
    },
    {
      method: 'put',
      path: '/platform/network/clusters/:id',
      tag,
      summary: 'Change a cluster',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      params: idParams,
      body: clusterBody,
      handler: async ({ req, params, body }) => ({
        data: await s.saveCluster(authOf(req), body, requestMeta(req), params.id),
      }),
    },
    {
      method: 'delete',
      path: '/platform/network/clusters/:id',
      tag,
      summary: 'Delete a cluster',
      access: platform,
      scope: 'platform',
      limiter: 'adminWrite',
      params: idParams,
      handler: async ({ req, params }) => ({
        data: await s.deleteCluster(authOf(req), params.id, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/platform/network/revenue',
      tag,
      summary: 'Each college’s share of a month’s billable events (P17)',
      access: platform,
      scope: 'platform',
      query: monthQuery,
      handler: async ({ req, query }) => ({
        data: await s.revenue(authOf(req), query.month, requestMeta(req)),
      }),
    },
  ];
}
