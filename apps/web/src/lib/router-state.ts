/**
 * Read-only access to the router's state for code outside React's render (timers, listeners).
 * `app/router.tsx` registers the active router.
 */
let read: () => { navigating: boolean } = () => ({ navigating: false });

export function registerRouterState(reader: () => { navigating: boolean }) {
  read = reader;
}

/** True while a navigation is loading code or data (it has not committed yet). */
export const isNavigating = () => read().navigating;
