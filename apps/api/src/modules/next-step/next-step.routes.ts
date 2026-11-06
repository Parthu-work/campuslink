import { nextStepOpenBody } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import type { NextStepService } from './next-step.service.js';

const tag = 'Next Step';
const view = { kind: 'permission', permission: 'nextstep:view' } as const;

/** The weekly Next Step (prompt 2, G7). */
export function nextStepRoutes(s: NextStepService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/me/next-step',
      tag,
      summary: 'This week\x27s Next Step: a roadmap step, a drive or job, an alumnus to ask, readiness',
      access: view,
      handler: async ({ req }) => ({ data: await s.current(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/me/next-step/open',
      tag,
      summary: 'Record that this week\x27s Next Step (or one of its items) was opened',
      access: view,
      body: nextStepOpenBody,
      handler: async ({ req, body }) => {
        await s.open(authOf(req), body.item);
        return { status: 204, data: null };
      },
    },
  ];
}
