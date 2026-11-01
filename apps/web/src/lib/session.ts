import { create } from 'zustand';

/**
 * The access token lives in memory only (never localStorage). On reload we call /auth/refresh,
 * which uses the httpOnly cookie, to get a new one.
 */
interface SessionState {
  /**
   * `offline`: the session could not be checked because the network is down, and this device holds
   * a saved copy for the member (lib/offline-cache.ts). The app opens read-only from that copy, with
   * no access token; the session is checked again as soon as the connection is back (build B13).
   */
  status: 'unknown' | 'signed-out' | 'signed-in' | 'offline';
  accessToken: string | null;
  /** True when the member chose to sign out (or deleted their account): no "return to" page. */
  byChoice: boolean;
  setToken: (token: string) => void;
  signedOut: (byChoice?: boolean) => void;
  offline: () => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'unknown',
  accessToken: null,
  byChoice: false,
  setToken: (accessToken) => set({ accessToken, status: 'signed-in', byChoice: false }),
  signedOut: (byChoice = false) => set({ accessToken: null, status: 'signed-out', byChoice }),
  offline: () => set({ accessToken: null, status: 'offline', byChoice: false }),
}));
