/**
 * First-party product events (build B9): a closed list, so nothing free-form is ever recorded.
 * Zod-free on purpose: screens that only need these values never load Zod (bundle budget).
 */
export const PRODUCT_EVENTS = [
  /** Once a day, the first time a member opens the app (weekly actives and retention). */
  'visited',
  'signed_up',
  'invite_accepted',
  'verified',
  'request_sent',
  'request_answered',
  'session_completed',
  'drive_registered',
  'offer_verified',
  'study_question',
  'roadmap_step',
] as const;
export type ProductEventName = (typeof PRODUCT_EVENTS)[number];

/** "A first meaningful action" for activation: something a member came to the app to do. */
export const MEANINGFUL_EVENTS: readonly ProductEventName[] = [
  'request_sent',
  'request_answered',
  'session_completed',
  'drive_registered',
  'study_question',
  'roadmap_step',
];

/** Events are kept this long, then rolled up into daily counts. */
export const PRODUCT_EVENT_RETENTION_DAYS = 395;
/** The analytics window: this many weeks, ending this week. */
export const INSIGHT_WEEKS = 12;
/** Retention cohorts shown (signup weeks) and how many weeks after signup each follows. */
export const RETENTION_COHORTS = 8;
