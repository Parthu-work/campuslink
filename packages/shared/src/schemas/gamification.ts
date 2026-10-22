import { z } from 'zod';
import { objectId } from './common.js';
import type { PersonRef } from './mentorship.js';
import type { Branch } from '../constants/people.js';

// ── Ledger ─────────────────────────────
export const XP_TRACKS = ['xp', 'impact'] as const;
export type XpTrack = (typeof XP_TRACKS)[number];

/** Every way to earn points: track, points and an optional daily cap (number of awards per day). */
export const XP_RULES = {
  roadmap_step: { track: 'xp', points: 10, dailyCap: 10 },
  roadmap_finished: { track: 'xp', points: 100, dailyCap: null },
  post_published: { track: 'xp', points: 5, dailyCap: 3 },
  answer_accepted: { track: 'xp', points: 20, dailyCap: null },
  session_completed: { track: 'xp', points: 15, dailyCap: null },
  feedback_given: { track: 'xp', points: 5, dailyCap: null },
  event_attended: { track: 'xp', points: 10, dailyCap: null },
  session_mentored: { track: 'impact', points: 10, dailyCap: null },
  new_mentee: { track: 'impact', points: 15, dailyCap: null },
  referral_given: { track: 'impact', points: 8, dailyCap: null },
  answer_accepted_alumni: { track: 'impact', points: 5, dailyCap: null },
  roadmap_published: { track: 'impact', points: 20, dailyCap: null },
  event_hosted: { track: 'impact', points: 10, dailyCap: null },
} as const satisfies Record<string, { track: XpTrack; points: number; dailyCap: number | null }>;
export type XpKind = keyof typeof XP_RULES;
export const XP_KINDS = Object.keys(XP_RULES) as XpKind[];

/** Level n needs 50·n·(n+1) XP (n ≥ 1): 100, 300, 600, 1000, … */
export const xpForLevel = (n: number) => 50 * n * (n + 1);
export function levelFor(xp: number): { level: number; current: number; next: number } {
  let level = 0;
  while (xp >= xpForLevel(level + 1)) level++;
  return { level, current: xpForLevel(level), next: xpForLevel(level + 1) };
}

export const MENTOR_LEVELS = [
  { id: 'bronze', min: 50 },
  { id: 'silver', min: 200 },
  { id: 'gold', min: 500 },
  { id: 'platinum', min: 1000 },
] as const;
export type MentorLevel = (typeof MENTOR_LEVELS)[number]['id'];
export function mentorLevelFor(impact: number): MentorLevel | null {
  let out: MentorLevel | null = null;
  for (const l of MENTOR_LEVELS) if (impact >= l.min) out = l.id;
  return out;
}

/** Longest run of consecutive days ending today or yesterday (keys are YYYY-MM-DD, any order). */
export function currentStreak(dayKeys: readonly string[], today: string): number {
  const days = new Set(dayKeys);
  const prev = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 1);
    return t.toISOString().slice(0, 10);
  };
  let d = days.has(today) ? today : prev(today);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = prev(d);
  }
  return n;
}

// ── Badges ─────────────────────────────
export const BADGES = [
  'first_step',
  'roadmap_finisher',
  'streak_7',
  'streak_30',
  'helpful_answer',
  'first_session',
  'event_goer',
  'mentor_first',
  'mentor_10',
  'referrer_5',
  'roadmap_author',
] as const;
export type BadgeId = (typeof BADGES)[number];

// ── Rewards ─────────────────────────────
export const REWARD_KINDS = ['certificate', 'event_invite', 'goodies', 'other'] as const;
export const REDEMPTION_STATUSES = ['pending', 'fulfilled', 'rejected', 'cancelled'] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const rewardBody = z.strictObject({
  title: text(3, 80),
  description: text(0, 500).default(''),
  kind: z.enum(REWARD_KINDS),
  track: z.enum(XP_TRACKS),
  cost: z.number().int().min(1).max(100_000),
  /** null = unlimited. */
  stock: z.number().int().min(0).max(100_000).nullable().default(null),
  active: z.boolean().default(true),
});
export const rewardUpdateBody = rewardBody.partial().strict();
export const redeemBody = z.strictObject({ rewardId: objectId });
export const redemptionDecisionBody = z.strictObject({
  decision: z.enum(['fulfil', 'reject']),
  note: text(0, 300).default(''),
});
export const redemptionsQuery = z.strictObject({ status: z.enum(REDEMPTION_STATUSES).optional() });

// ── Settings and admin ─────────────────────────────
export const gamificationPrefsBody = z.strictObject({
  showOnLeaderboard: z.boolean(),
  showOnWall: z.boolean(),
});
export const leaderboardQuery = z.strictObject({ scope: z.enum(['college', 'branch']).default('college') });
export const revokeXpBody = z.strictObject({ reason: text(5, 300) });

// ── Views ─────────────────────────────
export interface XpEventView {
  id: string;
  kind: XpKind | 'revoked' | 'redeemed' | 'refund';
  track: XpTrack;
  points: number;
  createdAt: string;
  note: string;
}
export interface MyProgressView {
  xp: number;
  level: { level: number; current: number; next: number };
  streak: number;
  impact: number;
  mentorLevel: MentorLevel | null;
  menteesHelped: number;
  sessionsMentored: number;
  balance: { xp: number; impact: number };
  badges: { id: BadgeId; awardedAt: string }[];
  prefs: { showOnLeaderboard: boolean; showOnWall: boolean };
  recent: XpEventView[];
}
export interface LeaderboardRow {
  rank: number;
  person: PersonRef;
  branch: Branch | null;
  points: number;
  isMe: boolean;
}
export interface WallOfMentorsView {
  mentorOfTheMonth: { person: PersonRef; month: string; impact: number } | null;
  mentors: { person: PersonRef; level: MentorLevel; impact: number; menteesHelped: number }[];
}
export interface RewardView {
  id: string;
  title: string;
  description: string;
  kind: (typeof REWARD_KINDS)[number];
  track: XpTrack;
  cost: number;
  stock: number | null;
  active: boolean;
}
export interface RedemptionView {
  id: string;
  reward: { id: string; title: string; kind: (typeof REWARD_KINDS)[number] };
  person: PersonRef;
  track: XpTrack;
  cost: number;
  status: RedemptionStatus;
  note: string;
  createdAt: string;
  decidedAt: string | null;
}
