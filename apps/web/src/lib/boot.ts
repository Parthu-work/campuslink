import { refreshSession } from './api';
import { queryClient } from './query-client';
import { me, tenant } from './queries';

/**
 * Cold start without a chain (audit PF-1, J0): the college lookup and the session refresh start
 * together as soon as the app's code runs, and `/me` follows the refresh, while the language bundle
 * downloads in parallel. The React tree then reads all three from the cache. The returned promises
 * let the landing screen warm up alongside them (`warmLanding` in app/router.tsx).
 */
export function startBoot() {
  const college = queryClient.fetchQuery(tenant());
  const session = refreshSession();
  void session.then((ok) => (ok ? queryClient.prefetchQuery(me()) : undefined));
  return { college, session };
}
