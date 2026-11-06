import { z } from 'zod';
import { objectId } from './common.js';
import type { Count } from './analytics.js';

/**
 * Aptitude and coding practice (prompt 2, G4): ten items a day chosen by spaced repetition, tied to
 * the companies that recruit through the college. Items are written by faculty and alumni (AI
 * drafts wait for review). Coding is practised through output prediction and multiple choice; real
 * code runs only behind the platform's CodeRunner (self-hosted Judge0), when the owner turns it on.
 */
export const PRACTICE_KINDS = ['mcq', 'numeric', 'output_prediction', 'coding'] as const;
export type PracticeKind = (typeof PRACTICE_KINDS)[number];
export const PRACTICE_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type PracticeDifficulty = (typeof PRACTICE_DIFFICULTIES)[number];

/** Topics, grouped into the areas placement tests use. A closed list: each has a label in every language. */
export const PRACTICE_TOPIC_AREAS = {
  quant: [
    'percentages',
    'profit_loss',
    'ratio',
    'averages',
    'time_work',
    'time_distance',
    'interest',
    'number_system',
    'permutations',
    'probability',
  ],
  logical: ['series', 'coding_decoding', 'blood_relations', 'directions', 'syllogisms', 'arrangements'],
  verbal: ['grammar', 'vocabulary', 'reading', 'sentence_order'],
  dsa: [
    'arrays',
    'strings',
    'linked_lists',
    'stacks_queues',
    'trees',
    'graphs',
    'sorting_searching',
    'recursion',
    'dynamic_programming',
    'complexity',
  ],
  programming: ['c', 'java', 'python', 'oop', 'dbms'],
} as const;
export type PracticeArea = keyof typeof PRACTICE_TOPIC_AREAS;
export const PRACTICE_AREAS = Object.keys(PRACTICE_TOPIC_AREAS) as PracticeArea[];
export type PracticeTopic = (typeof PRACTICE_TOPIC_AREAS)[PracticeArea][number];
export const PRACTICE_TOPICS = Object.values(PRACTICE_TOPIC_AREAS).flat() as PracticeTopic[];
export const areaOfTopic = (t: PracticeTopic): PracticeArea =>
  PRACTICE_AREAS.find((a) => (PRACTICE_TOPIC_AREAS[a] as readonly string[]).includes(t)) ?? 'quant';

/** `starter`: the original set shipped with the app (never copied from question dumps). */
export const PRACTICE_SOURCES = ['starter', 'faculty', 'alumni', 'ai_generated'] as const;
export type PracticeSource = (typeof PRACTICE_SOURCES)[number];
/** Alumni-written and AI-drafted items wait for a faculty decision; faculty items go straight in. */
export const PRACTICE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type PracticeStatus = (typeof PRACTICE_STATUSES)[number];
/** Languages a coding item can be answered in (Judge0 language ids live in the API's runner). */
export const CODE_LANGUAGES = ['c', 'cpp', 'java', 'python', 'javascript'] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export const PRACTICE_SET_SIZE = 10;
/** At most this many items in a set are reviews of earlier mistakes; the rest are new. */
export const PRACTICE_REVIEWS_MAX = 6;
/** Company prep sets a member can start per day (they earn no XP; the daily set does). */
export const PRACTICE_COMPANY_SETS_PER_DAY = 5;
export const PRACTICE_OPTIONS_MAX = 6;
export const PRACTICE_TESTS_MAX = 5;
export const PRACTICE_CODE_MAX = 6000;
/** Topic accuracy below this (with enough attempts) makes the topic come back more often. */
export const PRACTICE_WEAK_BELOW = 0.6;
export const PRACTICE_MIN_ATTEMPTS = 3;
/** Days of answers that topic mastery is measured over. */
export const PRACTICE_MASTERY_DAYS = 90;
/** AI drafts per request (each needs review). */
export const PRACTICE_DRAFTS_MAX = 5;

// ── Spaced repetition (Leitner boxes) ─────────────────────────────

/** Days until an item comes back, by box: a mistake returns tomorrow, each right answer waits longer. */
export const LEITNER_INTERVALS = [1, 3, 7, 16, 35] as const;
export const LEITNER_TOP = LEITNER_INTERVALS.length - 1;

/** Adds days to a YYYY-MM-DD calendar day. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The next box and due day after an answer: wrong → box 0 (tomorrow); right → one box up. */
export function nextCard(
  prevBox: number | null,
  correct: boolean,
  today: string,
): { box: number; due: string } {
  const box = correct ? Math.min(prevBox === null ? 1 : prevBox + 1, LEITNER_TOP) : 0;
  return { box, due: addDays(today, LEITNER_INTERVALS[box] ?? 1) };
}

export interface PlanItem {
  id: string;
  topic: PracticeTopic;
}
export interface PlanInput {
  /** Items the member has seen and is due to see again (due ≤ today), oldest due first. */
  due: readonly PlanItem[];
  /** Items the member has never seen (already filtered to what they can answer). */
  fresh: readonly PlanItem[];
  /** Seen items not yet due, soonest first: used only when the bank runs out of new items. */
  later: readonly PlanItem[];
  /** Topics the member gets wrong (accuracy below PRACTICE_WEAK_BELOW). */
  weak: ReadonlySet<string>;
  size?: number;
  reviewsMax?: number;
  /** Shuffles a list (injected so tests are deterministic). */
  shuffle?: <T>(xs: readonly T[]) => T[];
}

/** Takes items round-robin across topics so a set is not ten of the same kind. */
function spread(items: readonly PlanItem[], n: number): PlanItem[] {
  const byTopic = new Map<string, PlanItem[]>();
  for (const i of items) byTopic.set(i.topic, [...(byTopic.get(i.topic) ?? []), i]);
  const queues = [...byTopic.values()];
  const out: PlanItem[] = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && out.length < n) out.push(next);
    }
  }
  return out;
}

/**
 * Today's set: earlier mistakes that are due first (up to `reviewsMax`), then new items, half of
 * them from weak topics when there are any, spread across topics; seen items that are not yet due
 * fill whatever is left when the bank has too few new ones.
 */
export function planSet(input: PlanInput): string[] {
  const size = input.size ?? PRACTICE_SET_SIZE;
  const shuffle = input.shuffle ?? (<T>(xs: readonly T[]) => [...xs]);
  const chosen: PlanItem[] = input.due.slice(0, Math.min(input.reviewsMax ?? PRACTICE_REVIEWS_MAX, size));
  const taken = new Set(chosen.map((i) => i.id));
  const fresh = shuffle(input.fresh).filter((i) => !taken.has(i.id));
  const weakFresh = fresh.filter((i) => input.weak.has(i.topic));
  for (const i of spread(weakFresh, Math.ceil((size - chosen.length) / 2))) {
    chosen.push(i);
    taken.add(i.id);
  }
  for (const i of spread(
    fresh.filter((f) => !taken.has(f.id)),
    size - chosen.length,
  )) {
    chosen.push(i);
    taken.add(i.id);
  }
  for (const i of [...input.due, ...input.later]) {
    if (chosen.length >= size) break;
    if (!taken.has(i.id)) {
      chosen.push(i);
      taken.add(i.id);
    }
  }
  return chosen.map((i) => i.id);
}

// ── Answer checking ─────────────────────────────

/** A number as people type it: "1,200", "-2.5", "3/4", "1 1/2", "45%" (the % is ignored). */
export function parseNumber(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/[,\s]+(?=\d{3}\b)/g, '')
    .replace(/%$/, '')
    .trim();
  const mixed = /^(-?\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) {
    const [w, n, d] = [Number(mixed[1]), Number(mixed[2]), Number(mixed[3])];
    return d ? Math.sign(w || 1) * (Math.abs(w) + n / d) : null;
  }
  const frac = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return Number(s);
}

/** Program output compared the way judges do: line endings, trailing spaces and blank edges ignored. */
export function normaliseOutput(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** Whether an answer to a non-coding item is right (coding items are checked by the CodeRunner). */
export function checkAnswer(
  item: { kind: PracticeKind; answer: string; tolerance?: number | null },
  given: string,
): boolean {
  switch (item.kind) {
    case 'mcq':
      return given.trim() !== '' && given.trim() === item.answer.trim();
    case 'numeric': {
      const g = parseNumber(given);
      const a = parseNumber(item.answer);
      if (g === null || a === null) return false;
      // A little slack for floating point: 33.34 − 33.33 is a hair over 0.01.
      const tol = (item.tolerance ?? 0) + 1e-9 * Math.max(1, Math.abs(a));
      return Math.abs(g - a) <= tol;
    }
    case 'output_prediction':
      return given.trim() !== '' && normaliseOutput(given) === normaliseOutput(item.answer);
    case 'coding':
      return false;
  }
}

// ── Bodies ─────────────────────────────

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const companyName = z.string().trim().min(2).max(80);

const itemFields = {
  kind: z.enum(PRACTICE_KINDS),
  topic: z.enum(PRACTICE_TOPICS as [PracticeTopic, ...PracticeTopic[]]),
  difficulty: z.enum(PRACTICE_DIFFICULTIES).default('medium'),
  /** Companies this item prepares for (names as the college writes them). */
  companies: z.array(companyName).max(10).default([]),
  text: text(10, 2000),
  /** A code snippet shown with the question (output prediction, code-reading MCQs). */
  code: z.string().max(PRACTICE_CODE_MAX).default(''),
  codeLanguage: z.enum(CODE_LANGUAGES).nullable().default(null),
  options: z.array(text(1, 300)).max(PRACTICE_OPTIONS_MAX).default([]),
  /** mcq: the right option's index ("0".."5"); numeric: the value; output: the exact output. Coding: unused. */
  answer: z.string().max(2000).default(''),
  /** numeric: how far off an answer may be and still count (absolute). */
  tolerance: z.number().min(0).max(1_000_000).nullable().default(null),
  explanation: text(10, 2000),
  /** coding: hidden tests the CodeRunner checks (stdin → expected output). */
  tests: z
    .array(z.strictObject({ stdin: z.string().max(2000).default(''), expected: z.string().min(1).max(2000) }))
    .max(PRACTICE_TESTS_MAX)
    .default([]),
};

type ItemShape = {
  kind: PracticeKind;
  options: string[];
  answer: string;
  code: string;
  codeLanguage: CodeLanguage | null;
  tests: { stdin: string; expected: string }[];
};
/** What each kind needs; returns the first problem (path and message) or null. */
export function itemProblem(b: ItemShape): { path: string; message: string } | null {
  if (b.kind === 'mcq') {
    if (b.options.length < 2) return { path: 'options', message: 'Give at least two options' };
    const i = Number(b.answer);
    if (!/^\d$/.test(b.answer) || i >= b.options.length)
      return { path: 'answer', message: 'Pick which option is right' };
    if (new Set(b.options.map((o) => o.toLowerCase())).size !== b.options.length)
      return { path: 'options', message: 'Two options are the same' };
  }
  if (b.kind === 'numeric' && parseNumber(b.answer) === null)
    return { path: 'answer', message: 'The answer must be a number' };
  if (b.kind === 'output_prediction') {
    if (!b.code.trim()) return { path: 'code', message: 'Add the code whose output is asked for' };
    if (!b.answer.trim()) return { path: 'answer', message: 'Give the exact output' };
  }
  if ((b.kind === 'output_prediction' || b.kind === 'coding') && !b.codeLanguage)
    return { path: 'codeLanguage', message: 'Choose the programming language' };
  if (b.kind === 'coding' && !b.tests.length)
    return { path: 'tests', message: 'Add at least one test (input and expected output)' };
  return null;
}

const refineItem = <T extends ItemShape>(b: T, ctx: z.RefinementCtx) => {
  const p = itemProblem(b);
  if (p) ctx.addIssue({ code: 'custom', message: p.message, path: [p.path] });
};

export const practiceItemBody = z.strictObject(itemFields).superRefine(refineItem);
export const practiceItemIdParams = z.strictObject({ id: objectId });
export const practiceItemsQuery = z.strictObject({
  status: z.enum(PRACTICE_STATUSES).default('pending'),
  topic: z.enum(PRACTICE_TOPICS as [PracticeTopic, ...PracticeTopic[]]).optional(),
});
export const practiceDecisionBody = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  /** The reviewer's corrected version (approve only). */
  edit: z.strictObject(itemFields).superRefine(refineItem).optional(),
});
export const practiceDraftBody = z.strictObject({
  topic: z.enum(PRACTICE_TOPICS as [PracticeTopic, ...PracticeTopic[]]),
  kind: z.enum(['mcq', 'numeric', 'output_prediction']),
  difficulty: z.enum(PRACTICE_DIFFICULTIES).default('medium'),
  count: z.number().int().min(1).max(PRACTICE_DRAFTS_MAX).default(3),
  companies: z.array(companyName).max(10).default([]),
});
export const practiceStartBody = z.strictObject({
  /** A company's comparable key: a "Preparing for <company>" set instead of today's set. */
  company: z.string().trim().min(1).max(120).optional(),
});
export const practiceSetIdParams = z.strictObject({ id: objectId });
export const practiceAnswerBody = z.strictObject({
  index: z
    .number()
    .int()
    .min(0)
    .max(PRACTICE_SET_SIZE - 1),
  /** Empty means "show me the answer" (counted as a miss, so the item comes back). */
  answer: z.string().max(PRACTICE_CODE_MAX).default(''),
  codeLanguage: z.enum(CODE_LANGUAGES).optional(),
});
export const practiceMasteryQuery = z.strictObject({
  gradYear: z.coerce.number().int().min(1990).max(2100).optional(),
});

// ── Views ─────────────────────────────

/** An item while it is being answered: no answer, no explanation, no tests. */
export interface PracticeItemPublic {
  id: string;
  kind: PracticeKind;
  topic: PracticeTopic;
  difficulty: PracticeDifficulty;
  text: string;
  code: string;
  codeLanguage: CodeLanguage | null;
  options: string[];
  companies: string[];
}
export type CodeRunStatus = 'passed' | 'failed' | 'compile_error' | 'runtime_error' | 'timeout' | 'error';
export interface PracticeResult {
  given: string;
  correct: boolean;
  /** The right answer as shown (the option's text, the value, the output; none for coding). */
  answer: string;
  explanation: string;
  run: { status: CodeRunStatus; passed: number; total: number; message: string } | null;
  at: string;
}
export interface PracticeSetItemView {
  index: number;
  item: PracticeItemPublic;
  result: PracticeResult | null;
}
export interface PracticeSetView {
  id: string;
  kind: 'daily' | 'company';
  company: { key: string; name: string } | null;
  day: string;
  items: PracticeSetItemView[];
  answered: number;
  correct: number;
  completedAt: string | null;
}
export interface PracticeTopicStat {
  topic: PracticeTopic;
  area: PracticeArea;
  attempts: number;
  /** Share right, 0 to 1 (null below PRACTICE_MIN_ATTEMPTS). */
  accuracy: number | null;
  weak: boolean;
}
export interface PracticeCompanyView {
  key: string;
  name: string;
  items: number;
  /** The next open drive's closing date, when there is one. */
  nextDriveCloses: string | null;
}
export interface PracticeHomeView {
  today: { setId: string | null; answered: number; size: number; completed: boolean };
  streak: number;
  /** Days with a finished daily set, last 30 (for the streak strip). */
  days: string[];
  topics: PracticeTopicStat[];
  companies: PracticeCompanyView[];
  companySetsLeft: number;
  /** Real code runs (self-hosted Judge0) are on for this platform. */
  runner: boolean;
  /** Items this member wrote that are waiting for review. */
  mineWaiting: number;
}
export interface PracticeItemView extends PracticeItemPublic {
  answer: string;
  tolerance: number | null;
  explanation: string;
  tests: { stdin: string; expected: string }[];
  source: PracticeSource;
  status: PracticeStatus;
  createdBy: { id: string; name: string } | null;
  reviewedBy: { id: string; name: string } | null;
  createdAt: string;
}
export interface PracticeMasteryView {
  since: string;
  batches: {
    gradYear: number | null;
    students: Count;
    topics: { topic: PracticeTopic; area: PracticeArea; students: Count; accuracy: number | null }[];
  }[];
}
