import { create } from 'zustand';

/**
 * The access token lives in memory only (never localStorage). On reload we call /auth/refresh,
 * which uses the httpOnly cookie, to get a new one.
 */
interface SessionState {
  status: 'unknown' | 'signed-out' | 'signed-in';
  accessToken: string | null;
  setToken: (token: string) => void;
  signedOut: () => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'unknown',
  accessToken: null,
  setToken: (accessToken) => set({ accessToken, status: 'signed-in' }),
  signedOut: () => set({ accessToken: null, status: 'signed-out' }),
}));
