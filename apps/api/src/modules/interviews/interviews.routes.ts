import { z } from 'zod';
import {
  INTERVIEW_AUDIO_MAX_BYTES,
  INTERVIEW_FOLLOW_UPS_MAX,
  INTERVIEW_QUESTIONS_MAX,
  interviewAnswerBody,
  interviewCreateBody,
  interviewIdParams,
  interviewQuestionBody,
  interviewQuestionDecisionBody,
  interviewQuestionListQuery,
  interviewSkipBody,
  objectId,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import type { InterviewsService } from './interviews.service.js';

const tag = 'Mock interviews';
const practice = { kind: 'permission', permission: 'interviews:practice' } as const;
const review = { kind: 'permission', permission: 'interviews:review' } as const;
/** A shared report is read by the alumnus it was shared with: access is decided per session. */
const signedIn = { kind: 'authenticated' } as const;
const turnParams = z.strictObject({
  id: objectId,
  turn: z.coerce
    .number()
    .int()
    .min(0)
    .max(INTERVIEW_QUESTIONS_MAX + INTERVIEW_FOLLOW_UPS_MAX),
});

/** AI mock interviews with human follow-up (prompt 2, G3). */
export function interviewRoutes(s: InterviewsService): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/interviews',
      tag,
      summary: 'My practice interviews, progress per rubric dimension and today\x27s allowance',
      access: practice,
      handler: async ({ req }) => ({ data: await s.history(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/interviews',
      tag,
      summary: 'Start a practice interview (HR, technical for a branch, or a drive\x27s role)',
      access: practice,
      limiter: 'aiChat',
      idempotent: true,
      body: interviewCreateBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.create(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/interviews/:id',
      tag,
      summary: 'A practice interview (mine, or one shared with me for a human mock)',
      access: signedIn,
      params: interviewIdParams,
      handler: async ({ req, params }) => ({ data: await s.get(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/interviews/:id/answers',
      tag,
      summary: 'Answer the current question in writing',
      access: practice,
      limiter: 'aiChat',
      params: interviewIdParams,
      body: interviewAnswerBody,
      handler: async ({ req, params, body }) => ({ data: await s.answer(authOf(req), params.id, body) }),
    },
    {
      method: 'post',
      path: '/interviews/:id/skip',
      tag,
      summary: 'Skip the current question',
      access: practice,
      params: interviewIdParams,
      body: interviewSkipBody,
      handler: async ({ req, params, body }) => ({ data: await s.skip(authOf(req), params.id, body.turn) }),
    },
    {
      method: 'post',
      path: '/interviews/:id/turns/:turn/audio',
      tag,
      summary: 'Answer the current question by voice (transcribed, then the recording is deleted)',
      access: practice,
      limiter: 'upload',
      params: turnParams,
      upload: { field: 'audio', maxBytes: INTERVIEW_AUDIO_MAX_BYTES },
      handler: async ({ req, params, file }) => ({
        data: await s.audio(authOf(req), params.id, params.turn, file?.buffer),
      }),
    },
    {
      method: 'post',
      path: '/interviews/:id/finish',
      tag,
      summary: 'End the interview now and get feedback on what was answered',
      access: practice,
      limiter: 'aiChat',
      params: interviewIdParams,
      handler: async ({ req, params }) => ({ data: await s.finish(authOf(req), params.id) }),
    },
    {
      method: 'get',
      path: '/admin/interview-questions',
      tag,
      summary: 'The question bank by status (AI-generated questions wait here for review)',
      access: review,
      query: interviewQuestionListQuery,
      handler: async ({ query }) => ({ data: await s.questions(query.status) }),
    },
    {
      method: 'post',
      path: '/admin/interview-questions',
      tag,
      summary: 'Add a question to the bank',
      access: review,
      limiter: 'posting',
      body: interviewQuestionBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.addQuestion(authOf(req), body) }),
    },
    {
      method: 'post',
      path: '/admin/interview-questions/:id/decision',
      tag,
      summary: 'Approve (optionally edited) or reject an AI-generated question',
      access: review,
      params: interviewIdParams,
      body: interviewQuestionDecisionBody,
      handler: async ({ req, params, body }) => ({ data: await s.decide(authOf(req), params.id, body) }),
    },
  ];
}
