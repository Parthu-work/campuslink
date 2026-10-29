import type { RequestHandler } from 'express';
import { ErrorCode } from '@campuslink/shared';
import { AppError } from '../lib/errors.js';

const MAX_DEPTH = 8;
/** Provider webhooks (Meta) nest deeper; still no operator or dotted keys in their bodies. */
const WEBHOOK_DEPTH = 16;
const WEBHOOK_PATH = /\/webhooks\/[a-z]+$/;
/** Meta's verification handshake is the only query that may carry dotted keys. */
const HUB_KEYS = new Set(['hub.mode', 'hub.verify_token', 'hub.challenge']);

function hasOperatorKey(value: unknown, depth = 0, max = MAX_DEPTH): boolean {
  if (depth > max) return true;
  if (Array.isArray(value)) return value.some((v) => hasOperatorKey(v, depth + 1, max));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([k, v]) =>
        k.startsWith('$') ||
        k.includes('.') ||
        k === '__proto__' ||
        k === 'constructor' ||
        k === 'prototype' ||
        hasOperatorKey(v, depth + 1, max),
    );
  }
  return false;
}

/**
 * Defence in depth against NoSQL operator injection and prototype pollution: request bodies and
 * query strings may never carry `$`-prefixed or dotted keys. (Zod strict schemas are the first line.)
 */
export const rejectOperatorKeys: RequestHandler = (req, _res, next) => {
  const webhook = WEBHOOK_PATH.test(req.path);
  const hubHandshake =
    webhook &&
    req.method === 'GET' &&
    Object.entries(req.query).every(([k, v]) => HUB_KEYS.has(k) && typeof v === 'string');
  if (
    hasOperatorKey(req.body, 0, webhook ? WEBHOOK_DEPTH : MAX_DEPTH) ||
    (!hubHandshake && hasOperatorKey(req.query))
  ) {
    return next(new AppError(400, ErrorCode.VALIDATION_FAILED, 'Request contains unsupported keys'));
  }
  next();
};
