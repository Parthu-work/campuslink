import { z } from 'zod';
import { objectId } from './common.js';
import { phone } from './people.js';
import type { Count } from './analytics.js';
import type { Branch } from '../constants/people.js';

/**
 * Growth loops (prompt 2, G8): batchmate invites, opt-in public pages, the college outcomes page,
 * Campus Captains, referral outcomes and the parent digest. Public pages follow E4: opt-in per
 * page, revocable, never contact details, exact CTC or anything about a minor.
 */

// ── Invites ─────────────────────────────

/** WhatsApp invites a member may send to their batch in a week (the college's allowance still applies). */
export const MEMBER_INVITES_PER_WEEK = 20;
/** A Campus Captain's daily invites to their class. */
export const CAPTAIN_INVITES_PER_DAY = 50;

export interface BatchmatesView {
  branch: Branch | null;
  gradYear: number | null;
  /** People of the member's batch on the college's list who have not joined yet. */
  notHere: number;
  /** How many of them could get a WhatsApp invite now (a number on the list, not invited lately). */
  invitable: number;
  /** Invites the member can still send this week. */
  left: number;
  /** The college has turned member invites on (it confirmed its list agreed to hear from it). */
  enabled: boolean;
}
export const batchmatesInviteBody = z.strictObject({
  /** How many to invite now (the oldest records first). */
  count: z.number().int().min(1).max(MEMBER_INVITES_PER_WEEK).default(10),
});
export interface InviteRunResult {
  sent: number;
  skipped: number;
  failed: number;
}
export const memberInviteSettingsBody = z.strictObject({
  enabled: z.boolean(),
  /** Required to turn them on: everyone on the college's list agreed to hear from it on WhatsApp. */
  attestOptIn: z.boolean().default(false),
});
export interface GrowthSettingsView {
  memberInvites: { enabled: boolean; attestedAt: string | null };
  outcomesPage: { enabled: boolean; url: string | null };
}
export const outcomesPageBody = z.strictObject({ enabled: z.boolean() });

// ── Campus Captains ─────────────────────────────

export interface CaptainClassView {
  branch: Branch | null;
  gradYear: number | null;
  /** The college's list for the captain's class (counts only; no names or numbers). */
  onList: number;
  invited: number;
  joined: number;
  verified: number;
  active7d: Count;
  invitable: number;
  /** Invites the captain can still send today. */
  left: number;
  /** Classmates who joined through the captain's own invites. */
  broughtIn: number;
  enabled: boolean;
}

// ── Public pages ─────────────────────────────

/**
 * What a member can publish: a verified placement (company and role, never the CTC), a finished
 * roadmap, how many students they mentored, or their mentor profile.
 */
export const PUBLIC_PAGE_KINDS = ['placed', 'roadmap', 'mentored', 'mentor'] as const;
export type PublicPageKind = (typeof PUBLIC_PAGE_KINDS)[number];
export const PUBLIC_NAME_STYLES = ['full', 'first'] as const;
export type PublicNameStyle = (typeof PUBLIC_NAME_STYLES)[number];
/** Slugs the college outcomes page and the app reserve. */
export const RESERVED_SLUGS = ['outcomes', 'college', 'join', 'about', 'p'] as const;

export const publicPageBody = z.strictObject({
  kind: z.enum(PUBLIC_PAGE_KINDS),
  /** The offer, roadmap or (for mentor pages) nothing: what the page is about. */
  refId: objectId.nullable().default(null),
  nameStyle: z.enum(PUBLIC_NAME_STYLES).default('full'),
  /** Let search engines list it (off by default: the link works either way). */
  indexable: z.boolean().default(false),
});
export const publicPageIdParams = z.strictObject({ id: objectId });
export const publicSlugParams = z.strictObject({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
});

/** What a page shows: opt-in fields only (the OG image and the HTML use exactly these). */
export interface PublicPageContent {
  kind: PublicPageKind;
  name: string;
  /** "Placed at Nimbus Labs", "Finished the Data Analyst roadmap", "Mentored 12 students". */
  headline: string;
  /** A second line: the role, the roadmap's steps, the mentor's title and company. */
  detail: string;
  college: string;
  year: number | null;
}
export interface PublicPageView {
  id: string;
  kind: PublicPageKind;
  slug: string;
  url: string;
  nameStyle: PublicNameStyle;
  indexable: boolean;
  status: 'live' | 'revoked';
  views: number;
  content: PublicPageContent | null;
  createdAt: string;
}
export interface PublicPageOption {
  kind: PublicPageKind;
  refId: string | null;
  /** What the page would say. */
  headline: string;
  /** Already published (live). */
  pageId: string | null;
}
export interface MyPublicPagesView {
  pages: PublicPageView[];
  options: PublicPageOption[];
  /** Minors cannot publish pages (E4). */
  allowed: boolean;
}

/** The college outcomes page (opt-in by the college): aggregates only, small counts suppressed. */
export interface CollegeOutcomesView {
  college: string;
  years: { gradYear: number; placementPct: number | null; placed: Count; medianBand: string | null }[];
  recruiters: { company: string; offers: Count }[];
  alumniAt: { company: string; alumni: Count }[];
  mentoringHours: number;
  updatedAt: string;
}

// ── Referral outcomes ─────────────────────────────

export const REFERRAL_OUTCOMES = ['interview', 'offer', 'no_response', 'rejected'] as const;
export type ReferralOutcome = (typeof REFERRAL_OUTCOMES)[number];
/** Days after a referral when the student is asked what happened. */
export const REFERRAL_OUTCOME_PROMPT_DAYS = [14, 30] as const;
export const referralOutcomeBody = z.strictObject({ outcome: z.enum(REFERRAL_OUTCOMES) });
export interface ReferralImpactView {
  referred: number;
  interviews: number;
  offers: number;
}

// ── The parent digest ─────────────────────────────

export const PARENT_LANGUAGES = ['en', 'te', 'hi'] as const;
export type ParentLanguage = (typeof PARENT_LANGUAGES)[number];
export const parentDigestBody = z.strictObject({
  phone,
  language: z.enum(PARENT_LANGUAGES).default('en'),
  /** Include the CGPA (off unless the student turns it on). */
  includeGrades: z.boolean().default(false),
});
export const parentDigestConfirmBody = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});
export interface ParentDigestView {
  status: 'none' | 'pending' | 'active';
  phoneLast4: string | null;
  language: ParentLanguage;
  includeGrades: boolean;
  lastSentAt: string | null;
}
