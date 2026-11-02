import type { QueryClient, QueryKey } from '@tanstack/react-query';
import i18n from '../i18n/core';
import { ApiError, apiRequest } from './api';
import { newIdempotencyKey } from './format';
import { useSession } from './session';
import { toast } from './toast';

/**
 * A write that is safe to send later (build B13): RSVP, saving a job, marking a roadmap step.
 * Each is a PUT that sets a state, sent with an Idempotency-Key. Offline (or with the network
 * failing), it waits in the device's outbox and goes out on reconnect; the caller's optimistic
 * update stays on screen. Resolves with the server's answer, or `undefined` when it was queued.
 * Every other write keeps failing with "you're offline".
 */
export async function putOrQueue<T>(
  qc: QueryClient,
  path: string,
  body: unknown,
  invalidate: QueryKey[],
): Promise<T | undefined> {
  const id = newIdempotencyKey();
  const live = navigator.onLine && useSession.getState().status === 'signed-in';
  if (live) {
    try {
      return (await apiRequest<T>(path, { method: 'PUT', body, idempotencyKey: id })).data;
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'NETWORK')) throw e;
    }
  }
  const { queueWrite } = await import('./offline-cache');
  await queueWrite({ id, method: 'PUT', path, body, invalidate }, qc);
  toast(i18n.t('offline.queued'));
  return undefined;
}
