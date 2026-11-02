/**
 * Mentorship vocabulary, time windows and limits.
 * Zod-free on purpose: screens that only need these values never load Zod (bundle budget).
 */
export const SESSION_TYPES = ['quick_chat', 'video_1on1', 'mock_interview', 'resume_review'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];
/** Quick chat is asynchronous messaging; every other type books a video slot. */
export const BOOKABLE_TYPES: readonly SessionType[] = ['video_1on1', 'mock_interview', 'resume_review'];
export const isBookable = (t: SessionType) => BOOKABLE_TYPES.includes(t);
export const SESSION_DURATIONS = [15, 30, 45, 60] as const;
export const DEFAULT_DURATIONS: Record<SessionType, number> = {
  quick_chat: 0,
  video_1on1: 30,
  mock_interview: 45,
  resume_review: 30,
};
export const MENTEE_AUDIENCES = ['students', 'alumni', 'both'] as const;
export type MenteeAudience = (typeof MENTEE_AUDIENCES)[number];
/** Bookings are held in 15-minute blocks; slot starts sit on this grid. */
export const BLOCK_MINUTES = 15;
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
export const MAX_RESCHEDULES = 2;
export const JOIN_EARLY_MINUTES = 10;
export const JOIN_LATE_MINUTES = 15;
export const LATE_CANCEL_HOURS = 12;
export const NO_SHOW_WINDOW_HOURS = 48;
export const FEEDBACK_WINDOW_DAYS = 14;
export const REQUEST_TTL_DAYS = 7;
export const MAX_PENDING_REQUESTS = 3;
/** B5: a pending request nudges the mentor after a day and offers the mentee other mentors after two. */
export const NUDGE_AFTER_HOURS = 24;
export const REMATCH_AFTER_HOURS = 48;
/** Mentors whose median reply is slower than this are not suggested in a rematch. */
export const SLOW_REPLY_HOURS = 72;
export const REMATCH_SUGGESTIONS = 3;
/** Mentor stats look back this far, and show only from these counts (small numbers mislead). */
export const STATS_WINDOW_DAYS = 90;
export const STATS_MIN_REQUESTS = 3;
export const STATS_MIN_REVIEWS = 3;
export const REVIEW_MAX_LENGTH = 280;
export const REPLY_BANDS = ['high', 'medium', 'low'] as const;
export type ReplyBand = (typeof REPLY_BANDS)[number];
export const REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'withdrawn', 'expired'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
/** Kind decline replies; the text is localised on the client, the key is stored. */
export const DECLINE_TEMPLATES = ['not_my_area', 'fully_booked', 'try_later', 'suggest_other'] as const;
export type DeclineTemplate = (typeof DECLINE_TEMPLATES)[number];
export const BOOKING_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const FEEDBACK_TAGS = [
  'clear_advice',
  'actionable',
  'kind',
  'well_prepared',
  'ran_late',
  'not_relevant',
] as const;
