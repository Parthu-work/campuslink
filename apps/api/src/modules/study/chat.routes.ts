import {
  ErrorCode,
  chatAskBody,
  chatFeedbackBody,
  chatSessionsQuery,
  deckBody,
  quizAnswersBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf } from '../../http/request-context.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { ChatService } from './chat.service.js';

const READ = { kind: 'permission', permission: 'study:read' } as const;
const tag = 'Study assistant';

/**
 * The study assistant. A question is answered with server-sent events (`start`, `sources`,
 * `delta`…, `done`); validation, access and limits are checked first, so those failures are the
 * ordinary JSON error envelope. Conversations, feedback, quizzes and decks are the member's own.
 */
export function chatRoutes(chat: ChatService, logger: Pick<Logger, 'error'>): AnyRouteSpec[] {
  return [
    {
      method: 'post',
      path: '/study/chat',
      tag,
      summary:
        'Ask the study assistant or run a slash command; answers stream as server-sent events with citations',
      access: READ,
      limiter: 'aiChat',
      stream: true,
      body: chatAskBody,
      handler: async ({ req, res, body }) => {
        const run = await chat.prepare(authOf(req), body);
        const stop = new AbortController();
        // The member closed the page or pressed Stop: stop the provider, keep what was written.
        res.on('close', () => {
          if (!res.writableFinished) stop.abort();
        });
        res.status(200);
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.setHeader('x-accel-buffering', 'no');
        res.flushHeaders();
        const send = (e: { type: string }) => {
          if (!res.writableEnded) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
        };
        try {
          await run(send, stop.signal);
        } catch (e) {
          logger.error({ err: e instanceof Error ? e.message : 'unknown' }, 'study chat failed');
          send({
            type: 'error',
            code: e instanceof AppError ? e.code : ErrorCode.INTERNAL,
            message: e instanceof AppError ? e.message : 'Something went wrong. Please try again.',
          } as { type: string });
        }
        res.end();
        return { data: null, streamed: true };
      },
    },
    {
      method: 'get',
      path: '/study/chat/sessions',
      tag,
      summary: 'My conversations with the study assistant, newest first',
      access: READ,
      query: chatSessionsQuery,
      handler: async ({ req, query }) => {
        const r = await chat.sessions(authOf(req), query.cursor);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'get',
      path: '/study/chat/sessions/:id',
      tag,
      summary: 'One of my conversations with its messages',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await chat.session(authOf(req), params.id) }),
    },
    {
      method: 'delete',
      path: '/study/chat/sessions/:id',
      tag,
      summary: 'Delete one of my conversations',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => {
        await chat.removeSession(authOf(req), params.id);
        return { status: 204, data: null };
      },
    },
    {
      method: 'delete',
      path: '/study/chat/sessions',
      tag,
      summary: 'Delete my whole chat history',
      access: READ,
      handler: async ({ req }) => {
        await chat.clear(authOf(req));
        return { status: 204, data: null };
      },
    },
    {
      method: 'post',
      path: '/study/chat/messages/:id/feedback',
      tag,
      summary: 'Thumbs up or down on an answer, with an optional reason',
      access: READ,
      params: idParams,
      body: chatFeedbackBody,
      handler: async ({ req, params, body }) => ({ data: await chat.feedback(authOf(req), params.id, body) }),
    },
    {
      method: 'post',
      path: '/study/chat/messages/:id/quiz',
      tag,
      summary: 'Finish a quiz: scored once, saved as progress, and points through the award rules',
      access: READ,
      params: idParams,
      body: quizAnswersBody,
      handler: async ({ req, params, body }) => ({
        data: await chat.submitQuiz(authOf(req), params.id, body.answers),
      }),
    },
    {
      method: 'post',
      path: '/study/decks',
      tag,
      summary: 'Keep the flashcards of an answer as a deck',
      access: READ,
      idempotent: true,
      body: deckBody,
      handler: async ({ req, body }) => ({ status: 201, data: await chat.createDeck(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/study/decks',
      tag,
      summary: 'My flashcard decks',
      access: READ,
      handler: async ({ req }) => ({ data: await chat.decks(authOf(req)) }),
    },
    {
      method: 'get',
      path: '/study/decks/:id',
      tag,
      summary: 'One of my flashcard decks',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await chat.deck(authOf(req), params.id) }),
    },
    {
      method: 'delete',
      path: '/study/decks/:id',
      tag,
      summary: 'Delete one of my flashcard decks',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => {
        await chat.removeDeck(authOf(req), params.id);
        return { status: 204, data: null };
      },
    },
  ];
}
