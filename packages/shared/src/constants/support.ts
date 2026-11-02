/**
 * Help and support (build B14). Zod-free so the web's screens can import it.
 */

/** What a problem report is about. `bug` goes to the platform owner; the rest to the college. */
export const SUPPORT_CATEGORIES = [
  'account',
  'verification',
  'mentorship',
  'placements',
  'study',
  'bug',
  'other',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** Who answers a report: the college's admins, or the platform owner (bugs). */
export type SupportDesk = 'college' | 'platform';
export const deskFor = (c: SupportCategory): SupportDesk => (c === 'bug' ? 'platform' : 'college');

export const SUPPORT_STATUSES = ['open', 'answered', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_LIMITS = {
  subject: 120,
  body: 2000,
  /** Replies on one report (a thread that long belongs in a call). */
  replies: 50,
  /** Open reports per member at once. */
  openPerMember: 5,
  screenshotMb: 5,
} as const;

/** Help-centre articles (apps/web/src/features/help/articles/<locale>/<id>.md). */
export const HELP_ARTICLES = [
  'getting-started',
  'verification',
  'mentorship',
  'placements',
  'study-assistant',
  'offline',
  'privacy',
] as const;
export type HelpArticleId = (typeof HELP_ARTICLES)[number];

/** What a browser reports when a screen breaks (relayed through the API; B14). */
export const CLIENT_ERROR_KINDS = ['boundary', 'chunk', 'unhandled'] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];
