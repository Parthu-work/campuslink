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

export const toast = Object.assign(
  later((t, ...args: Parameters<Toast>) => t(...args)),
  {
    success: later((t, ...args: Parameters<Toast['success']>) => t.success(...args)),
    error: later((t, ...args: Parameters<Toast['error']>) => t.error(...args)),
  },
);
