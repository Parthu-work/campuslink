import { setLeaving } from './page-leaving';
import { UNDO_MS, toast } from './toast';

/** Each waiting answer's "send it now", by key. */
const waiting = new Map<string, () => void>();

/**
 * An answer the other person is told about (accepting or declining a mentorship request or a
 * micro-ask): the screen shows it at once (the caller's optimistic update) and it waits UNDO_MS
 * before it is sent, so Undo can cancel it outright (prompt 3, U10). If the page is hidden or
 * closed first, it is sent then and its toast closes, so leaving never loses an answer and no
 * Undo is offered that would not work. A second answer to the same thing sends the first now.
 */
export function sendAfterUndo(opts: {
  /** One per thing answered ("request:<id>"). */
  key: string;
  message: string;
  undoLabel: string;
  send: () => void;
  /** Put the screen back; nothing was sent. */
  undo: () => void;
}) {
  waiting.get(opts.key)?.();
  const toastId = `undo-${opts.key}`;
  let settled = false;
  const settle = () => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    waiting.delete(opts.key);
    return true;
  };
  const send = () => {
    if (settle()) opts.send();
  };
  const timer = setTimeout(send, UNDO_MS);
  waiting.set(opts.key, () => {
    send();
    toast.dismiss(toastId);
  });
  toast.undo(
    opts.message,
    opts.undoLabel,
    () => {
      if (settle()) opts.undo();
    },
    toastId,
  );
}

/** Sends every answer still inside its Undo window. */
export function sendWaiting() {
  for (const now of [...waiting.values()]) now();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    setLeaving(true);
    sendWaiting();
  });
  // Back from the back/forward cache: an ordinary page again.
  window.addEventListener('pageshow', () => setLeaving(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendWaiting();
  });
}
