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
  // Prompt 2, G6: alumni engagement.
  'micro_ask_sent',
  'micro_ask_done',
  'office_hours_subscribed',
  'certificate_issued',
  'pledge_made',
  'linkedin_imported',
  // Prompt 2, G2: résumés.
  'resume_created',
  'resume_reviewed',
  'ats_checked',
  // Prompt 2, G3: mock interviews.
  'mock_started',
  'mock_completed',
  'human_mock_booked',
  // Prompt 2, G5: the placement cell nudged a student who needs help before a drive closes.
  'readiness_nudged',
  // Prompt 2, G4: aptitude and coding practice.
  'practice_set_completed',
  // Prompt 2, G7: habit loops.
  'next_step_opened',
  'buddy_matched',
  'circle_joined',
  'study_group_formed',
  'voice_question',
  // Prompt 2, G8: growth loops (page views are counted per page, never per viewer).
  'invite_sent',
  'public_page_published',
  'public_page_viewed',
  'referral_outcome_reported',
  // [slot: G9]
  // [slot: A G10 G11 G13]
  // Prompt 2, G10: the moat data (company pages are counted once a page a day per member).
  'company_page_viewed',
  'experience_shared',
  // [slot: B G12]
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
