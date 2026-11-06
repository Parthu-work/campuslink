import { z } from 'zod';
import { objectId } from './common.js';
import type { Count } from './analytics.js';
import { BRANCHES, type Branch } from '../constants/people.js';
import type { SessionType } from '../constants/mentorship.js';

/**
 * Habit loops (prompt 2, G7): the weekly Next Step, peer mentors and the Senior Buddy, circles,
 * study groups and voice Q&A. Each gives a student a reason to come back every week, built from
 * things they need anyway.
 */

// ── Weeks ─────────────────────────────

const IST_MS = 5.5 * 3600_000;
/**
 * The ISO week of an instant in India time, e.g. `2026-W45` (weeks start on Monday; week 1 holds
 * the year's first Thursday). The weekly Next Step's job id and its unique key per member.
 */
export function isoWeek(at: Date): string {
  const DAY = 86_400_000;
  const d = new Date(at.getTime() + IST_MS);
  const monday0 = (x: Date) => (x.getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  // The Thursday of this week decides the year.
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - monday0(d) + 3);
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstThursday = jan4.getTime() + (3 - monday0(jan4)) * DAY;
  const week = 1 + Math.round((thursday - firstThursday) / (7 * DAY));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The Next Step goes out from Monday 19:00 India time. */
export const NEXT_STEP_DAY = 1;
export const NEXT_STEP_HOUR = 19;
/** Whether `now` is at or after this week's send time (Monday 19:00 IST, or any later day of the week). */
export function nextStepDue(now: Date): boolean {
  const d = new Date(now.getTime() + IST_MS);
  const day = (d.getUTCDay() + 6) % 7;
  return day > 0 || d.getUTCHours() >= NEXT_STEP_HOUR;
}

// ── The weekly Next Step ─────────────────────────────

export interface NextStepView {
  week: string;
  /** The next step on the member's target roadmap. */
  roadmapStep: { roadmapId: string; slug: string; roadmap: string; nodeId: string; title: string } | null;
  /** An open drive they are eligible for and have not registered for, else a job that fits. */
  opportunity:
    | { kind: 'drive'; id: string; company: string; title: string; closesAt: string }
    | { kind: 'job'; id: string; company: string; title: string }
    | null;
  /** One alumnus to ask, from mentor matching. */
  alumnus: { userId: string; name: string; company: string; jobTitle: string } | null;
  /** The readiness score and its change since last week (when readiness is available). */
  readiness: { score: number; delta: number | null } | null;
  openedAt: string | null;
  createdAt: string;
}
export const nextStepOpenBody = z.strictObject({
  /** Which item was opened (the page records the first open of the week). */
  item: z.enum(['page', 'roadmap', 'opportunity', 'alumnus', 'readiness']).default('page'),
});

// ── Peer mentors and the Senior Buddy ─────────────────────────────

/** Peer mentors (final-years with a verified offer, or nominated by faculty) take fewer requests. */
export const PEER_WEEKLY_CAP_MAX = 3;
export const PEER_WEEKLY_CAP_DEFAULT = 2;
/** What a peer mentor offers: a quick chat or a short call, never a mock interview or a résumé review. */
export const PEER_SESSION_TYPES: readonly SessionType[] = ['quick_chat', 'video_1on1'];

export interface PeerMentorStatusView {
  /** Can become a peer mentor: a final-year with a verified offer, or nominated by faculty. */
  eligible: boolean;
  reason: 'offer' | 'nominated' | null;
  /** Already a peer mentor (their mentor settings are lighter: see PEER_WEEKLY_CAP_MAX). */
  active: boolean;
  /** Volunteering as a senior buddy for first-years. */
  buddy: { volunteering: boolean; juniors: number; max: number; canVolunteer: boolean };
}
export const peerMentorBody = z.strictObject({ on: z.boolean() });
export const buddyVolunteerBody = z.strictObject({ on: z.boolean() });
export const peerNominationBody = z.strictObject({ userId: objectId, on: z.boolean().default(true) });

/** A senior buddy guides at most this many first-years at once. */
export const BUDDY_MAX_JUNIORS = 3;
/** The four-week checklist a buddy and a first-year work through, one item a week. */
export const BUDDY_CHECKLIST = ['hello', 'campus', 'study', 'plan'] as const;
export type BuddyChecklistItem = (typeof BUDDY_CHECKLIST)[number];
export const buddyCheckBody = z.strictObject({ item: z.enum(BUDDY_CHECKLIST), done: z.boolean() });

/**
 * A first-year: graduating in about four years (months to the June of their graduation year
 * between 37 and 50). Seniors are students of any later year who are not first-years.
 */
export function isFirstYear(gradYear: number | null | undefined, now = new Date()): boolean {
  if (!gradYear) return false;
  const monthsLeft = gradYear * 12 + 5 - (now.getUTCFullYear() * 12 + now.getUTCMonth());
  return monthsLeft >= 37 && monthsLeft <= 50;
}

export interface BuddyPerson {
  userId: string;
  name: string;
  branch: Branch | null;
  gradYear: number | null;
}
export interface BuddyPairView {
  id: string;
  /** The viewer's side of the pair. */
  role: 'junior' | 'senior';
  other: BuddyPerson;
  matchedAt: string;
  /** Week of the four the pair is in (1 to 4; 5 when finished). */
  week: number;
  checklist: { item: BuddyChecklistItem; doneAt: string | null }[];
}
export interface BuddyView {
  /** First-years: their buddy, or null while none is free. */
  mine: BuddyPairView | null;
  /** Seniors: the first-years they guide. */
  juniors: BuddyPairView[];
}
export interface BuddyBoardView {
  firstYears: Count;
  matched: Count;
  waiting: Count;
  volunteers: number;
}

/** Buddy matching: same branch first, then a shared language, then the least busy senior. */
export function buddyScore(
  junior: { branch: string | null; languages: string[] },
  senior: { branch: string | null; languages: string[]; juniors: number },
): number {
  const branch = junior.branch && junior.branch === senior.branch ? 4 : 0;
  const language = junior.languages.some((l) => senior.languages.includes(l)) ? 2 : 0;
  return branch + language - senior.juniors;
}

// ── Circles ─────────────────────────────

export const CIRCLE_KINDS = ['batch', 'branch', 'club', 'interest'] as const;
export type CircleKind = (typeof CIRCLE_KINDS)[number];
/** Circles proposed by students wait for staff approval; staff circles start active. */
export const CIRCLE_STATUSES = ['pending', 'active', 'archived', 'rejected'] as const;
export type CircleStatus = (typeof CIRCLE_STATUSES)[number];
export const CIRCLES_PER_MEMBER = 30;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const circleBody = z
  .strictObject({
    name: text(3, 60),
    kind: z.enum(CIRCLE_KINDS),
    description: text(0, 500).default(''),
    branch: z.enum(BRANCHES).nullable().default(null),
    gradYear: z.number().int().min(1990).max(2100).nullable().default(null),
  })
  .refine((b) => b.kind !== 'batch' || b.gradYear !== null, {
    message: 'A batch circle needs its graduation year',
    path: ['gradYear'],
  })
  .refine((b) => b.kind !== 'branch' || b.branch !== null, {
    message: 'A branch circle needs its branch',
    path: ['branch'],
  });
export const circleIdParams = z.strictObject({ id: objectId });
export const circlesQuery = z.strictObject({
  scope: z.enum(['mine', 'discover', 'pending']).default('mine'),
});
export const circleDecisionBody = z.strictObject({ decision: z.enum(['approve', 'reject', 'archive']) });

export interface CircleView {
  id: string;
  name: string;
  kind: CircleKind;
  description: string;
  branch: Branch | null;
  gradYear: number | null;
  status: CircleStatus;
  members: number;
  joined: boolean;
  /** The viewer may post announcements-style updates and remove members (its creator, or staff). */
  manage: boolean;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

// ── Study groups ─────────────────────────────

export const STUDY_GROUP_MIN = 3;
export const STUDY_GROUP_MAX = 6;
export const STUDY_GROUP_QUESTIONS_MAX = 50;
export const studyGroupBody = z.strictObject({
  subjectId: objectId,
  name: text(3, 60),
  /** When the group meets next (optional; the members agree on it). */
  slot: z
    .strictObject({ at: z.iso.datetime(), place: text(0, 200).default('') })
    .nullable()
    .default(null),
});
export const studyGroupIdParams = z.strictObject({ id: objectId });
export const studyGroupsQuery = z.strictObject({ subjectId: objectId.optional() });
export const studyGroupSlotBody = z.strictObject({
  slot: z.strictObject({ at: z.iso.datetime(), place: text(0, 200).default('') }).nullable(),
});
export const studyGroupQuestionBody = z.strictObject({ text: text(5, 300) });
export const studyGroupQuestionParams = z.strictObject({ id: objectId, questionId: objectId });
export const studyGroupQuestionDoneBody = z.strictObject({ done: z.boolean() });
/** Shares one of the member's own finished or open `/quiz` answers with the group. */
export const studyGroupQuizBody = z.strictObject({ messageId: objectId });
export const studyGroupQuizAnswerBody = z.strictObject({
  answers: z.array(z.union([z.number().int().min(0).max(9), z.string().max(300)])).max(20),
});
export const studyGroupQuizParams = z.strictObject({ id: objectId, quizId: objectId });

export interface StudyGroupQuizView {
  id: string;
  topic: string;
  sharedBy: { id: string; name: string };
  questions: ({ kind: 'mcq'; q: string; options: string[] } | { kind: 'short'; q: string })[];
  /** The viewer's own result, once they answered (with the right answers then). */
  mine: {
    correct: number;
    total: number;
    answers: (number | string)[];
    key: { answer: number | string; explain: string }[];
  } | null;
  /** How many members took it. */
  taken: number;
  createdAt: string;
}
export interface StudyGroupView {
  id: string;
  subject: { id: string; name: string };
  name: string;
  members: { id: string; name: string }[];
  /** At least STUDY_GROUP_MIN members. */
  formed: boolean;
  joined: boolean;
  full: boolean;
  slot: { at: string; place: string } | null;
  questions: { id: string; text: string; by: { id: string; name: string }; done: boolean }[];
  quizzes: StudyGroupQuizView[];
  createdAt: string;
}

// ── Voice Q&A ─────────────────────────────

/** A voice question or answer is at most a minute; Opus at a low bitrate is well under 1 MB. */
export const VOICE_MAX_SECONDS = 60;
export const VOICE_AUDIO_MAX_BYTES = 2 * 1024 * 1024;
/** A voice post is `transcribing` until the worker writes its transcript, or `voice_failed`. */
export const VOICE_STATES = ['transcribing', 'ready', 'voice_failed'] as const;
export type VoiceState = (typeof VOICE_STATES)[number];
/** Query of a voice upload (the body is the recording). */
export const voiceUploadQuery = z.strictObject({
  /** Keep the recording so readers can play it (otherwise it is deleted after transcription). */
  keepAudio: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** A voice question asked in a circle. */
  circleId: objectId.optional(),
});
export const voiceEditBody = z.strictObject({
  title: text(10, 150).optional(),
  body: text(0, 3000),
});
export const voiceAnswerParams = z.strictObject({ id: objectId });
export interface VoiceInfo {
  state: VoiceState;
  /** The kept recording (null when the author did not keep it, or it is not processed yet). */
  audioFileId: string | null;
  durationSec: number | null;
}
