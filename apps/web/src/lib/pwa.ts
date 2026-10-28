import { useEffect, useSyncExternalStore } from 'react';

/** Online/offline from the browser's connection events. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Starts registration a second after first paint so it never competes with the app's own loading. */
export function useServiceWorker() {
  useEffect(() => {
    const id = window.setTimeout(
      () => void import('./service-worker').then((m) => m.registerServiceWorker()).catch(() => undefined),
      1000,
    );
    return () => window.clearTimeout(id);
  }, []);
}
