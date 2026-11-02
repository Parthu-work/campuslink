import { useSyncExternalStore } from 'react';

/**
 * Whether this device holds a saved offline copy for the member (build B13). The cache module
 * (lib/offline-cache.ts) loads in its own chunk at boot and registers the real check here, so the
 * session code can ask without pulling IndexedDB code into the first load.
 */
let probe: () => Promise<boolean> = () => Promise.resolve(false);

export const setOfflineProbe = (p: () => Promise<boolean>) => {
  probe = p;
};

export const hasOfflineCopy = () => probe().catch(() => false);

/**
 * Whether the saved copy has finished restoring into the cache. Until it has, a missing college
 * record is not yet an error: offline, the record is on its way from the device (lib/boot.ts).
 */
let settled = false;
const listeners = new Set<() => void>();

export function setSavedCopyPending(p: Promise<unknown>) {
  void p.finally(() => {
    settled = true;
    listeners.forEach((l) => l());
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useSavedCopySettled = () =>
  useSyncExternalStore(
    subscribe,
    () => settled,
    () => true,
  );
