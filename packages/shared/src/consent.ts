/**
 * Consent purposes (DPDP Act 2023: purpose-specific, granular, withdrawable).
 * Bump `version` when the wording of a purpose changes; users are re-asked on next sign-in.
 */
export const CONSENT_PURPOSES = {
  account: { version: 1, required: true },
  mentorship_matching: { version: 1, required: false },
  email_digests: { version: 1, required: false },
  analytics_aggregate: { version: 1, required: false },
} as const;
export type ConsentPurpose = keyof typeof CONSENT_PURPOSES;
export const CONSENT_PURPOSE_KEYS = Object.keys(CONSENT_PURPOSES) as ConsentPurpose[];
export const PRIVACY_NOTICE_VERSION = '2026-10-draft';
