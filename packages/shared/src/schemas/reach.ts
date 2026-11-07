import { z } from 'zod';
import { objectId } from './common.js';
import { importSourceBody } from './people.js';
import { signupBody } from './auth.js';

/**
 * Reach (prompt 2, G9): the calendar feed, the scheduled roster sync, single sign-on with the
 * college's Google Workspace or Microsoft Entra ID, and the Android app.
 */

// ── The calendar feed ─────────────────────────────

/** What the feed covers, around today. */
export const CALENDAR_PAST_DAYS = 30;
export const CALENDAR_AHEAD_DAYS = 180;
export interface CalendarFeedView {
  enabled: boolean;
  createdAt: string | null;
  lastFetchedAt: string | null;
}
/** Shown once, when the feed is made or replaced: only a hash of the token is kept. */
export interface CalendarFeedLink {
  url: string;
  /** The same address with webcal://, which Apple and most phone calendars subscribe to. */
  webcal: string;
  /** Google Calendar's "add by URL" page for it. */
  google: string;
}
export const calendarFeedParams = z.strictObject({
  file: z.string().regex(/^[A-Za-z0-9_-]{43}\.ics$/),
});

// ── The scheduled roster sync ─────────────────────────────

export const ROSTER_SYNC_FREQUENCIES = ['daily', 'weekly'] as const;
export type RosterSyncFrequency = (typeof ROSTER_SYNC_FREQUENCIES)[number];
/** A run that would change more than this share of the source's rows waits for an admin. */
export const ROSTER_SYNC_APPROVAL_SHARE = 0.05;
/** A waiting run expires after this many days (the next run makes a fresh one). */
export const ROSTER_SYNC_PENDING_DAYS = 7;
export const rosterSyncBody = z.strictObject({
  source: importSourceBody,
  /** A completed roster import from this source: its column mapping is reused. */
  fromJobId: objectId,
  frequency: z.enum(ROSTER_SYNC_FREQUENCIES),
  /** For weekly runs: 0 is Sunday (India time). */
  weekday: z.number().int().min(0).max(6).default(1),
});
export const rosterSyncUpdateBody = z.strictObject({
  enabled: z.boolean().optional(),
  frequency: z.enum(ROSTER_SYNC_FREQUENCIES).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
});
export interface RosterSyncDiff {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedClaimed: number;
  errors: number;
  /** created + updated, as a share of the rows read. */
  changedShare: number;
  /** Up to 50 changed records: roll number and which fields change (never the values). */
  sample: { rollNumber: string; change: 'new' | 'updated'; fields: string[] }[];
  at: string;
  expiresAt: string;
}
export interface RosterSyncView {
  configured: boolean;
  enabled: boolean;
  frequency: RosterSyncFrequency;
  weekday: number;
  source: { kind: 'gsheet' | 'rest'; label: string; hasToken: boolean } | null;
  lastRunAt: string | null;
  lastStatus: 'applied' | 'waiting' | 'nochange' | 'failed' | 'rejected' | null;
  lastError: string | null;
  lastImportId: string | null;
  pending: RosterSyncDiff | null;
}

// ── Single sign-on ─────────────────────────────

export const SSO_PROVIDERS = ['google', 'microsoft'] as const;
export type SsoProvider = (typeof SSO_PROVIDERS)[number];
export const ssoProviderParams = z.strictObject({ provider: z.enum(SSO_PROVIDERS) });
export const ssoStartQuery = z.object({ next: z.string().max(300).optional() });
/** The identity provider adds its own parameters (scope, hd, session_state…): not strict. */
export const ssoCallbackQuery = z.object({
  code: z.string().max(4096).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(200).optional(),
});
/** Why a sign-in came back to the sign-in page (the page explains each one). */
export const SSO_ERRORS = ['cancelled', 'failed', 'domain', 'suspended', 'unavailable', 'expired'] as const;
export type SsoError = (typeof SSO_ERRORS)[number];
export const ssoSettingsBody = z.strictObject({
  enabled: z.boolean(),
  clientId: z.string().trim().min(8).max(200),
  /** Write-only; omitted keeps the stored one. */
  clientSecret: z.string().trim().min(8).max(500).optional(),
  /** Microsoft Entra ID only: the college's directory (tenant) ID. */
  directoryId: z.string().uuid().optional(),
});
export interface SsoProviderSettingsView {
  provider: SsoProvider;
  enabled: boolean;
  clientId: string | null;
  hasSecret: boolean;
  directoryId: string | null;
  /** The address to register in the identity provider's app settings. */
  redirectUri: string;
}
export interface SsoSettingsView {
  providers: SsoProviderSettingsView[];
  /** Sign-in is offered only for these domains (Admin › Branding › email domains). */
  allowedEmailDomains: string[];
}
/** Finishing an account that a first single sign-on started (the rest of sign-up). */
export const ssoCompleteBody = signupBody
  .pick({ intent: true, birthMonth: true, consents: true, locale: true })
  .extend({ ticket: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/) });
export interface SsoPendingView {
  provider: SsoProvider;
  email: string;
  name: string;
}
