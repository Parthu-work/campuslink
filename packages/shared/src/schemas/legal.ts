import { z } from 'zod';
import { email } from './common.js';

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
}
export const noticeAcceptBody = z.strictObject({ version: z.string().min(1).max(60) });
