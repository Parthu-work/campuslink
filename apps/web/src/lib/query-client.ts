import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Spread into a screen's main read (`useQuery({ ...SCREEN, ...events() })`): when it fails with
 * nothing to show, the error reaches the route's error screen (inside the shell, with Retry)
 * instead of the screen looking empty (audit ST-2). It sits on the screen's own observer, so it
 * holds whichever started the read first (a route loader, an intent prefetch or the screen).
 * Widgets and secondary reads leave it out, so their failure never blanks the screen.
 */
export const SCREEN = {
  throwOnError: (_error: unknown, query: { state: { data: unknown } }) => query.state.data === undefined,
} as const;

/**
 * The app's one QueryClient. Route loaders (app/router.tsx) use it to start a screen's data with its
 * code. Data stays fresh for 30 s, so tab switches and Back render from cache without refetching
 * (audit PF-4); lists that should refresh when the app is resumed opt in per query (lib/queries.ts).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});
