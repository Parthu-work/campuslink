import { z } from 'zod';
import { objectId } from './common.js';
import type { Count } from './analytics.js';
import type { Branch } from '../constants/people.js';
import { ROUND_KINDS, type CtcBand, type RoundKind } from '../constants/placements.js';
import {
  EXPERIENCE_DIFFICULTIES,
  EXPERIENCE_QUESTIONS_MAX,
  EXPERIENCE_RESULTS,
  EXPERIENCE_ROUNDS_MAX,
  type ExperienceBasis,
  type ExperienceDifficulty,
  type ExperienceResult,
  type ExperienceStatus,
} from '../constants/graph.js';

/**
 * The moat data (prompt 2, G10). Company pages show only aggregates from verified records, every
 * count through `suppress()`; write-ups come from college-verified authors and are reviewed before
 * anyone else reads them.
 */

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

// ── The Placement Graph ─────────────────────────────

export const companiesQuery = z.strictObject({
  q: z.string().trim().max(80).optional(),
});
/** A company key (lib/company.ts: lowercase words), in the path. */
export const companyKeyParams = z.strictObject({ key: text(1, 120) });

export interface CompanyListItem {
  key: string;
  name: string;
  /** Verified offers over every batch on record. */
  offers: Count;
  /** Batches that received at least one verified offer, newest first. */
  batches: number[];
  /** Verified alumni who work there and show their company to members. */
  alumni: Count;
  /** Of those, the ones taking mentoring requests. */
  mentors: Count;
  /** Published write-ups in the Interview Experience Bank. */
  experiences: number;
}
export interface CompaniesView {
  items: CompanyListItem[];
  /** When the graph was last built for the college (null before the first run). */
  computedAt: string | null;
}

export interface CompanyGraphView {
  key: string;
  name: string;
  computedAt: string | null;
  offers: Count;
  /** Per batch: verified offers and the median CTC band (only from five offers up). */
  batches: { gradYear: number; offers: Count; band: CtcBand | null }[];
  branches: { branch: Branch; offers: Count }[];
  /** The viewer's own branch, for "N seniors from your branch joined". */
  yourBranch: { branch: Branch; offers: Count } | null;
  /** Campus drives the company ran with results recorded. */
  drives: Count;
  /** Per round kind, in drive order: how many sat it and the share who cleared (from five up). */
  rounds: { kind: RoundKind; appeared: Count; passRate: number | null }[];
  alumni: Count;
  mentors: Count;
  /** Completed mentoring sessions with alumni who work there. */
  sessions: Count;
  /** Referrals by alumni there; `rate` is interviews or offers per reported outcome (from five up). */
  referrals: { referred: Count; converted: Count; rate: number | null };
  experiences: ExperienceView[];
}

// ── The Interview Experience Bank ─────────────────────────────

export const experienceRound = z.strictObject({
  kind: z.enum(ROUND_KINDS),
  name: text(0, 60).default(''),
  /** Questions in the author's own words. */
  questions: z.array(text(5, 400)).max(EXPERIENCE_QUESTIONS_MAX).default([]),
  notes: text(0, 1000).default(''),
});
export const experienceBody = z.strictObject({
  company: text(2, 120),
  role: text(2, 120),
  year: z.number().int().min(2000).max(2100),
  rounds: z.array(experienceRound).min(1).max(EXPERIENCE_ROUNDS_MAX),
  tips: text(0, 2000).default(''),
  difficulty: z.enum(EXPERIENCE_DIFFICULTIES),
  result: z.enum(EXPERIENCE_RESULTS),
  /** Show the author's first name; otherwise "A senior from <branch>, <batch>". */
  named: z.boolean().default(true),
});
export type ExperienceBody = z.output<typeof experienceBody>;
export const experienceIdParams = z.strictObject({ id: objectId });
export const experienceDecisionBody = z
  .strictObject({
    decision: z.enum(['approve', 'reject']),
    /** Shown to the author when a write-up is sent back. */
    reason: text(5, 300).optional(),
    /** Questions to send to the mock interview bank (they wait for faculty review there). */
    bank: z
      .array(z.strictObject({ round: z.number().int().min(0), question: z.number().int().min(0) }))
      .max(EXPERIENCE_ROUNDS_MAX * EXPERIENCE_QUESTIONS_MAX)
      .default([]),
  })
  .refine((b) => b.decision === 'approve' || !!b.reason, {
    message: 'Say why it is being sent back',
    path: ['reason'],
  });
/** A reviewer wrote a practice question from a write-up's question (G4). */
export const experienceSentBody = z.strictObject({
  round: z.number().int().min(0),
  question: z.number().int().min(0),
});
export const experiencesReviewQuery = z.strictObject({
  status: z.enum(['pending', 'published', 'rejected']).default('pending'),
});

export interface ExperienceQuestionView {
  text: string;
  /** Where a reviewer sent it: the mock interview bank or a practice question. */
  sent: 'bank' | 'practice' | null;
}
export interface ExperienceView {
  id: string;
  company: { key: string; name: string };
  role: string;
  year: number;
  rounds: { kind: RoundKind; name: string; questions: ExperienceQuestionView[]; notes: string }[];
  tips: string;
  difficulty: ExperienceDifficulty;
  result: ExperienceResult;
  /** The name only when the author chose to show it. */
  author: {
    name: string | null;
    branch: Branch | null;
    gradYear: number | null;
    basis: ExperienceBasis;
  };
  status: ExperienceStatus;
  /** Why it was sent back (the author and reviewers only). */
  reason: string | null;
  /** Removed by a moderator after publishing (the author sees why). */
  removed: boolean;
  mine: boolean;
  createdAt: string;
}
export interface MyExperiencesView {
  items: ExperienceView[];
  /** Companies the member may write about (a verified offer or a drive), for the form. */
  companies: { key: string; name: string }[];
  /** Alumni may write about any company they interviewed with. */
  anyCompany: boolean;
}
