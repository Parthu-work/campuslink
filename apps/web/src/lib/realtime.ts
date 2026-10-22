import type { Socket } from 'socket.io-client';
import { create } from 'zustand';
import { REALTIME_PATH, type ClientEvents, type ServerEvents } from '@campuslink/shared';
import { useSession } from './session';
import { refreshSession } from './api';

type AppSocket = Socket<ServerEvents, ClientEvents>;
let socket: AppSocket | null = null;
let connecting: Promise<AppSocket> | null = null;
/** Bumped on disconnect, so a connect still loading its code never outlives a sign-out. */
let generation = 0;

/**
 * One socket per tab, connected after sign-in. The Socket.io client is loaded only then, so it is
 * not part of the first load (audit PF-1). The access token is read on every (re)connect; when the
 * server closes the socket because the token expired, we refresh the session and reconnect.
 */
export function connectRealtime(): Promise<AppSocket> {
  if (socket) return Promise.resolve(socket);
  const mine = generation;
  connecting ??= import('socket.io-client').then(({ io }) => {
    const s: AppSocket = io({
      path: REALTIME_PATH,
      transports: ['websocket'],
      auth: (cb) => cb({ token: useSession.getState().accessToken ?? '' }),
      reconnectionDelayMax: 15_000,
      autoConnect: mine === generation,
    });
    const retry = async () => {
      if (await refreshSession()) setTimeout(() => s.connect(), 500);
    };
    s.on('connect_error', (e: Error & { data?: { code?: string } }) => {
      // Middleware rejections do not auto-reconnect.
      if (e.data?.code === 'UNAUTHENTICATED') void retry();
    });
    s.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') void retry();
    });
    connecting = null;
    if (mine !== generation) {
      s.disconnect();
      return s;
    }
    socket = s;
    return s;
  });
  return connecting;
}

export function disconnectRealtime() {
  generation += 1;
  connecting = null;
  socket?.disconnect();
  socket = null;
}

export const getSocket = () => socket;

let lastTyping = 0;
export function emitTyping(conversationId: string) {
  const now = Date.now();
  if (!socket?.connected || now - lastTyping < 2000) return;
  lastTyping = now;
  socket.emit('typing', { conversationId });
}

/** Who is typing where (cleared after a few seconds without a new event). */
export const useTyping = create<{ at: Record<string, number>; mark: (conversationId: string) => void }>(
  (set) => ({
    at: {},
    mark: (conversationId) => set((st) => ({ at: { ...st.at, [conversationId]: Date.now() } })),
  }),
);
