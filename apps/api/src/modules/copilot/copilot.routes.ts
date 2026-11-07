import { ErrorCode, copilotAskBody, copilotHandoffBody, copilotSessionParams } from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { authOf } from '../../http/request-context.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { CopilotService } from './copilot.service.js';

const tag = 'Career Copilot';
const USE = { kind: 'permission', permission: 'copilot:use' } as const;

/**
 * The Career Copilot (prompt 2, G11). A question is answered with server-sent events in the study
 * assistant's format (`start`, `sources`, `delta`…, `done`); validation and access are checked
 * first, so those failures are the ordinary JSON error envelope. Conversations are the member's own.
 */
export function copilotRoutes(copilot: CopilotService, logger: Pick<Logger, 'error'>): AnyRouteSpec[] {
  return [
    {
      method: 'get',
      path: '/copilot',
      tag,
      summary: 'My Career Copilot conversations and today’s questions left',
      access: USE,
      handler: async ({ req }) => ({ data: await copilot.home(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/copilot/chat',
      tag,
      summary: 'Ask the Career Copilot or run a command; cited answers stream as server-sent events',
      access: USE,
      limiter: 'aiChat',
      stream: true,
      body: copilotAskBody,
      handler: async ({ req, res, body }) => {
        const run = await copilot.prepare(authOf(req), body);
        const stop = new AbortController();
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
          logger.error({ err: e instanceof Error ? e.message : 'unknown' }, 'copilot failed');
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
      path: '/copilot/sessions/:id',
      tag,
      summary: 'One of my Career Copilot conversations',
      access: USE,
      params: copilotSessionParams,
      handler: async ({ req, params }) => ({ data: await copilot.session(authOf(req), params.id) }),
    },
    {
      method: 'delete',
      path: '/copilot/sessions/:id',
      tag,
      summary: 'Delete one of my Career Copilot conversations',
      access: USE,
      params: copilotSessionParams,
      handler: async ({ req, params }) => {
        await copilot.removeSession(authOf(req), params.id);
        return { status: 204, data: null };
      },
    },
    {
      method: 'post',
      path: '/copilot/handoff',
      tag,
      summary: 'Record that a human next step under an answer was opened',
      access: USE,
      body: copilotHandoffBody,
      handler: async ({ req, body }) => {
        await copilot.handoff(authOf(req), body.messageId, body.kind);
        return { status: 204, data: null };
      },
    },
  ];
}
