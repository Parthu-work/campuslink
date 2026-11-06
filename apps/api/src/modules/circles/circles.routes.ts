import {
  circleBody,
  circleDecisionBody,
  circleIdParams,
  circlesQuery,
  studyGroupBody,
  studyGroupIdParams,
  studyGroupQuestionBody,
  studyGroupQuestionDoneBody,
  studyGroupQuestionParams,
  studyGroupQuizAnswerBody,
  studyGroupQuizBody,
  studyGroupQuizParams,
  studyGroupSlotBody,
  studyGroupsQuery,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import type { CirclesService } from './circles.service.js';
import type { StudyGroupsService } from './study-groups.service.js';

const join = { kind: 'permission', permission: 'circles:join' } as const;
const propose = { kind: 'permission', permission: 'circles:propose' } as const;
const manage = { kind: 'permission', permission: 'circles:manage' } as const;
const study = { kind: 'permission', permission: 'study:read' } as const;
const signedIn = { kind: 'authenticated' } as const;

/** Circles (prompt 2, G7). Their posts, questions and events are served by the feed, Q&A and events. */
export function circleRoutes(s: CirclesService): AnyRouteSpec[] {
  const tag = 'Circles';
  return [
    {
      method: 'get',
      path: '/circles',
      tag,
      summary: 'My circles, circles I can join, or circles waiting for approval',
      access: signedIn,
      query: circlesQuery,
      handler: async ({ req, query }) => ({ data: await s.list(authOf(req), query.scope) }),
    },
    {
      method: 'post',
      path: '/circles',
      tag,
      summary: 'Create a circle (staff) or propose one (it waits for staff approval)',
      access: propose,
      limiter: 'posting',
      body: circleBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.create(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/circles/:id',
      tag,
      summary: 'A circle',
      access: signedIn,
      params: circleIdParams,
      handler: async ({ req, params }) => ({ data: await s.get(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/circles/:id/join',
      tag,
      summary: 'Join a circle',
      access: join,
      params: circleIdParams,
      handler: async ({ req, params }) => ({ data: await s.join(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/circles/:id/leave',
      tag,
      summary: 'Leave a circle',
      access: join,
      params: circleIdParams,
      handler: async ({ req, params }) => ({ data: await s.leave(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/admin/circles/:id/decision',
      tag,
      summary: 'Approve or reject a proposed circle, or archive an active one',
      access: manage,
      params: circleIdParams,
      body: circleDecisionBody,
      handler: async ({ req, params, body }) => ({ data: await s.decide(authOf(req), params.id, body) }),
    },
  ];
}

/** Study groups (prompt 2, G7). */
export function studyGroupRoutes(s: StudyGroupsService): AnyRouteSpec[] {
  const tag = 'Study groups';
  return [
    {
      method: 'get',
      path: '/study-groups',
      tag,
      summary: 'Study groups on a subject, or my own groups',
      access: study,
      query: studyGroupsQuery,
      handler: async ({ req, query }) => ({ data: await s.list(authOf(req), query.subjectId) }),
    },
    {
      method: 'post',
      path: '/study-groups',
      tag,
      summary: 'Start a study group on a subject (3 to 6 members)',
      access: study,
      limiter: 'posting',
      body: studyGroupBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.create(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/me/quizzes',
      tag,
      summary: 'My recent study assistant quizzes (to share one with a study group)',
      access: study,
      handler: async ({ req }) => ({ data: await s.myQuizzes(authOf(req)) }),
    },
    {
      method: 'get',
      path: '/study-groups/:id',
      tag,
      summary: 'A study group',
      access: study,
      params: studyGroupIdParams,
      handler: async ({ req, params }) => ({ data: await s.get(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/study-groups/:id/join',
      tag,
      summary: 'Join a study group with room',
      access: study,
      params: studyGroupIdParams,
      handler: async ({ req, params }) => ({ data: await s.join(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/study-groups/:id/leave',
      tag,
      summary: 'Leave a study group',
      access: study,
      params: studyGroupIdParams,
      handler: async ({ req, params }) => ({ data: await s.leave(authOf(req), params.id) }),
    },
    {
      method: 'put',
      path: '/study-groups/:id/slot',
      tag,
      summary: 'Set (or clear) when and where the group meets next',
      access: study,
      params: studyGroupIdParams,
      body: studyGroupSlotBody,
      handler: async ({ req, params, body }) => ({
        data: await s.setSlot(authOf(req), params.id, body.slot),
      }),
    },
    {
      method: 'post',
      path: '/study-groups/:id/questions',
      tag,
      summary: 'Add a question to the group\x27s shared list',
      access: study,
      limiter: 'posting',
      params: studyGroupIdParams,
      body: studyGroupQuestionBody,
      handler: async ({ req, params, body }) => ({
        data: await s.addQuestion(authOf(req), params.id, body.text),
      }),
    },
    {
      method: 'put',
      path: '/study-groups/:id/questions/:questionId',
      tag,
      summary: 'Mark a shared question done (or not)',
      access: study,
      params: studyGroupQuestionParams,
      body: studyGroupQuestionDoneBody,
      handler: async ({ req, params, body }) => ({
        data: await s.markQuestion(authOf(req), params.id, params.questionId, body.done),
      }),
    },
    {
      method: 'post',
      path: '/study-groups/:id/quizzes',
      tag,
      summary: 'Share one of my study assistant /quiz results with the group',
      access: study,
      params: studyGroupIdParams,
      body: studyGroupQuizBody,
      handler: async ({ req, params, body }) => ({
        data: await s.shareQuiz(authOf(req), params.id, body.messageId),
      }),
    },
    {
      method: 'post',
      path: '/study-groups/:id/quizzes/:quizId/answers',
      tag,
      summary: 'Take a quiz shared with the group (once)',
      access: study,
      params: studyGroupQuizParams,
      body: studyGroupQuizAnswerBody,
      handler: async ({ req, params, body }) => ({
        data: await s.answerQuiz(authOf(req), params.id, params.quizId, body.answers),
      }),
    },
  ];
}
