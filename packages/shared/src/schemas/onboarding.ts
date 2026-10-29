import { z } from 'zod';
import { BRANCHES } from '../constants/people.js';
import { CONSENT_PURPOSE_KEYS } from '../consent.js';
import { birthMonth, OTP_CHANNELS, type OtpChannel } from './auth.js';
import { objectId } from './common.js';
import { gradYear, rollNumber } from './people.js';

/** One-tap invites and class join codes (build B4). */
export const INVITE_TTL_DAYS = 14;
/** A record is invited again at most this often. */
export const INVITE_RESEND_HOURS = 72;
/** Join codes: 8 characters without look-alikes (no 0/O, 1/I/L). */
export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const JOIN_CODE = new RegExp(`^[${JOIN_CODE_ALPHABET}]{8}$`);

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'This link is not valid');

export const inviteTokenParams = z.strictObject({ token });
export const joinCodeParams = z.strictObject({
  code: z
    .string()
    .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
    .pipe(z.string().regex(JOIN_CODE, 'Check the code')),
});

export const sendInvitesBody = z.strictObject({
  /** Records picked by hand; otherwise every unclaimed record matching the filters. */
  ids: z.array(objectId).max(1000).optional(),
  branch: z.enum(BRANCHES).optional(),
  gradYear: gradYear.optional(),
  kind: z.enum(['student', 'alumni']).optional(),
  channel: z.enum(['whatsapp', 'csv']),
  /** WhatsApp needs the recipients' opt-in: the college confirms it has it (recorded). */
  attestOptIn: z.boolean().optional(),
});

export const claimStartBody = z.strictObject({ channel: z.enum(OTP_CHANNELS).optional() });
export const claimConfirmBody = z.strictObject({
  challengeId: objectId,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  birthMonth,
  consents: z.array(z.enum(CONSENT_PURPOSE_KEYS as [string, ...string[]])).max(10),
  locale: z.enum(['en', 'te']).default('en'),
});
export const joinStartBody = z.strictObject({ rollNumber, channel: z.enum(OTP_CHANNELS).optional() });

export const createJoinCodeBody = z.strictObject({
  kind: z.enum(['student', 'alumni']),
  branch: z.enum(BRANCHES).optional(),
  gradYear: gradYear.optional(),
  days: z.number().int().min(1).max(60).default(14),
});

export const onboardingRecordsQuery = z.strictObject({
  branch: z.enum(BRANCHES).optional(),
  gradYear: z.coerce.number().int().optional(),
  kind: z.enum(['student', 'alumni']).optional(),
  status: z.enum(['unclaimed', 'claimed']).default('unclaimed'),
  cursor: objectId.optional(),
});

/** What an invite link shows before anyone signs in. */
export interface InviteView {
  college: string;
  firstName: string;
  /** 21DP1A0501 → 21DP••••01 */
  rollNumber: string;
  kind: 'student' | 'alumni';
  /** Where the code will go: the number or email on the college's record (never typed). */
  contact: 'phone' | 'email' | null;
}
export interface JoinCodeInfo {
  college: string;
  kind: 'student' | 'alumni';
  branch: string | null;
  gradYear: number | null;
}
export interface ClaimCodeSent {
  challengeId: string;
  channel: OtpChannel | 'email';
  destination: string;
  resendAfterSec: number;
}
export interface InviteSendResult {
  created: number;
  /** Invited in the last INVITE_RESEND_HOURS, already a member, or no contact for WhatsApp. */
  skipped: number;
  sent: number;
  failed: number;
}
export interface JoinCodeView {
  id: string;
  code: string;
  kind: 'student' | 'alumni';
  branch: string | null;
  gradYear: number | null;
  uses: number;
  expiresAt: string;
  active: boolean;
  createdAt: string;
}
export interface OnboardingRecordView {
  id: string;
  rollNumber: string;
  name: string;
  branch: string | null;
  gradYear: number | null;
  kind: 'student' | 'alumni';
  status: 'unclaimed' | 'claimed';
  hasPhone: boolean;
  hasEmail: boolean;
  lastInvitedAt: string | null;
}
