import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { REALTIME_PATH, type ClientEvents, type ServerEvents } from '@campuslink/shared';
import { useSession } from './session';
import { refreshSession } from './api';

type AppSocket = Socket<ServerEvents, ClientEvents>;
let socket: AppSocket | null = null;

/**
 * One socket per tab. The access token is read on every (re)connect; when the server closes the
 * socket because the token expired, we refresh the session and reconnect.
 */
export function connectRealtime(): AppSocket {
  if (socket) return socket;
  const s: AppSocket = io({
    path: REALTIME_PATH,
    transports: ['websocket'],
    auth: (cb) => cb({ token: useSession.getState().accessToken ?? '' }),
    reconnectionDelayMax: 15_000,
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
  socket = s;
  return s;
}

export function disconnectRealtime() {
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
