import { matchRoutes, type Params, type RouteObject } from 'react-router';

/**
 * Warms a screen's code before the member asks for it: on hover, focus or touch of a link, and for
 * every bottom tab once the app is idle. Routes carry their importer in `handle.preload` (see
 * `app/router.tsx`); a failed preload is ignored here and handled when the screen really opens.
 */
let routes: RouteObject[] = [];
const warmed = new Set<string>();
/** When each path's data was last warmed; data is warmed again once it may be stale. */
const dataWarmed = new Map<string, number>();
const DATA_FRESH_MS = 30_000;
/**
 * Route matches per path: matching flattens, ranks and compiles every route (66 of them), and every
 * card link that scrolls into view asks, so each path is matched once.
 */
const matched = new Map<string, ReturnType<typeof matchRoutes>>();

export function registerPreloadRoutes(next: RouteObject[]) {
  if (next === routes) return;
  routes = next;
  matched.clear();
}

const matchesFor = (pathname: string) => {
  let m = matched.get(pathname);
  if (m === undefined) {
    m = matchRoutes(routes, pathname);
    matched.set(pathname, m);
  }
  return m ?? [];
};

interface PreloadHandle {
  preload?: () => Promise<unknown>;
  prefetch?: (params: Params, url: URL) => Promise<unknown>[];
}

/** Warms a destination's code and, where its route declares it, its first data. */
export function preloadPath(to: string, { data = true } = {}) {
  const url = new URL(to, location.origin);
  const pathname = url.pathname;
  if (!data && warmed.has(pathname)) return;
  const matches = matchesFor(pathname);
  if (!warmed.has(pathname)) {
    warmed.add(pathname);
    for (const m of matches) {
      const preload = (m.route.handle as PreloadHandle | undefined)?.preload;
      if (preload) void preload().catch(() => warmed.delete(pathname));
    }
  }
  const key = `${pathname}${url.search}`;
  if (!data || Date.now() - (dataWarmed.get(key) ?? 0) < DATA_FRESH_MS) return;
  dataWarmed.set(key, Date.now());
  for (const m of matches) {
    const prefetch = (m.route.handle as PreloadHandle | undefined)?.prefetch;
    for (const p of prefetch?.(m.params, url) ?? []) void p.catch(() => undefined);
  }
}

type RouteTables = (kind: 'college' | 'platform') => RouteObject[];
let tables: RouteTables | null = null;

export function registerRouteTables(next: RouteTables) {
  tables = next;
}

/**
 * Cold start: the screen the member opened loads its code while the session is still being
 * restored, and its data as soon as there is a session, instead of after the router mounts.
 */
export function warmLanding(kind: 'college' | 'platform', session: Promise<boolean>) {
  if (!tables) return;
  registerPreloadRoutes(tables(kind));
  const here = `${location.pathname}${location.search}`;
  preloadPath(here, { data: false });
  void session.then((signedIn) => signedIn && preloadPath(here));
}

/** Props for a link that warms its destination on intent. */
export function intentPreload(to: string) {
  const warm = () => preloadPath(to);
  return { onPointerEnter: warm, onFocus: warm, onTouchStart: warm };
}

/** After the first idle period, warm every given path's code (the bottom tabs). */
export function preloadWhenIdle(paths: readonly string[]) {
  const run = () => paths.forEach((p) => preloadPath(p, { data: false }));
  // Safari has no requestIdleCallback.
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(run, 1500);
  return () => clearTimeout(id);
}
