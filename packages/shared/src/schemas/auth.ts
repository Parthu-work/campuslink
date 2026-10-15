import { z } from 'zod';
import { email, password, personName, recoveryCode, totpCode } from './common.js';
import { CONSENT_PURPOSE_KEYS } from '../consent.js';

export const signupBody = z.strictObject({
  name: personName,
  email,
  password,
  intent: z.enum(['STUDENT', 'ALUMNI']),
  /** Under-18 signups are blocked (see docs/privacy.md). */
  isAdult: z.literal(true, { error: 'You must be 18 or older to join' }),
  consents: z.array(z.enum(CONSENT_PURPOSE_KEYS as [string, ...string[]])).max(10),
  locale: z.enum(['en', 'te']).default('en'),
});
export type SignupBody = z.infer<typeof signupBody>;

export const loginBody = z.strictObject({ email, password: z.string().min(1).max(128) });
export const mfaLoginBody = z.union([
  z.strictObject({ ticket: z.string().min(20).max(2000), code: totpCode }),
  z.strictObject({ ticket: z.string().min(20).max(2000), recoveryCode }),
]);
export const tokenBody = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'Invalid or expired link'),
});
export const emailBody = z.strictObject({ email });
export const resetPasswordBody = z.strictObject({ token: tokenBody.shape.token, password });
export const changePasswordBody = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});
export const mfaEnableBody = z.strictObject({ code: totpCode });
export const mfaDisableBody = z.strictObject({ password: z.string().min(1).max(128), code: totpCode });

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
}
export interface LoginResult {
  mfaRequired: boolean;
  ticket?: string;
  session?: AuthSession;
}
