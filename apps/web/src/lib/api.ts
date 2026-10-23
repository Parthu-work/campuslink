import { API_PREFIX, type ApiResponse, type ErrorCode } from '@campuslink/shared';
import { useSession } from './session';
import { botCheckEnabled } from './bot-check-config';
import { createRefreshCoordinator } from './refresh-coordinator';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
    /** The API's request id, shown on error screens so support can find the log line. */
    readonly requestId?: string,
  ) {
    super(message);
  }
}

const readCookie = (name: string) =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/** One rotation: the new access token, or null when the session is gone. Never aborted. */
async function rotate(): Promise<string | null> {
  const res = await fetch(`${API_PREFIX}/auth/refresh`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': readCookie('cl_csrf') ?? '' },
    // Outlives the page, so closing or backgrounding the tab can't strand a rotated cookie.
    keepalive: true,
  });
  if (res.status === 401 || res.status === 403) return null;
  // Rate limits and server errors leave the cookie unrotated: the session is still good.
  if (!res.ok) throw new Error(`refresh unavailable (${res.status})`);
  const body = (await res.json()) as ApiResponse<{ session: { accessToken: string } }>;
  return body.ok ? body.data.session.accessToken : null;
}

const coordinator = createRefreshCoordinator(rotate, {
  locks: typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null,
  channel: typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cl:session') : null,
  now: () => Date.now(),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
});
coordinator.onSignedOutElsewhere(() => useSession.getState().signedOut());

/** Tell the other tabs this member signed out. */
export const announceSignOut = () => coordinator.announceSignOut();

/**
 * Trade the refresh cookie for an access token. Single-flight in the tab and serialised across tabs
 * (lib/refresh-coordinator.ts); a dead session signs out, a network failure keeps the session.
 */
export async function refreshSession(): Promise<boolean> {
  // No CSRF cookie means no session cookie either: skip the round trip.
  if (!readCookie('cl_csrf')) {
    useSession.getState().signedOut();
    return false;
  }
  try {
    const token = await coordinator.refresh();
    if (!token) {
      useSession.getState().signedOut();
      return false;
    }
    useSession.getState().setToken(token);
    return true;
  } catch {
    if (useSession.getState().status === 'unknown') useSession.getState().signedOut();
    return false;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Send the CSRF header (cookie-authenticated endpoints). */
  csrf?: boolean;
  signal?: AbortSignal;
  /** Sensitive writes: the API replays the first response for a repeated key. */
  idempotencyKey?: string;
  /** Set on the one retry after a BOT_CHECK_FAILED answer (lib/bot-check.ts). */
  botToken?: string;
}

export async function apiRequest<T>(
  path: string,
  opts: RequestOptions = {},
  retried = false,
): Promise<{ data: T; meta?: { nextCursor?: string | null } }> {
  const token = useSession.getState().accessToken;
  const headers: Record<string, string> = {};
  const isForm = opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.csrf) headers['X-CSRF-Token'] = readCookie('cl_csrf') ?? '';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.botToken) headers['X-Bot-Token'] = opts.botToken;

  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      ...(opts.body !== undefined
        ? { body: isForm ? (opts.body as FormData) : JSON.stringify(opts.body) }
        : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'You seem to be offline. Check your connection and try again.');
  }

  if (res.status === 401 && token && !retried && (await refreshSession())) {
    return apiRequest<T>(path, opts, true);
  }
  if (res.status === 204) return { data: undefined as T };
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) throw new ApiError(res.status, 'INTERNAL', 'Something went wrong. Please try again.');
  if (!body.ok) {
    // A protected write: run the human check once, then retry with its single-use token. The API
    // checks bots before idempotency and the handler, so the first attempt changed nothing.
    if (body.error.code === 'BOT_CHECK_FAILED' && !opts.botToken && botCheckEnabled()) {
      // The Turnstile loader is fetched only now, so it stays out of the first load.
      const botToken = await import('./bot-check').then((m) => m.getBotToken()).catch(() => null);
      if (botToken) return apiRequest<T>(path, { ...opts, botToken }, retried);
    }
    throw new ApiError(
      res.status,
      body.error.code,
      body.error.message,
      body.error.details,
      body.error.requestId,
    );
  }
  return { data: body.data, ...(body.meta ? { meta: body.meta } : {}) };
}

/** Authenticated binary download (files, CSV reports): returns a Blob. */
export async function apiBlob(path: string, retried = false): Promise<Blob> {
  const token = useSession.getState().accessToken;
  const res = await fetch(`${API_PREFIX}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'same-origin',
  }).catch(() => {
    throw new ApiError(0, 'NETWORK', 'You seem to be offline. Check your connection and try again.');
  });
  if (res.status === 401 && token && !retried && (await refreshSession())) return apiBlob(path, true);
  if (!res.ok) throw new ApiError(res.status, 'NOT_FOUND', 'That file is not available.');
  return res.blob();
}

/** Saves a Blob through a temporary link (works in normal browsing contexts). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  upload: <T>(path: string, form: FormData) =>
    apiRequest<T>(path, { method: 'POST', body: form }).then((r) => r.data),
  get: <T>(path: string, signal?: AbortSignal) =>
    apiRequest<T>(path, signal ? { signal } : {}).then((r) => r.data),
  page: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown, csrf = false) =>
    apiRequest<T>(path, { method: 'POST', body, csrf }).then((r) => r.data),
  /** POST with an Idempotency-Key (create one per user action, reuse it on retry). */
  postOnce: <T>(path: string, body: unknown, idempotencyKey: string) =>
    apiRequest<T>(path, { method: 'POST', body, idempotencyKey }).then((r) => r.data),
  patch: <T>(path: string, body: unknown) =>
    apiRequest<T>(path, { method: 'PATCH', body }).then((r) => r.data),
  put: <T>(path: string, body: unknown) => apiRequest<T>(path, { method: 'PUT', body }).then((r) => r.data),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }).then((r) => r.data),
};
