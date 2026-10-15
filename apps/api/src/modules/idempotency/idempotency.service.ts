import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { ErrorCode } from '@campuslink/shared';
import { AppError, badRequest } from '../../lib/errors.js';
import { IdempotencyModel } from './idempotency.model.js';

const KEY = /^[A-Za-z0-9_-]{8,100}$/;
const TTL_MS = 24 * 3600_000;

export type IdempotencyStart =
  | { kind: 'none' }
  | { kind: 'replay'; status: number; response: unknown }
  | {
      kind: 'fresh';
      finish: (status: number, response: unknown) => Promise<void>;
      abort: () => Promise<void>;
    };

const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

/**
 * Sensitive writes accept `Idempotency-Key`. The first request with a key runs; repeats with the
 * same body get the stored response; a different body with the same key is refused, and a repeat
 * while the first is still running gets 409.
 */
export class IdempotencyService {
  async begin(
    userId: string,
    key: string | undefined,
    route: string,
    body: unknown,
  ): Promise<IdempotencyStart> {
    if (key === undefined) return { kind: 'none' };
    if (!KEY.test(key)) throw badRequest('Idempotency-Key must be 8–100 letters, digits, _ or -');
    const requestHash = createHash('sha256')
      .update(`${route}\n${JSON.stringify(body ?? {})}`)
      .digest('hex');
    const owner = new Types.ObjectId(userId);
    try {
      await IdempotencyModel.create({
        userId: owner,
        key,
        requestHash,
        expiresAt: new Date(Date.now() + TTL_MS),
      });
    } catch (e) {
      if (!isDuplicate(e)) throw e;
      const prior = await IdempotencyModel.findOne({ userId: owner, key }).lean();
      if (!prior) throw new AppError(409, ErrorCode.CONFLICT, 'Please retry the request');
      if (prior.requestHash !== requestHash)
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          'This Idempotency-Key was already used for a different request',
        );
      if (prior.state === 'pending')
        throw new AppError(409, ErrorCode.CONFLICT, 'The same request is still being processed');
      return { kind: 'replay', status: prior.status ?? 200, response: prior.response };
    }
    return {
      kind: 'fresh',
      finish: async (status, response) => {
        await IdempotencyModel.updateOne(
          { userId: owner, key },
          { $set: { state: 'done', status, response } },
        );
      },
      abort: async () => {
        await IdempotencyModel.deleteOne({ userId: owner, key, state: 'pending' });
      },
    };
  }
}
