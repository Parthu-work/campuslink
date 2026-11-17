import type { QueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@campuslink/shared';
import { useSession } from './session';
import { me } from './queries';

/**
 * Starts a member's session after sign-in, sign-up, an invite or single sign-on: the new token, then
 * their own profile before anything routes by it (`/start` picks the first screen from it). If this
 * device still held another member's data (a saved copy from a session that expired rather than
 * signed out), that data is dropped, with the device's saved copy and its unsent actions, so the
 * next member is never shown, routed by, or acting as the previous one.
 */
export async function startSession(qc: QueryClient, accessToken: string): Promise<MeResponse | undefined> {
  const before = qc.getQueryData<MeResponse>(me().queryKey);
  useSession.getState().setToken(accessToken);
  let now: MeResponse;
  try {
    now = await qc.fetchQuery({ ...me(), staleTime: 0 });
  } catch {
    // The profile could not be read now: screens fetch it themselves, as before.
    void qc.invalidateQueries({ queryKey: me().queryKey });
    return undefined;
  }
  if (before && before.id !== now.id) {
    qc.removeQueries({ predicate: (q) => !['tenant', 'me'].includes(String(q.queryKey[0])) });
    void import('./offline-cache').then((m) => m.clearOfflineCopy()).catch(() => undefined);
  }
  return now;
}
