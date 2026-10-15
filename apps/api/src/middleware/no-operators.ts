import type { RequestHandler } from 'express';
import { ErrorCode } from '@campuslink/shared';
import { AppError } from '../lib/errors.js';

const MAX_DEPTH = 8;

function hasOperatorKey(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) return value.some((v) => hasOperatorKey(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([k, v]) =>
        k.startsWith('$') ||
        k.includes('.') ||
        k === '__proto__' ||
        k === 'constructor' ||
        k === 'prototype' ||
        hasOperatorKey(v, depth + 1),
    );
  }
  return false;
}

/**
 * Defence in depth against NoSQL operator injection and prototype pollution: request bodies and
 * query strings may never carry `$`-prefixed or dotted keys. (Zod strict schemas are the first line.)
 */
export const rejectOperatorKeys: RequestHandler = (req, _res, next) => {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query)) {
    return next(new AppError(400, ErrorCode.VALIDATION_FAILED, 'Request contains unsupported keys'));
  }
  next();
};
