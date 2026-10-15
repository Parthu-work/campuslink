import { API_PREFIX, type ApiResponse, type ErrorCode } from '@campuslink/shared';
import { useSession } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const readCookie = (name: string) =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh: concurrent 401s share one rotation (rotation reuse would revoke the session). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    // No CSRF cookie means no session cookie either: skip the round trip.
    if (!readCookie('cl_csrf')) {
      useSession.getState().signedOut();
      return false;
    }
    try {
      const res = await fetch(`${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': readCookie('cl_csrf') ?? '' },
      });
      if (!res.ok) {
        useSession.getState().signedOut();
        return false;
      }
      const body = (await res.json()) as ApiResponse<{ session: { accessToken: string } }>;
      if (!body.ok) return false;
      useSession.getState().setToken(body.data.session.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Send the CSRF header (cookie-authenticated endpoints). */
  csrf?: boolean;
  signal?: AbortSignal;
  /** Sensitive writes: the API replays the first response for a repeated key. */
  idempotencyKey?: string;
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
  if (!body.ok) throw new ApiError(res.status, body.error.code, body.error.message, body.error.details);
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
