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
