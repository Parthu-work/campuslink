import { useEffect, useSyncExternalStore } from 'react';

/**
 * Service-worker registration with an "update available" prompt. The generated worker (vite-plugin-pwa,
 * registerType 'prompt') waits after installing a new version and activates on a SKIP_WAITING message,
 * so a member never has the app swapped underneath an unsent form.
 */
const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
const CHECK_EVERY_MS = 60 * 60 * 1000;

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
const setWaiting = (w: ServiceWorker | null) => {
  waiting = w;
  for (const l of listeners) l();
};

function watch(reg: ServiceWorkerRegistration) {
  // A version installed while a controller exists is an update (the first install is not).
  if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    next?.addEventListener('statechange', () => {
      if (next.state === 'installed' && navigator.serviceWorker.controller) setWaiting(next);
    });
  });
}

let started = false;
/** Set when the member accepts an update; only then does a controller change reload the page. */
let updating = false;
/** Registers /sw.js once, in production builds only (the dev server has no worker). */
export function registerServiceWorker() {
  if (started || !supported() || !import.meta.env.PROD) return;
  started = true;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install claims the page (clientsClaim) without changing any code: no reload then.
    if (reloading || !updating) return;
    reloading = true;
    location.reload();
  });
  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      watch(reg);
      setInterval(() => void reg.update().catch(() => undefined), CHECK_EVERY_MS);
    })
    .catch(() => undefined);
}

/** True when a new version is installed and waiting. */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => waiting !== null,
    () => false,
  );
}

/** Activates the waiting version; the controllerchange listener then reloads the page. */
export function applyUpdate() {
  updating = true;
  waiting?.postMessage({ type: 'SKIP_WAITING' });
}

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

/** Starts registration after first paint so it never competes with the app's own loading. */
export function useServiceWorker() {
  useEffect(() => {
    const id = window.setTimeout(registerServiceWorker, 1000);
    return () => window.clearTimeout(id);
  }, []);
}
