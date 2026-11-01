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
