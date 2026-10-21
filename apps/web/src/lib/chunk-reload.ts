/**
 * Stale chunks after a deploy: the page still references chunk files the server no longer has.
 * A failed screen import is retried once; if it still fails while online, the page reloads once to
 * pick up the new build. A sessionStorage flag guards the reload so it can never loop: the flag is
 * cleared only after a screen loads successfully.
 */
const FLAG = 'cl:chunk-reload';

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ChunkLoadError' ||
    /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
      error.message,
    )
  );
}

const reloadAttempted = () => {
  try {
    return sessionStorage.getItem(FLAG) !== null;
  } catch {
    return true; // Storage blocked: never risk a loop.
  }
};

let pendingTarget: () => string | null = () => null;

/**
 * The router registers how to read the screen being opened: a navigation only commits once the
 * screen's code has loaded, so the address bar still shows the previous screen at this point.
 */
export function setPendingTargetResolver(resolve: () => string | null) {
  pendingTarget = resolve;
}

/** Reloads the page (into the screen being opened) unless a chunk reload already happened here. */
export function reloadOnce(): boolean {
  if (reloadAttempted()) return false;
  try {
    sessionStorage.setItem(FLAG, String(Date.now()));
  } catch {
    return false;
  }
  const target = pendingTarget();
  if (target) location.assign(target);
  else location.reload();
  return true;
}

/** A deliberate reload from the error screen ("Reload"): the member asked for it, so no guard. */
export function forceReload() {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    // Nothing to clear.
  }
  location.reload();
}

const loaded = () => {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    // Nothing to clear.
  }
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stays pending while the page reloads, so no error screen flashes first. */
const reloading = () => new Promise<never>(() => undefined);

export async function importWithRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    const mod = await load();
    // Vite resolves with undefined when the preload handler below took over and is reloading.
    if (mod === undefined) return reloading();
    loaded();
    return mod;
  } catch (first) {
    if (!isChunkLoadError(first) || !navigator.onLine) throw first;
    await wait(300);
    try {
      const mod = await load();
      if (mod === undefined) return reloading();
      loaded();
      return mod;
    } catch (second) {
      if (isChunkLoadError(second) && reloadOnce()) return reloading();
      throw second;
    }
  }
}

/**
 * Vite fires this when a lazily imported chunk or one of its dependencies (JS or CSS) fails to load.
 * Cancelling it makes the import resolve with undefined, so only cancel when a reload really starts;
 * otherwise the error reaches the screen's error boundary.
 */
export function installPreloadErrorHandler() {
  window.addEventListener('vite:preloadError', (event) => {
    if (navigator.onLine && reloadOnce()) event.preventDefault();
  });
}
