import { z } from 'zod';
import { email, password, personName, recoveryCode, totpCode } from './common.js';
import { CONSENT_PURPOSE_KEYS } from '../consent.js';
import { BIRTH_MONTH, plausibleBirthMonth } from '../age.js';
import { phone } from './people.js';

/**
 * 'YYYY-MM'. Only the date the member turns 18 is stored (`adultOn`), never the month itself;
 * members under 18 need their guardian's consent (docs/specs/phone-identity.md).
 */
export const birthMonth = z
  .string()
  .regex(BIRTH_MONTH, 'Use the form YYYY-MM')
  .refine((v) => plausibleBirthMonth(v), 'Check the year and month you were born');

const consents = z.array(z.enum(CONSENT_PURPOSE_KEYS as [string, ...string[]])).max(10);
const locale = z.enum(['en', 'te']).default('en');
const intent = z.enum(['STUDENT', 'ALUMNI']);

export const signupBody = z.strictObject({
  name: personName,
  email,
  password,
  intent,
  birthMonth,
  consents,
  locale,
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

// ── Phone codes (WhatsApp first, SMS fallback) ─────────────────────────────
export const OTP_CHANNELS = ['whatsapp', 'sms'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];
const otpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
const challengeId = z.string().regex(/^[a-f0-9]{24}$/, 'Start again');

export const phoneStartBody = z.strictObject({
  phone,
  purpose: z.enum(['signup', 'login']),
  channel: z.enum(OTP_CHANNELS).optional(),
  /** The language of the code message (the account's own language wins when it exists). */
  locale: z.enum(['en', 'te']).optional(),
});
export const phoneSignupFields = z.strictObject({ name: personName, intent, birthMonth, consents, locale });
export const phoneVerifyBody = z.strictObject({
  challengeId,
  code: otpCode,
  signup: phoneSignupFields.optional(),
});
export type PhoneSignupFields = z.infer<typeof phoneSignupFields>;

export const phoneChangeBody = z.strictObject({
  phone,
  /** Proves it is you when the old number is gone; otherwise a code goes to the old number. */
  password: z.string().min(1).max(128).optional(),
  channel: z.enum(OTP_CHANNELS).optional(),
});
export const otpConfirmBody = z.strictObject({ challengeId, code: otpCode });

export const guardianStartBody = z.strictObject({ channel: z.enum(OTP_CHANNELS).optional() });
export const guardianConfirmBody = z.strictObject({
  challengeId,
  code: otpCode,
  language: z.enum(['en', 'te']),
});
export const guardianManualBody = z.strictObject({ phone });

/** What `POST /auth/phone/start` and the other code senders answer (same shape whatever happened). */
export interface CodeSent {
  challengeId: string;
  /** The channel the code went by (or would have). */
  channel: OtpChannel;
  /** Seconds before another code can be asked for. */
  resendAfterSec: number;
}

export interface GuardianStatus {
  required: boolean;
  /** Matched to a roster record (needed before a guardian code can be sent). */
  rosterMatched: boolean;
  /** The guardian's number on the roster, masked (+91 ••••• ••338), or null. */
  guardianPhone: string | null;
  /** A number the member entered is waiting for the college to approve it. */
  manualPending: boolean;
  declarationVersion: number;
}
