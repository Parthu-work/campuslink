/**
 * Toasts. Sonner loads on first use, in the background, instead of with the app or with every
 * screen (bundle budget, master prompt §7d); sonner replays toasts raised before its Toaster mounts.
 * Import `toast` from here, never from 'sonner'.
 */
import type * as SonnerModule from 'sonner';

type Sonner = typeof SonnerModule;
type Toast = Sonner['toast'];

let loading: Promise<Sonner> | null = null;

export const loadSonner = () => (loading ??= import('sonner'));

const later =
  <A extends unknown[]>(show: (t: Toast, ...args: A) => unknown) =>
  (...args: A) => {
    void loadSonner().then(({ toast: t }) => show(t, ...args));
  };

/** How long an Undo is offered (prompt 3, U10). */
export const UNDO_MS = 6000;

export const toast = Object.assign(
  later((t, ...args: Parameters<Toast>) => t(...args)),
  {
    success: later((t, ...args: Parameters<Toast['success']>) => t.success(...args)),
    error: later((t, ...args: Parameters<Toast['error']>) => t.error(...args)),
    /**
     * A reversible action's confirmation with an Undo button (ADR 0015: mark done, pass on a
     * mentor, withdraw). `undoLabel` is `t('ui.undo')`; the toast stays UNDO_MS so Undo is
     * reachable. An `id` lets the caller close it (`toast.dismiss`) once Undo no longer applies.
     */
    undo: later((t, message: string, undoLabel: string, onUndo: () => void, id?: string) =>
      t(message, {
        duration: UNDO_MS,
        action: { label: undoLabel, onClick: onUndo },
        ...(id ? { id } : {}),
      }),
    ),
    dismiss: later((t, id: string) => t.dismiss(id)),
  },
);
