import { z } from 'zod';
import { BRANCHES, type Branch } from '../constants/people.js';
import {
  READINESS_CLOSING_DAYS_MAX,
  READINESS_COMPONENTS,
  READINESS_NUDGE_BATCH_MAX,
  READINESS_WEIGHT_MAX,
  type ReadinessActionId,
  type ReadinessComponentId,
  type ReadinessWeights,
} from '../constants/readiness.js';
import { objectId } from './common.js';
import type { Count, Kpi } from './analytics.js';

// ── Bodies ─────────────────────────────

const weight = z.number().int().min(0).max(READINESS_WEIGHT_MAX);
export const readinessWeightsBody = z.strictObject(
  Object.fromEntries(READINESS_COMPONENTS.map((c) => [c, weight])) as Record<
    ReadinessComponentId,
    typeof weight
  >,
);

export const readinessConfigBody = z
  .strictObject({
    weights: readinessWeightsBody,
    threshold: z.number().int().min(1).max(100),
    closingDays: z.number().int().min(1).max(READINESS_CLOSING_DAYS_MAX),
  })
  .refine((b) => Object.values(b.weights).some((w) => w > 0), {
    message: 'At least one component needs a weight',
    path: ['weights'],
  });

export const readinessBoardQuery = z.strictObject({
  branch: z.enum(BRANCHES).optional(),
  gradYear: z.coerce.number().int().min(1950).max(2100).optional(),
});

export const readinessNudgeBody = z.strictObject({
  userIds: z.array(objectId).min(1).max(READINESS_NUDGE_BATCH_MAX),
});

export const readinessExportQuery = readinessBoardQuery
  .extend({ format: z.enum(['csv', 'xlsx']).default('csv') })
  .strict();

// ── Views ─────────────────────────────

/** A suggested next step and the points it adds (null when the gain cannot be known in advance). */
export interface ReadinessAction {
  component: ReadinessComponentId;
  id: ReadinessActionId;
  gain: number | null;
  /** How many (issues, steps, keywords, sessions, backlogs), when the words need it. */
  count?: number;
  /** A CGPA to reach, or a rubric dimension to work on. */
  target?: string;
}

/**
 * `scored`: counted. `off`: the college gave it no weight. `not_applicable`: nothing to measure yet
 * for this member (no drives with cut-offs). `not_available`: the feature behind it is not part of
 * this build yet. Only `scored` components count; the others' weight is spread over the rest.
 */
export type ReadinessComponentStatus = 'scored' | 'off' | 'not_applicable' | 'not_available';

export interface ReadinessComponentView {
  id: ReadinessComponentId;
  status: ReadinessComponentStatus;
  /** The college's weight (out of the sum of weights). */
  weight: number;
  /** Points earned and the most this component can earn now (they sum to the score and to 100). */
  points: number;
  max: number;
  /** The facts behind the points, as counts and numbers only (the web words them). */
  facts: Record<string, number | string | null>;
  next: ReadinessAction | null;
}

/** The change since the score the student last saw at least a week ago (prompt 3, U7). */
export interface ReadinessMomentum {
  /** Points gained (or lost) since then. */
  delta: number;
  /** The day of that earlier score (YYYY-MM-DD, UTC). */
  since: string;
}

export interface ReadinessView {
  score: number;
  components: ReadinessComponentView[];
  /** The best next steps, biggest gain first (at most three). */
  next: ReadinessAction[];
  /** Some components were skipped and the rest scaled up to 100. */
  renormalised: boolean;
  computedAt: string;
  /** The student's own view only: null until there is a score from a week ago. */
  momentum?: ReadinessMomentum | null;
}

export interface ReadinessConfigView {
  weights: ReadinessWeights;
  threshold: number;
  closingDays: number;
  /** Components this build can score (the others' weight is spread over the rest). */
  available: ReadinessComponentId[];
  updatedAt: string | null;
}

export interface ReadinessGroupView {
  gradYear: number | null;
  branch: Branch | null;
  students: Count;
  /** Students per band (0–19, 20–39, 40–59, 60–79, 80–100), each through suppress(). */
  bands: Count[];
  /** Only for groups of five or more. */
  median: number | null;
}

export interface NeedsHelpRow {
  userId: string;
  name: string;
  branch: Branch | null;
  gradYear: number | null;
  score: number;
  drive: { id: string; company: string; closesAt: string };
  /** The component with the most points still to earn, and its next step. */
  next: ReadinessAction | null;
  lastNudgedAt: string | null;
  /** False while the nudge cool-off runs. */
  nudgeable: boolean;
}

export interface ReadinessBoardView {
  threshold: number;
  closingDays: number;
  students: Count;
  /** Average points per component across the students shown (null under five students). */
  components: {
    id: ReadinessComponentId;
    status: 'scored' | 'off' | 'not_available';
    average: number | null;
  }[];
  groups: ReadinessGroupView[];
  /** Below the threshold with a drive closing soon; minors are never listed (they are not ranked). */
  needsHelp: NeedsHelpRow[];
  computedAt: string;
  /**
   * The four headline numbers (prompt 3, U9c), each against the board's own totals a week ago
   * (null when the board is not yet a week old): students, ready (at or above the threshold),
   * the median score, and students needing help.
   */
  kpis: {
    students: Kpi;
    ready: Kpi;
    median: { value: number | null; previous: number | null };
    needsHelp: { value: number; previous: number | null };
  };
}

export interface ReadinessNudgeResult {
  sent: number;
  /** Nudged in the last READINESS_NUDGE_COOLDOWN_DAYS days. */
  coolingOff: number;
  /** Not on the "needs help" list now (score up, drive closed, not a student, a minor). */
  notListed: number;
}
