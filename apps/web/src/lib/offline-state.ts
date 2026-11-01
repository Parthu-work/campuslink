import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Which cached reads came from the device's saved copy and have not been refreshed yet (build
 * B13). The cache module marks them on restore and forgets each one when the server answers; the
 * status pill reads the oldest one on screen to say "updated N min ago".
 */
const restored = new Map<string, number>();

export const markRestored = (hash: string, at: number) => void restored.set(hash, at);
export const forgetRestored = (hash: string) => void restored.delete(hash);
export const restoredHashes = () => [...restored.keys()];

/**
 * When the oldest saved data on screen was fetched, or null when everything on screen is live.
 * Only reads with a mounted observer count, so a saved copy of another screen never shows here.
 */
export function useSavedCopyAt(): number | null {
  const qc = useQueryClient();
  const cache = qc.getQueryCache();
  return useSyncExternalStore(
    (cb) => cache.subscribe(cb),
    () => {
      if (!restored.size) return null;
      let oldest: number | null = null;
      for (const [hash, at] of restored) {
        const q = cache.get(hash);
        if (!q || q.getObserversCount() === 0 || q.state.dataUpdatedAt !== at) continue;
        if (oldest === null || at < oldest) oldest = at;
      }
      return oldest;
    },
  );
}
