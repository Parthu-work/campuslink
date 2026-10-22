import { z } from 'zod';
import { objectId } from './common.js';
import { tag } from './people.js';
import {
  type BookingStatus,
  DECLINE_TEMPLATES,
  type DeclineTemplate,
  FEEDBACK_TAGS,
  MENTEE_AUDIENCES,
  REQUEST_STATUSES,
  type RequestStatus,
  SESSION_DURATIONS,
  SESSION_TYPES,
  type SessionType,
  isBookable,
} from '../constants/mentorship.js';
import type { Branch } from '../constants/people.js';

// ── Mentor setup ─────────────────────────────
export const timezone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone');

/** 'HH:mm' on the 15-minute grid; '24:00' allowed as an end of day. */
export const clockTime = z
  .string()
  .regex(/^(([01]\d|2[0-3]):(00|15|30|45)|24:00)$/, 'Use HH:mm on a 15-minute step');
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const isoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Use YYYY-MM-DD');

const window = z
  .strictObject({ start: clockTime, end: clockTime })
  .refine((w) => toMinutes(w.start) < toMinutes(w.end), 'The end must be after the start');
export type TimeWindow = z.infer<typeof window>;

const noOverlap = (ws: { start: string; end: string }[]) => {
  const sorted = [...ws].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  return sorted.every((w, i) => {
    const prev = sorted[i - 1];
    return !prev || toMinutes(w.start) >= toMinutes(prev.end);
  });
};

export const weeklyRule = z.strictObject({
  /** 0 = Sunday … 6 = Saturday, in the mentor's timezone. */
  day: z.number().int().min(0).max(6),
  windows: z.array(window).min(1).max(4).refine(noOverlap, 'Time ranges overlap'),
});
export const availabilityException = z.strictObject({
  date: isoDate,
  /** Empty = unavailable all day; otherwise these windows replace the weekly hours that day. */
  windows: z.array(window).max(4).refine(noOverlap, 'Time ranges overlap'),
});
export const availabilityBody = z.strictObject({
  timezone,
  weekly: z
    .array(weeklyRule)
    .max(7)
    .refine((rs) => new Set(rs.map((r) => r.day)).size === rs.length, 'Each day appears once'),
  exceptions: z
    .array(availabilityException)
    .max(60)
    .refine((es) => new Set(es.map((e) => e.date)).size === es.length, 'Each date appears once'),
});
export type AvailabilityBody = z.infer<typeof availabilityBody>;

export const sessionTypeSetting = z.strictObject({
  type: z.enum(SESSION_TYPES),
  enabled: z.boolean(),
  durationMin: z.union([z.literal(0), ...SESSION_DURATIONS.map((d) => z.literal(d))]),
});
export const mentorSettingsBody = z
  .strictObject({
    accepting: z.boolean(),
    weeklyCap: z.number().int().min(1).max(30),
    audience: z.enum(MENTEE_AUDIENCES),
    sessionTypes: z
      .array(sessionTypeSetting)
      .min(1)
      .max(SESSION_TYPES.length)
      .refine((ts) => new Set(ts.map((t) => t.type)).size === ts.length, 'Each session type appears once'),
    minNoticeHours: z.number().int().min(1).max(72),
    horizonDays: z.number().int().min(7).max(60),
    bufferMin: z.union([z.literal(0), z.literal(15), z.literal(30)]),
  })
  .refine(
    (s) => s.sessionTypes.every((t) => (t.type === 'quick_chat' ? t.durationMin === 0 : t.durationMin > 0)),
    'Bookable sessions need a duration; quick chat has none',
  );
export type MentorSettingsBody = z.infer<typeof mentorSettingsBody>;

export const menteePrefsBody = z.strictObject({
  goals: z.array(tag).max(10),
  targetCompanies: z.array(tag).max(10),
});

export const mentorsQuery = z.strictObject({
  q: z.string().trim().max(80).optional(),
  topic: tag.optional(),
  sessionType: z.enum(SESSION_TYPES).optional(),
  cursor: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});
export const slotsQuery = z.strictObject({
  type: z.enum(SESSION_TYPES),
  from: z.iso.datetime({ offset: true }).optional(),
  days: z.coerce.number().int().min(1).max(21).default(14),
});

// ── Requests ─────────────────────────────
const longText = (min: number, max: number) =>
  z.string().trim().min(min, `At least ${min} characters`).max(max, `At most ${max} characters`);
export const slotStart = z.iso.datetime({ offset: true });

/**
 * What the mentee wants from the session, in their own words: one box (owner decision Q12,
 * docs/design/revamp/decisions.md). Optional prompts in the form add "Goal:", "Background:" and
 * "What I need:" headings, so mentors still get structure.
 */
export const REQUEST_MESSAGE_MIN = 20;
export const REQUEST_MESSAGE_MAX = 1500;
export const requestMessage = z.strictObject({
  message: longText(REQUEST_MESSAGE_MIN, REQUEST_MESSAGE_MAX),
});
/** The three-part message earlier clients sent (goal, background, what you need); still accepted. */
export const requestText = z.strictObject({
  goal: longText(10, 300),
  background: longText(10, 600),
  need: longText(10, 600),
});
const requestTarget = {
  mentorId: objectId,
  sessionType: z.enum(SESSION_TYPES),
  slotStart: slotStart.optional(),
};
export const mentorshipRequestBody = z
  .union([requestMessage.extend(requestTarget), requestText.extend(requestTarget)])
  .refine((b) => !isBookable(b.sessionType) || !!b.slotStart, {
    message: 'Pick a time for this session',
    path: ['slotStart'],
  })
  .refine((b) => isBookable(b.sessionType) || !b.slotStart, {
    message: 'Quick chats have no time slot',
    path: ['slotStart'],
  });
export type MentorshipRequestBody = z.infer<typeof mentorshipRequestBody>;

export const respondBody = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('accept') }),
  z.strictObject({ action: z.literal('accept_other'), slotStart }),
  z.strictObject({
    action: z.literal('decline'),
    template: z.enum(DECLINE_TEMPLATES),
    note: z.string().trim().max(300).optional(),
  }),
]);
export const requestsQuery = z.strictObject({
  box: z.enum(['received', 'sent']),
  status: z.enum(REQUEST_STATUSES).optional(),
  cursor: objectId.optional(),
});

// ── Bookings & feedback ─────────────────────────────
export const rescheduleBody = z.strictObject({ slotStart });
export const cancelBody = z.strictObject({ reason: z.string().trim().max(300).optional() });
export const bookingsQuery = z.strictObject({
  when: z.enum(['upcoming', 'past']).default('upcoming'),
  cursor: objectId.optional(),
});
export const feedbackBody = z.strictObject({
  rating: z.number().int().min(1).max(5),
  tags: z
    .array(z.enum(FEEDBACK_TAGS))
    .max(FEEDBACK_TAGS.length)
    .refine((t) => new Set(t).size === t.length, 'Duplicate tags'),
  comment: z.string().trim().max(1000).optional(),
});

// ── Views (API responses) ─────────────────────────────
export interface PersonRef {
  userId: string;
  name: string;
  avatarFileId: string | null;
}
export interface MentorCard extends PersonRef {
  headline: string;
  company: string;
  jobTitle: string;
  branch: Branch | null;
  gradYear: number | null;
  topics: string[];
  skills: string[];
  languages: string[];
  sessionTypes: { type: SessionType; durationMin: number }[];
  /** False when paused or the weekly cap is reached. */
  open: boolean;
  companyVerified: boolean;
}
export type MatchReason =
  | { kind: 'branch'; value: string }
  | { kind: 'company'; value: string }
  | { kind: 'goals'; values: string[] }
  | { kind: 'skills'; values: string[] }
  | { kind: 'languages'; values: string[] }
  | { kind: 'available' };
export interface MentorMatch {
  mentor: MentorCard;
  score: number;
  reasons: MatchReason[];
}
export interface MentorSettingsView extends MentorSettingsBody {
  availability: AvailabilityBody;
}
export interface SlotsView {
  timezone: string;
  durationMin: number;
  slots: string[];
}
export interface RequestView {
  id: string;
  status: RequestStatus;
  sessionType: SessionType;
  /** The mentee's message; null on requests sent in the older three-part form. */
  message: string | null;
  goal: string | null;
  background: string | null;
  need: string | null;
  slotStart: string | null;
  mentor: PersonRef;
  mentee: PersonRef;
  declineTemplate: DeclineTemplate | null;
  declineNote: string | null;
  bookingId: string | null;
  conversationId: string | null;
  createdAt: string;
  respondedAt: string | null;
  expiresAt: string;
}
export interface BookingView {
  id: string;
  status: BookingStatus;
  sessionType: SessionType;
  start: string;
  end: string;
  mentor: PersonRef;
  mentee: PersonRef;
  role: 'mentor' | 'mentee';
  rescheduleCount: number;
  canJoinFrom: string;
  canJoinUntil: string;
  cancelledBy: 'mentor' | 'mentee' | null;
  lateCancel: boolean;
  noShowBy: 'mentor' | 'mentee' | null;
  feedbackGiven: boolean;
  conversationId: string | null;
}
export interface ImpactView {
  helpedThisMonth: number;
  sessionsThisMonth: number;
  sessionsTotal: number;
  menteesTotal: number;
  averageRating: number | null;
  ratingsCount: number;
  pendingRequests: number;
}
export interface FeedbackView {
  id: string;
  bookingId: string;
  rating: number;
  tags: string[];
  comment: string;
  mentee: PersonRef;
  mentor: PersonRef;
  createdAt: string;
}
