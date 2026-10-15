import { z } from 'zod';

export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

/** Error codes are stable strings clients can branch on; messages are for humans. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
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

export const cursorPageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CursorPageQuery = z.infer<typeof cursorPageQuery>;
