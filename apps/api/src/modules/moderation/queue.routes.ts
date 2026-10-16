import { z } from 'zod';
import {
  CONTENT_TARGETS,
  appealBody,
  appealDecisionBody,
  moderateBody,
  objectId,
  questionDecisionBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { requestMeta } from '../../lib/request-meta.js';
import type { ModerationService } from './moderation.service.js';
import type { QaService } from '../qa/qa.service.js';
import type { ContentSourcesService } from '../content-sources/sources.service.js';
import type { SafetyService } from './safety.service.js';

const ACT = { kind: 'permission', permission: 'moderation:act' } as const;
const tag = 'Moderation';
const cursor = z.strictObject({ cursor: objectId.optional() });

export function queueRoutes(s: {
  moderation: ModerationService;
  qa: QaService;
  sources: ContentSourcesService;
  safety: SafetyService;
}): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/admin/moderation/summary',
      tag,
      summary: 'Counts for the moderation queue',
      access: ACT,
      handler: async () => ({
        data: {
          reports: await s.safety.openReportCount(),
          heldItems: await s.sources.heldCount(),
          pendingQuestions: await s.qa.pendingCount(),
          appeals: await s.moderation.openAppealCount(),
        },
      }),
    },
    {
      method: 'post',
      path: '/admin/moderation/actions',
      tag,
      summary: 'Remove or restore content (the author sees the reason and can appeal)',
      access: ACT,
      limiter: 'adminWrite',
      body: moderateBody,
      handler: async ({ req, body }) => ({
        data: await s.moderation.act(authOf(req), body, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/moderation/history/:targetType/:targetId',
      tag,
      summary: 'Moderation history of one item',
      access: ACT,
      params: z.strictObject({ targetType: z.enum(CONTENT_TARGETS), targetId: objectId }),
      handler: async ({ params }) => ({
        data: await s.moderation.history(params.targetType, params.targetId),
      }),
    },
    {
      method: 'get',
      path: '/admin/moderation/items',
      tag,
      summary: 'Automated items held by the quality filters',
      access: ACT,
      query: cursor,
      handler: async ({ query }) => {
        const r = await s.sources.heldItems(query.cursor);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/admin/moderation/items/:id/decision',
      tag,
      summary: 'Publish or reject a held item',
      access: ACT,
      limiter: 'adminWrite',
      params: idParams,
      body: z.strictObject({ decision: z.enum(['publish', 'reject']) }),
      handler: async ({ req, params, body }) => {
        const r = await s.sources.decideHeld(params.id, body.decision);
        await s.moderation.log(
          authOf(req),
          {
            targetType: 'item',
            targetId: params.id,
            subjectUserId: null,
            action: body.decision === 'publish' ? 'publish' : 'reject',
          },
          requestMeta(req),
        );
        return { data: r };
      },
    },
    {
      method: 'get',
      path: '/admin/moderation/questions',
      tag,
      summary: 'Questions waiting for approval',
      access: ACT,
      query: cursor,
      handler: async ({ query }) => {
        const r = await s.qa.pending(query.cursor);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/admin/moderation/questions/:id/decision',
      tag,
      summary: 'Approve or reject a question (the asker is told why)',
      access: ACT,
      limiter: 'adminWrite',
      params: idParams,
      body: questionDecisionBody,
      handler: async ({ req, params, body }) => ({
        data: await s.qa.decide(authOf(req), params.id, body.decision, body.reason, requestMeta(req)),
      }),
    },
    {
      method: 'get',
      path: '/admin/moderation/appeals',
      tag,
      summary: 'Appeals against removals',
      access: ACT,
      query: z.strictObject({
        status: z.enum(['open', 'decided']).default('open'),
        cursor: objectId.optional(),
      }),
      handler: async ({ query }) => {
        const r = await s.moderation.appeals(query.status, query.cursor);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/admin/moderation/appeals/:id/decision',
      tag,
      summary: 'Uphold or reverse a removal (a different moderator must uphold)',
      access: ACT,
      limiter: 'adminWrite',
      params: idParams,
      body: appealDecisionBody,
      handler: async ({ req, params, body }) => ({
        data: await s.moderation.decideAppeal(authOf(req), params.id, body, requestMeta(req)),
      }),
    },
    {
      method: 'post',
      path: '/appeals',
      tag,
      summary: 'Appeal the removal of my content (once)',
      access: { kind: 'permission', permission: 'feed:read' },
      limiter: 'reports',
      body: appealBody.extend({ targetType: z.enum(CONTENT_TARGETS), targetId: objectId }),
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.moderation.appeal(authOf(req), body.targetType, body.targetId, body.message),
      }),
    },
  ];
}
