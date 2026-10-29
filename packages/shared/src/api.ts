export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

// No zod in this module: the web app's boot path imports it (bundle budget, master prompt §7d).

/** Error codes are stable strings clients can branch on; messages are for humans. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  UNKNOWN_TENANT: 'UNKNOWN_TENANT',
  MFA_REQUIRED: 'MFA_REQUIRED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  CSRF_FAILED: 'CSRF_FAILED',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  BOT_CHECK_FAILED: 'BOT_CHECK_FAILED',
  /** The college has switched this feature off (Admin › Features). */
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  /** Administrators sign in with a password and two-factor code, never a phone code. */
  USE_PASSWORD_AND_2FA: 'USE_PASSWORD_AND_2FA',
  /** No channel (WhatsApp or SMS) can deliver codes at this deployment. */
  CHANNEL_UNAVAILABLE: 'CHANNEL_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: { requestId?: string; nextCursor?: string | null };
}

export interface ApiFailure {
  ok: false;
  error: { code: ErrorCode; message: string; requestId?: string; details?: unknown };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** The Socket.io endpoint (kept here, free of schemas, so the web app's first load stays small). */
export const REALTIME_PATH = `${API_PREFIX}/realtime`;
