import { create } from 'zustand';

/**
 * The access token lives in memory only (never localStorage). On reload we call /auth/refresh,
 * which uses the httpOnly cookie, to get a new one.
 */
interface SessionState {
  status: 'unknown' | 'signed-out' | 'signed-in';
  accessToken: string | null;
  /** True when the member chose to sign out (or deleted their account): no "return to" page. */
  byChoice: boolean;
  setToken: (token: string) => void;
  signedOut: (byChoice?: boolean) => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'unknown',
  accessToken: null,
  byChoice: false,
  setToken: (accessToken) => set({ accessToken, status: 'signed-in', byChoice: false }),
  signedOut: (byChoice = false) => set({ accessToken: null, status: 'signed-out', byChoice }),
}));
