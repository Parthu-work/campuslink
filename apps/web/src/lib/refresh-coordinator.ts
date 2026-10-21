/**
 * Refresh-token rotation without self-inflicted reuse (audit PW-8, decision D1).
 *
 * The API rotates the refresh cookie on every use and treats a second use of an old token as theft,
 * revoking the session. Every tab shares one cookie jar, so two tabs refreshing at the same moment
 * (or a tab refreshing twice) present the same token twice and sign the member out. This module
 * makes refresh:
 *
 * - single-flight inside a tab: concurrent callers share one request and its result;
 * - serialised across tabs with the Web Locks API (BroadcastChannel fallback), so each rotation
 *   sends the newest cookie;
 * - shared: a tab that waited while another tab rotated adopts that tab's fresh access token
 *   instead of rotating again.
 *
 * The request itself is never aborted (no AbortSignal, `keepalive` on the fetch in api.ts), so
 * navigation, unmounting or closing the tab cannot strand a rotated cookie.
 */

export interface LockLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface CoordinatorDeps {
  locks: LockLike | null;
  channel: ChannelLike | null;
  now: () => number;
  wait: (ms: number) => Promise<void>;
}

/** Result of one rotation: the new access token, or null when the session is gone. */
export type Rotate = () => Promise<string | null>;

type Message =
  | { type: 'refresh-start'; at: number }
  | { type: 'refresh-token'; token: string; at: number }
  | { type: 'refresh-failed'; at: number }
  | { type: 'signed-out' };

const LOCK_NAME = 'cl:auth-refresh';
/** Without Web Locks, how long to wait for another tab's rotation before doing our own. */
const FALLBACK_WAIT_MS = 4000;

const isMessage = (m: unknown): m is Message =>
  typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string';

export function createRefreshCoordinator(rotate: Rotate, deps: CoordinatorDeps) {
  let inflight: Promise<string | null> | null = null;
  let shared: { token: string; at: number } | null = null;
  let otherStartedAt = 0;
  let otherSettledAt = 0;
  const signedOutListeners = new Set<() => void>();
  const settledWaiters = new Set<() => void>();

  deps.channel?.addEventListener('message', ({ data }) => {
    if (!isMessage(data)) return;
    if (data.type === 'refresh-start') otherStartedAt = data.at;
    if (data.type === 'refresh-token' && typeof data.token === 'string') {
      shared = { token: data.token, at: data.at };
      otherSettledAt = data.at;
    }
    if (data.type === 'refresh-failed') otherSettledAt = data.at;
    if (data.type === 'refresh-token' || data.type === 'refresh-failed') {
      for (const w of settledWaiters) w();
      settledWaiters.clear();
    }
    if (data.type === 'signed-out') for (const l of signedOutListeners) l();
  });

  const post = (m: Message) => {
    try {
      deps.channel?.postMessage(m);
    } catch {
      // A closed channel only loses the optimisation, never correctness.
    }
  };

  /** Runs inside the cross-tab critical section. */
  const critical = async (requestedAt: number) => {
    // Another tab rotated while we queued: its token belongs to the same session, so reuse it.
    if (shared && shared.at > requestedAt) return shared.token;
    post({ type: 'refresh-start', at: deps.now() });
    let token: string | null;
    try {
      token = await rotate();
    } catch (error) {
      post({ type: 'refresh-failed', at: deps.now() });
      throw error;
    }
    const at = deps.now();
    if (token) {
      shared = { token, at };
      post({ type: 'refresh-token', token, at });
    } else post({ type: 'refresh-failed', at });
    return token;
  };

  /** Without Web Locks: if another tab is mid-rotation, wait for it (bounded) before going. */
  const viaBroadcast = async (requestedAt: number) => {
    const otherBusy = otherStartedAt > otherSettledAt && deps.now() - otherStartedAt < FALLBACK_WAIT_MS;
    if (otherBusy) {
      await Promise.race([
        new Promise<void>((resolve) => settledWaiters.add(resolve)),
        deps.wait(FALLBACK_WAIT_MS),
      ]);
    }
    return critical(requestedAt);
  };

  return {
    /** Single-flight refresh; resolves with an access token or null. */
    refresh(): Promise<string | null> {
      if (!inflight) {
        const requestedAt = deps.now();
        const run = deps.locks
          ? deps.locks.request(LOCK_NAME, () => critical(requestedAt))
          : viaBroadcast(requestedAt);
        inflight = run.finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
    /** Tell other tabs the member signed out here. */
    announceSignOut() {
      shared = null;
      post({ type: 'signed-out' });
    },
    onSignedOutElsewhere(listener: () => void) {
      signedOutListeners.add(listener);
      return () => signedOutListeners.delete(listener);
    },
  };
}
