import { matchRoutes, type RouteObject } from 'react-router';

/**
 * Warms a screen's code before the member asks for it: on hover, focus or touch of a link, and for
 * every bottom tab once the app is idle. Routes carry their importer in `handle.preload` (see
 * `app/router.tsx`); a failed preload is ignored here and handled when the screen really opens.
 */
let routes: RouteObject[] = [];
const warmed = new Set<string>();

export function registerPreloadRoutes(next: RouteObject[]) {
  routes = next;
}

interface PreloadHandle {
  preload?: () => Promise<unknown>;
}

export function preloadPath(to: string) {
  const pathname = to.split(/[?#]/)[0] ?? to;
  if (!pathname || warmed.has(pathname)) return;
  warmed.add(pathname);
  for (const m of matchRoutes(routes, pathname) ?? []) {
    const preload = (m.route.handle as PreloadHandle | undefined)?.preload;
    if (preload) void preload().catch(() => warmed.delete(pathname));
  }
}

/** Props for a link that warms its destination on intent. */
export function intentPreload(to: string) {
  const warm = () => preloadPath(to);
  return { onPointerEnter: warm, onFocus: warm, onTouchStart: warm };
}

/** After the first idle period, warm every given path (the bottom tabs). */
export function preloadWhenIdle(paths: readonly string[]) {
  const run = () => paths.forEach(preloadPath);
  // Safari has no requestIdleCallback.
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(run, 1500);
  return () => clearTimeout(id);
}
