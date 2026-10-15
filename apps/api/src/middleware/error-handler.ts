import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ErrorCode, type ApiFailure } from '@campuslink/shared';
import { AppError, notFound } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Route'));

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = String(req.id ?? '');
    let status = 500;
    let body: ApiFailure['error'] = { code: ErrorCode.INTERNAL, message: 'Something went wrong', requestId };

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, requestId, details: err.details };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Some fields are invalid',
        requestId,
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      err.type === 'entity.parse.failed'
    ) {
      status = 400;
      body = { code: ErrorCode.VALIDATION_FAILED, message: 'Malformed JSON body', requestId };
    } else if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large') {
      status = 413;
      body = { code: ErrorCode.VALIDATION_FAILED, message: 'Request body too large', requestId };
    }

    if (status >= 500) logger.error({ err, requestId }, 'unhandled error');
    // Never leak stack traces or internal messages to clients.
    res.status(status).json({ ok: false, error: body } satisfies ApiFailure);
  };
}
