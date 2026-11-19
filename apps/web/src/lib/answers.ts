import type { QueryKey } from '@tanstack/react-query';
import type { z } from 'zod';
import type { MicroAskInbox, MicroAskView, RequestView, respondBody } from '@campuslink/shared';
import i18n from '../i18n/core';
import { api, ApiError } from './api';
import { celebrate } from './celebrate';
import { newIdempotencyKey } from './format';
import { firstName } from './names';
import { queryClient } from './query-client';
import { toast } from './toast';
import { sendAfterUndo } from './undoable';

/**
 * Answers the other person is told about (prompt 3, U10): the screen shows them at once, they wait
 * for Undo (lib/undoable.ts) and are then sent once. Undo puts the screen back and sends nothing; a
 * failure puts it back and says why. Shared by Home, Requests, the mentor's queue and Alumni, so
 * every place answers the same way; it lives outside components, so leaving the screen inside the
 * Undo window still sends the answer.
 */

const snapshot = (key: QueryKey) => queryClient.getQueriesData({ queryKey: key });
const restore = (before: ReturnType<typeof snapshot>) => {
  for (const [k, v] of before) queryClient.setQueryData(k, v);
};
const failed = (e: unknown) => toast.error(e instanceof ApiError ? e.message : i18n.t('errors.generic'));

// ── Mentorship requests ─────────────────────────────

type RequestAnswer = z.input<typeof respondBody>;

const setRequestStatus = (id: string, status: RequestView['status']) =>
  queryClient.setQueriesData<RequestView[]>({ queryKey: ['requests'] }, (list) =>
    list?.map((r) => (r.id === id ? { ...r, status } : r)),
  );

/** Accept (at the asked time or another) or decline a request; `from` is where the celebration starts. */
export function answerRequest(r: RequestView, body: RequestAnswer, from?: Element | null) {
  const accepted = body.action !== 'decline';
  void queryClient.cancelQueries({ queryKey: ['requests'] });
  const before = snapshot(['requests']);
  setRequestStatus(r.id, accepted ? 'accepted' : 'declined');
  if (accepted) celebrate(from);
  const name = firstName(r.mentee.name);
  sendAfterUndo({
    key: `request:${r.id}`,
    message: i18n.t(accepted ? 'request.acceptedToast' : 'request.declinedToast', { name }),
    undoLabel: i18n.t('ui.undo'),
    undo: () => restore(before),
    send: () =>
      void api
        .postOnce<RequestView>(`/mentorship/requests/${r.id}/respond`, body, newIdempotencyKey())
        .then(() => {
          for (const key of [['requests'], ['bookings'], ['conversations'], ['impact']])
            void queryClient.invalidateQueries({ queryKey: key });
        })
        .catch((e: unknown) => {
          setRequestStatus(r.id, 'pending');
          failed(e);
        }),
  });
}

// ── Micro-asks (prompt 2, G6) ─────────────────────────────

/**
 * Accept a micro-ask (it stays, as accepted) or pass on it (it leaves the helper's list: the
 * server routes it to someone else). `message` comes from the screen's own strings.
 */
export function answerMicroAsk(a: MicroAskView, action: 'accept' | 'decline', message: string) {
  void queryClient.cancelQueries({ queryKey: ['micro-asks'] });
  const before = snapshot(['micro-asks']);
  queryClient.setQueriesData<MicroAskInbox>({ queryKey: ['micro-asks'] }, (inbox) =>
    inbox
      ? {
          ...inbox,
          asks:
            action === 'accept'
              ? inbox.asks.map((x) => (x.id === a.id ? { ...x, status: 'accepted' as const } : x))
              : inbox.asks.filter((x) => x.id !== a.id),
        }
      : inbox,
  );
  sendAfterUndo({
    key: `micro-ask:${a.id}`,
    message,
    undoLabel: i18n.t('ui.undo'),
    undo: () => restore(before),
    send: () =>
      void api
        .post<MicroAskView>(`/micro-asks/${a.id}/reply`, { action })
        .then(() => void queryClient.invalidateQueries({ queryKey: ['micro-asks'] }))
        .catch((e: unknown) => {
          void queryClient.invalidateQueries({ queryKey: ['micro-asks'] });
          failed(e);
        }),
  });
}
