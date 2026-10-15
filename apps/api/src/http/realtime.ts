import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { Types } from 'mongoose';
import { REALTIME_PATH, typingEvent, type ClientEvents, type ServerEvents } from '@campuslink/shared';
import { runInTenant } from '../lib/context.js';
import type { Logger } from '../lib/logger.js';
import type { TokenService } from '../lib/jwt.js';
import { findTenantBySlug, type TenantRecord } from '../modules/tenants/tenant.cache.js';
import { slugFromHost } from './tenant.middleware.js';
import { authFromToken } from './auth.middleware.js';
import type { OriginMatcher } from '../middleware/cors.js';
import type { AuthState } from '../types.js';

interface SocketData {
  tenant: TenantRecord;
  auth: AuthState;
}
type AppSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>;
export type RealtimeServer = Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>;

/** Every room name carries the tenant: a user id alone can never address another college's socket. */
export const userRoom = (tenantId: Types.ObjectId | string, userId: string) =>
  `u:${String(tenantId)}:${userId}`;

export interface RealtimeHooks {
  /** Returns the other participant when `auth` may type in this conversation, else null. */
  typingTarget?: (auth: AuthState, conversationId: string) => Promise<string | null>;
}

/**
 * Socket.io gateway. Auth: the access token in the handshake `auth.token`, the tenant from the Host
 * header, and the same live checks as HTTP (session, status, token version). The socket is closed
 * when the access token expires; the client reconnects with a fresh token. Clients only send typing
 * events; everything else is sent by the server after a REST write has been authorised.
 */
export class RealtimeGateway {
  private io: RealtimeServer | null = null;
  readonly hooks: RealtimeHooks = {};

  constructor(
    private readonly deps: {
      tokens: TokenService;
      rootDomain: string;
      isAllowedOrigin: OriginMatcher;
      logger: Logger;
    },
  ) {}

  attach(server: HttpServer, adapter?: Parameters<RealtimeServer['adapter']>[0]): RealtimeServer {
    const io: RealtimeServer = new Server(server, {
      path: REALTIME_PATH,
      serveClient: false,
      maxHttpBufferSize: 4096, // clients only send tiny typing events
      pingInterval: 25_000,
      cors: {
        origin: (origin, cb) => cb(null, !origin || this.deps.isAllowedOrigin(origin)),
        credentials: false,
      },
      // Cross-site WebSocket hijacking guard: browsers always send Origin.
      allowRequest: (req, cb) => {
        const origin = req.headers.origin;
        cb(null, !origin || this.deps.isAllowedOrigin(origin));
      },
    });
    if (adapter) io.adapter(adapter);
    io.use((socket, next) => {
      void this.authenticate(socket as AppSocket).then(
        () => next(),
        (e: unknown) => next(Object.assign(new Error('unauthorized'), { data: { code: codeOf(e) } })),
      );
    });
    io.on('connection', (s) => this.onConnection(s as AppSocket));
    this.io = io;
    return io;
  }

  private async authenticate(socket: AppSocket) {
    // Host only (proxies in front must preserve it, as the HTTP API already requires).
    const slug = slugFromHost(socket.handshake.headers.host?.split(':')[0], this.deps.rootDomain);
    const tenant = slug ? await findTenantBySlug(slug) : null;
    if (!tenant || tenant.status !== 'active' || tenant.kind !== 'college') throw new Error('UNKNOWN_TENANT');
    const raw: unknown = socket.handshake.auth?.token;
    const token = typeof raw === 'string' && raw.length < 4096 ? raw : null;
    const auth = await runInTenant(tenant._id, () => authFromToken(this.deps.tokens, tenant, token));
    const { expiresAt, ...state } = auth;
    socket.data.tenant = tenant;
    socket.data.auth = state;
    const ms = expiresAt - Date.now();
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, ms));
    timer.unref();
    socket.on('disconnect', () => clearTimeout(timer));
  }

  private onConnection(socket: AppSocket) {
    const { tenant, auth } = socket.data;
    void socket.join(userRoom(tenant._id, auth.userId));
    let last = 0;
    socket.on('typing', (payload) => {
      const now = Date.now();
      if (now - last < 1000) return; // at most one typing event per second per socket
      last = now;
      const parsed = typingEvent.safeParse(payload);
      if (!parsed.success || !this.hooks.typingTarget) return;
      const { conversationId } = parsed.data;
      void runInTenant(tenant._id, () => this.hooks.typingTarget?.(auth, conversationId))
        .then((other) => {
          if (other) this.emitToUser(tenant._id, other, 'typing', { conversationId, userId: auth.userId });
        })
        .catch((err: unknown) => this.deps.logger.warn({ err }, 'typing event failed'));
    });
  }

  emitToUser<E extends keyof ServerEvents>(
    tenantId: Types.ObjectId | string,
    userId: string,
    event: E,
    ...args: Parameters<ServerEvents[E]>
  ): void {
    this.io?.to(userRoom(tenantId, userId)).emit(event, ...args);
  }

  /** True when the user has at least one live socket (on any instance, via the Redis adapter). */
  async isOnline(tenantId: Types.ObjectId | string, userId: string): Promise<boolean> {
    if (!this.io) return false;
    return (await this.io.in(userRoom(tenantId, userId)).fetchSockets()).length > 0;
  }

  /** Closes a user's sockets (suspension, sign-out everywhere). */
  disconnectUser(tenantId: Types.ObjectId | string, userId: string): void {
    this.io?.in(userRoom(tenantId, userId)).disconnectSockets(true);
  }

  async close(): Promise<void> {
    await this.io?.close();
    this.io = null;
  }
}

function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'UNAUTHENTICATED';
}
