import { ErrorCode } from '@campuslink/shared';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Resource') => new AppError(404, ErrorCode.NOT_FOUND, `${what} not found`);
export const forbidden = () =>
  new AppError(403, ErrorCode.FORBIDDEN, 'You do not have permission to do that');
export const unauthenticated = () => new AppError(401, ErrorCode.UNAUTHENTICATED, 'Please sign in');
