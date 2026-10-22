import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

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
