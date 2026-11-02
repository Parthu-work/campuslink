import { z } from 'zod';
import { email } from './common.js';
import type { Locale } from '../locales.js';

/**
 * The college's legal pages (build B14): the privacy policy and terms are versioned templates the
 * platform maintains; the college fills in who it is and its grievance officer (Admin › Branding).
 */
export const LEGAL_DOCS = ['privacy', 'terms'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export const legalSettingsBody = z.strictObject({
  legalName: z.string().trim().min(3).max(200),
  address: z.string().trim().min(10).max(400),
  grievanceOfficer: z.strictObject({
    name: z.string().trim().min(2).max(100),
    designation: z.string().trim().min(2).max(100),
    email,
    /** An office number is optional; the email is enough under the DPDP Rules. */
    phone: z
      .string()
      .trim()
      .regex(/^[0-9 +()-]{6,20}$/, 'Use digits, spaces and + ( ) -')
      .nullable()
      .optional(),
  }),
});
export type LegalSettingsBody = z.infer<typeof legalSettingsBody>;

export interface GrievanceOfficerView {
  name: string;
  designation: string;
  email: string;
  phone: string | null;
}
export interface LegalSettingsView {
  legalName: string | null;
  address: string | null;
  grievanceOfficer: GrievanceOfficerView | null;
  /** Bumped each time the college publishes changes; members accept again on next sign-in. */
  version: number;
  updatedAt: string | null;
}
/** GET /legal/:doc (public): the rendered policy, as plain text with the markdown subset. */
export interface LegalDocView {
  doc: LegalDoc;
  title: string;
  /** The notice version a member accepts (platform template + college details). */
  version: string;
  body: string;
  /** False until the college has filled in its legal details (the page says so). */
  complete: boolean;
  grievanceOfficer: GrievanceOfficerView | null;
  /**
   * The language of the text (prompt 1b, R13): the member's own once its translation has been
   * reviewed and published, else English. English is always the legal reference.
   */
  language: Locale;
  /** The text is a translation (the page says the English version is the legal reference). */
  translated: boolean;
}
export const noticeAcceptBody = z.strictObject({ version: z.string().min(1).max(60) });

// ── Inactive accounts (prompt 1b, R7) ───────────────────────────────

/** A college may delete accounts unused this long; off unless it turns it on. */
export const INACTIVE_MONTHS_MIN = 24;
export const INACTIVE_MONTHS_MAX = 120;
/** Warnings before an inactive account is scheduled for deletion, in days before the deadline. */
export const INACTIVE_WARNING_DAYS = [60, 14] as const;

export const retentionBody = z.strictObject({
  /** Null turns it off. */
  inactiveAccountMonths: z.number().int().min(INACTIVE_MONTHS_MIN).max(INACTIVE_MONTHS_MAX).nullable(),
});
export type RetentionBody = z.infer<typeof retentionBody>;

export interface RetentionView {
  inactiveAccountMonths: number | null;
  /** Days between a scheduled deletion and the erasure (cancelled by signing in). */
  deletedAccountGraceDays: number;
}
