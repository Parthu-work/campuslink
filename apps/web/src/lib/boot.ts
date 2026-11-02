import { refreshSession } from './api';
import { queryClient } from './query-client';
import { me, tenant } from './queries';
import { setOfflineProbe, setSavedCopyPending } from './offline-probe';

/**
 * Cold start without a chain (audit PF-1, J0): the college lookup and the session refresh start
 * together as soon as the app's code runs, and `/me` follows the refresh, while the language bundle
 * downloads in parallel. The React tree then reads all three from the cache. The returned promises
 * let the landing screen warm up alongside them (`warmLanding` in app/router.tsx). `saved` settles
 * once the offline copy is back in the cache (B13).
 */
export function startBoot() {
  // The device's saved copy (B13) restores in parallel; the session check asks it whether the app
  // can open offline when the network is down.
  const saved = import('./offline-cache')
    .then((m) => m.startOfflineCache(queryClient))
    .catch(() => ({ owner: null }));
  setOfflineProbe(() => saved.then((s) => s.owner !== null));
  setSavedCopyPending(saved);
  const college = queryClient.fetchQuery(tenant());
  const session = refreshSession();
  void session.then((ok) => (ok ? queryClient.prefetchQuery(me()) : undefined));
  return { college, session, saved };
}
