import { z } from 'zod';
import { objectId } from './common.js';
import { httpsUrl } from './people.js';
import type { PersonRef } from './mentorship.js';
import { BRANCHES, type Branch } from '../constants/people.js';

export const EVENT_KINDS = ['meetup', 'talk', 'drive', 'workshop', 'ama', 'office_hours'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
/** Kinds alumni may host with `ama:host` (everything else needs `events:create`). */
export const HOSTED_KINDS: readonly EventKind[] = ['ama', 'office_hours'];
/** Kinds with a live Q&A queue. */
export const QA_KINDS: readonly EventKind[] = ['ama', 'office_hours', 'talk'];
export const EVENT_MODES = ['online', 'in_person', 'hybrid'] as const;
export const EVENT_AUDIENCES = ['everyone', 'students', 'alumni'] as const;
export const RSVP_STATUSES = ['going', 'waitlist', 'cancelled'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
/** The online link opens this long before the start. */
export const EVENT_LINK_LEAD_MIN = 15;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const isoDate = z.iso.datetime({ offset: true });

const eventFields = {
  title: text(3, 120),
  description: text(10, 4000),
  kind: z.enum(EVENT_KINDS),
  mode: z.enum(EVENT_MODES),
  startsAt: isoDate,
  endsAt: isoDate,
  location: text(0, 200).default(''),
  onlineUrl: httpsUrl.nullable().default(null),
  capacity: z.number().int().min(1).max(10_000).nullable().default(null),
  audience: z.enum(EVENT_AUDIENCES).default('everyone'),
  branches: z.array(z.enum(BRANCHES)).max(10).default([]),
};
const eventRules = <
  T extends { startsAt: string; endsAt: string; mode: string; location: string; onlineUrl: string | null },
>(
  e: T,
  ctx: z.RefinementCtx,
) => {
  const s = Date.parse(e.startsAt);
  const end = Date.parse(e.endsAt);
  if (!(end > s))
    ctx.addIssue({ code: 'custom', message: 'The end must be after the start', path: ['endsAt'] });
  if (end - s > 14 * 86_400_000)
    ctx.addIssue({ code: 'custom', message: 'Events last at most 14 days', path: ['endsAt'] });
  if (e.mode !== 'in_person' && !e.onlineUrl)
    ctx.addIssue({ code: 'custom', message: 'Add the online link', path: ['onlineUrl'] });
  if (e.mode !== 'online' && e.location.length < 2)
    ctx.addIssue({ code: 'custom', message: 'Add the venue', path: ['location'] });
};
export const eventBody = z.strictObject(eventFields).superRefine(eventRules);
export const eventUpdateBody = z
  .strictObject({ ...eventFields, notifyChange: z.boolean().default(true) })
  .superRefine(eventRules);
export const eventsQuery = z.strictObject({
  when: z.enum(['upcoming', 'past', 'mine']).default('upcoming'),
  kind: z.enum(EVENT_KINDS).optional(),
  cursor: objectId.optional(),
});
export const rsvpBody = z.strictObject({ going: z.boolean() });
export const checkInBody = z.strictObject({ userId: objectId, attended: z.boolean() });
export const eventQuestionBody = z.strictObject({ body: text(5, 500) });
export const eventQuestionStatusBody = z.strictObject({ status: z.enum(['open', 'answered', 'hidden']) });

export interface EventView {
  id: string;
  title: string;
  description: string;
  kind: EventKind;
  mode: (typeof EVENT_MODES)[number];
  startsAt: string;
  endsAt: string;
  location: string;
  /** Only for people who are going, from EVENT_LINK_LEAD_MIN minutes before the start (and hosts). */
  onlineUrl: string | null;
  capacity: number | null;
  audience: (typeof EVENT_AUDIENCES)[number];
  branches: Branch[];
  host: PersonRef;
  status: 'scheduled' | 'cancelled' | 'removed';
  going: number;
  waitlist: number;
  myRsvp: RsvpStatus | null;
  myWaitlistPosition: number | null;
  isHost: boolean;
  canManage: boolean;
  hasQa: boolean;
}
export interface AttendeeView {
  person: PersonRef;
  status: RsvpStatus;
  checkedIn: boolean;
}
export interface EventQuestionView {
  id: string;
  body: string;
  author: PersonRef;
  votes: number;
  votedByMe: boolean;
  status: 'open' | 'answered' | 'hidden';
  isMine: boolean;
  createdAt: string;
}

/** RFC 5545 text escaping (backslash, semicolon, comma, newlines). */
export const icsEscape = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
