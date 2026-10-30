import { alertBody, jobBody, jobsQuery, trackBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import type { JobsService } from './jobs.service.js';
import type { ReferralsService } from '../referrals/referrals.service.js';

const READ = { kind: 'permission', permission: 'jobs:read' } as const;
const SAVE = { kind: 'permission', permission: 'jobs:save' } as const;
const POST = { kind: 'permission', permission: 'jobs:post' } as const;
const tag = 'Jobs';

export function jobRoutes(s: { jobs: JobsService; referrals: ReferralsService }): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/jobs',
      tag,
      summary:
        'Open jobs with filters (skills, branch, level, mode, type, location, fresher, alumni here) or mine',
      access: READ,
      query: jobsQuery,
      handler: async ({ req, query }) => {
        const r = await s.jobs.list(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'get',
      path: '/jobs/radar',
      tag,
      summary: 'Job Radar sections: for you, alumni can refer, fresher friendly, closing soon',
      access: READ,
      handler: async ({ req }) => ({ data: await s.jobs.radar(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/jobs',
      tag,
      summary: 'Post an opening (alumni and staff)',
      access: POST,
      limiter: 'posting',
      bot: true,
      idempotent: true,
      body: jobBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.jobs.create(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/jobs/:id',
      tag,
      summary: 'One job (with alumni-at-company counts and my tracker entry)',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.jobs.get(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/jobs/:id/close',
      tag,
      summary: 'Close an opening I posted',
      access: POST,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.jobs.close(authOf(req), params.id) }),
    },
    {
      method: 'put',
      path: '/jobs/:id/track',
      tag,
      summary: 'Save a job or update its tracker status and private note',
      access: SAVE,
      limiter: 'interact',
      params: idParams,
      body: trackBody,
      handler: async ({ req, params, body }) => ({ data: await s.jobs.track(authOf(req), params.id, body) }),
    },
    {
      method: 'delete',
      path: '/jobs/:id/track',
      tag,
      summary: 'Remove a job from my saved list',
      access: SAVE,
      limiter: 'interact',
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.jobs.unsave(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/jobs/:id/referrers',
      tag,
      summary: 'Alumni at this company who accept referral requests',
      access: { kind: 'permission', permission: 'referrals:request' },
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.referrals.referrersFor(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/me/job-tracker',
      tag,
      summary: 'My saved jobs and application statuses (private)',
      access: SAVE,
      handler: async ({ req }) => ({ data: await s.jobs.tracker(authOf(req)) }),
    },
    {
      method: 'get',
      path: '/me/job-alerts',
      tag,
      summary: 'My job alerts',
      access: SAVE,
      handler: async ({ req }) => ({ data: await s.jobs.alerts(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/job-alerts',
      tag,
      summary: 'Create a daily job alert from filters (up to 5)',
      access: SAVE,
      limiter: 'interact',
      body: alertBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.jobs.createAlert(authOf(req), body) }),
    },
    {
      method: 'delete',
      path: '/me/job-alerts/:id',
      readOnlyOk: true,
      tag,
      summary: 'Delete a job alert',
      access: SAVE,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.jobs.deleteAlert(authOf(req), params.id) }),
    },
  ];
}
