// No zod in this module: navigation (the web app's boot path) reads it (bundle budget).

/**
 * Per-college feature switches (Admin › Features). The API refuses a disabled feature's routes
 * with `FEATURE_DISABLED` and its background jobs do nothing; navigation hides it. The values are
 * the admin-facing one-line explanations (the web app shows translated ones).
 */
export const FEATURES = {
  studentPosting: 'Students can publish feed posts',
  stories: 'Stories: photos and notes on Home that disappear after a day',
  reels: 'Reels: short videos in the feed and the Reels page',
  leaderboards: 'Opt-in leaderboards of points',
  alumniMatch: 'Swipe-style Alumni Match on Mentors',
  jobsAggregation: 'Openings fetched automatically from public job boards',
  contentSources: 'News and articles from RSS and Atom feeds in the feed',
  study: 'Study library and the study assistant',
  placements: 'Placement drives, registrations and offers',
  whatsapp: 'WhatsApp messages and codes (when the platform has WhatsApp set up)',
  peerMentors: 'Peer mentors: seniors guiding juniors (coming soon)',
} as const;
export type Feature = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as [Feature, ...Feature[]];

/**
 * A new college starts focused (D8): stories, reels, outside content and leaderboards are off.
 * Student posting stays off too: it is a moderation policy the college opts into, not a module.
 */
export const NEW_TENANT_FEATURES: Readonly<Record<Feature, boolean>> = {
  studentPosting: false,
  stories: false,
  reels: false,
  leaderboards: false,
  alumniMatch: true,
  jobsAggregation: true,
  contentSources: false,
  study: true,
  placements: true,
  whatsapp: true,
  peerMentors: true,
};

/**
 * What a college created before the switches existed had: every module it never stored a switch
 * for was on (reels, outside content, study), and stored switches keep their value. The B1
 * migration writes these explicitly; `resolveFeatures` uses them for any key still missing.
 */
export const LEGACY_FEATURES: Readonly<Record<Feature, boolean>> = {
  studentPosting: false,
  stories: true,
  reels: true,
  leaderboards: false,
  alumniMatch: true,
  jobsAggregation: true,
  contentSources: true,
  study: true,
  placements: true,
  whatsapp: true,
  peerMentors: true,
};

/** Every switch with a value: stored values win, missing ones are the legacy defaults. */
export function resolveFeatures(
  stored: Partial<Record<string, unknown>> | undefined,
): Record<Feature, boolean> {
  const out = { ...LEGACY_FEATURES };
  for (const k of FEATURE_KEYS) if (typeof stored?.[k] === 'boolean') out[k] = stored[k];
  return out;
}
