import type { Response, Request, CookieOptions } from 'express';
import { randomToken, safeEqual } from '../lib/crypto.js';

export const REFRESH_COOKIE = 'cl_rt';
export const CSRF_COOKIE = 'cl_csrf';
export const REFRESH_PATH = '/api/v1/auth';

/** Host-only cookies (no Domain attribute) so each college subdomain has its own session. */
export function setAuthCookies(
  res: Response,
  refreshToken: string,
  maxAgeSec: number,
  secure: boolean,
): void {
  const base: CookieOptions = { secure, sameSite: 'strict', maxAge: maxAgeSec * 1000 };
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base, httpOnly: true, path: REFRESH_PATH });
  // Double-submit CSRF token: readable by our JS, sent back in X-CSRF-Token.
  res.cookie(CSRF_COOKIE, randomToken(24), { ...base, httpOnly: false, path: '/' });
}
export function clearAuthCookies(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH, secure, sameSite: 'strict', httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { path: '/', secure, sameSite: 'strict' });
}
export function csrfValid(req: Request): boolean {
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get('x-csrf-token');
  return (
    typeof cookie === 'string' &&
    typeof header === 'string' &&
    cookie.length >= 24 &&
    safeEqual(cookie, header)
  );
}
