import { z } from 'zod';
import { answerBody, objectId, questionBody, questionsQuery } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import type { QaService } from './qa.service.js';

const READ = { kind: 'permission', permission: 'feed:read' } as const;
const tag = 'Q&A';

export function qaRoutes(svc: QaService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/questions',
      tag,
      summary: 'Published questions (or mine, including pending)',
      access: READ,
      query: questionsQuery,
      handler: async ({ req, query }) => {
        const r = await svc.list(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/questions',
      tag,
      summary: 'Ask a question (published after moderation)',
      access: { kind: 'permission', permission: 'qa:ask' },
      limiter: 'qa',
      bot: true,
      idempotent: true,
      body: questionBody,
      handler: async ({ req, body }) => ({ status: 201, data: await svc.ask(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/questions/:id',
      tag,
      summary: 'A question with its answers',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await svc.get(authOf(req), params.id) }),
    },
    {
      method: 'delete',
      path: '/questions/:id',
      tag,
      summary: 'Delete my question (only while unanswered)',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await svc.deleteQuestion(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/questions/:id/answers',
      tag,
      summary: 'Answer a question (alumni and staff)',
      access: { kind: 'permission', permission: 'qa:answer' },
      limiter: 'interact',
      idempotent: true,
      params: idParams,
      body: answerBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await svc.answer(authOf(req), params.id, body.body),
      }),
    },
    {
      method: 'post',
      path: '/questions/:id/accept',
      tag,
      summary: 'Mark the best answer (asker only)',
      access: { kind: 'permission', permission: 'qa:ask' },
      params: idParams,
      body: z.strictObject({ answerId: objectId }),
      handler: async ({ req, params, body }) => ({
        data: await svc.accept(authOf(req), params.id, body.answerId),
      }),
    },
    {
      method: 'post',
      path: '/answers/:id/helpful',
      tag,
      summary: 'Vote an answer helpful',
      access: { kind: 'permission', permission: 'feed:interact' },
      limiter: 'interact',
      params: idParams,
      handler: async ({ req, params }) => ({ data: await svc.helpful(authOf(req), params.id, true) }),
    },
    {
      method: 'delete',
      path: '/answers/:id/helpful',
      tag,
      summary: 'Remove my helpful vote',
      access: { kind: 'permission', permission: 'feed:interact' },
      limiter: 'interact',
      params: idParams,
      handler: async ({ req, params }) => ({ data: await svc.helpful(authOf(req), params.id, false) }),
    },
    {
      method: 'delete',
      path: '/answers/:id',
      tag,
      summary: 'Delete my answer',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await svc.deleteAnswer(authOf(req), params.id) }),
    },
  ];
}
