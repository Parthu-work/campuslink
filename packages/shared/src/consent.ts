/**
 * Consent purposes (DPDP Act 2023: purpose-specific, granular, withdrawable).
 * Bump `version` when the wording of a purpose changes; users are re-asked on next sign-in.
 */
export const CONSENT_PURPOSES = {
  account: { version: 1, required: true },
  mentorship_matching: { version: 1, required: false },
  email_digests: { version: 1, required: false },
  analytics_aggregate: { version: 1, required: false },
  /** Messages on WhatsApp (B3): Meta requires an explicit opt-in. */
  whatsapp_updates: { version: 1, required: false },
} as const;
export type ConsentPurpose = keyof typeof CONSENT_PURPOSES;
export const CONSENT_PURPOSE_KEYS = Object.keys(CONSENT_PURPOSES) as ConsentPurpose[];
/**
 * The network's purposes (prompt 2, G12, ADR 0014): opt-in only, never offered at sign-up, never
 * for minors, granted and withdrawn on the Network screen. Recorded in the same append-only consent
 * log; kept apart from CONSENT_PURPOSES so sign-up and Settings do not list them.
 */
export const NETWORK_CONSENT_PURPOSES = {
  network_discovery: { version: 1, required: false },
  employer_visibility: { version: 1, required: false },
} as const;
export type NetworkConsentPurpose = keyof typeof NETWORK_CONSENT_PURPOSES;
export const NETWORK_CONSENT_KEYS = Object.keys(NETWORK_CONSENT_PURPOSES) as NetworkConsentPurpose[];
/**
 * Bumped when the policy text changes; members accept again. 2026-11: SMS reminders (prompt 1b,
 * R4); 2026-11b: the inactive-account purge, stated when a college turns it on (R7).
 */
export const PRIVACY_NOTICE_VERSION = '2026-11b-draft';

/**
 * A guardian's verifiable consent for a member under 18 (DPDP Rules 2025, Rule 10). Not a choice
 * the member makes in settings: the guardian confirms the declaration with a code to their phone.
 * Bump the version when the declaration's wording changes.
 */
export const GUARDIAN_CONSENT = { purpose: 'guardian_consent', version: 1 } as const;
