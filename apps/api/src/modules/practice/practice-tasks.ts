import { z } from 'zod';
import {
  CODE_LANGUAGES,
  PRACTICE_DRAFTS_MAX,
  PRACTICE_OPTIONS_MAX,
  itemProblem,
  type PracticeDifficulty,
  type PracticeTopic,
} from '@campuslink/shared';
import type { AiTask } from '../ai-tasks/ai-tasks.service.js';

/** Prompt 2, G4: drafting practice items, run only through `AiTasksService` (E1). Every draft waits for review. */

export interface DraftInput {
  topic: PracticeTopic;
  kind: 'mcq' | 'numeric' | 'output_prediction';
  difficulty: PracticeDifficulty;
  count: number;
  /** Items already in the bank for this topic (so drafts do not repeat them). */
  existing: string[];
}

const draft = z.strictObject({
  text: z.string().trim().min(10).max(2000),
  code: z.string().max(6000).default(''),
  codeLanguage: z.enum(CODE_LANGUAGES).nullable().default(null),
  options: z.array(z.string().trim().min(1).max(300)).max(PRACTICE_OPTIONS_MAX).default([]),
  answer: z.string().trim().max(2000),
  explanation: z.string().trim().min(10).max(2000),
});
export type Draft = z.output<typeof draft>;
export interface DraftOutput {
  items: Draft[];
}

const TOPIC_WORDS: Partial<Record<PracticeTopic, string>> = {
  profit_loss: 'profit and loss',
  time_work: 'time and work (including pipes and cisterns)',
  time_distance: 'time, speed and distance',
  interest: 'simple and compound interest',
  number_system: 'number system (divisibility, remainders, HCF and LCM)',
  permutations: 'permutations and combinations',
  coding_decoding: 'coding and decoding',
  arrangements: 'seating and ordering arrangements',
  sentence_order: 'sentence ordering (para jumbles)',
  reading: 'short reading comprehension',
  stacks_queues: 'stacks and queues',
  sorting_searching: 'sorting and searching',
  dynamic_programming: 'dynamic programming',
  complexity: 'time and space complexity',
  oop: 'object-oriented programming',
  dbms: 'databases and SQL',
};
export const topicWords = (t: PracticeTopic) => TOPIC_WORDS[t] ?? t.replace(/_/g, ' ');

const KIND_RULES = {
  mcq: 'Each item is a multiple-choice question with 4 options, exactly one right. "answer" is the index of the right option ("0" to "3"). Wrong options should be mistakes a student would really make.',
  numeric:
    'Each item has a single numeric answer. "answer" is the number only (digits, optional decimal point and minus sign), no units. "options" is [].',
  output_prediction:
    'Each item shows a short, complete program (at most 15 lines) in "code" with its "codeLanguage" (c, cpp, java, python or javascript) and asks what it prints. "answer" is the exact output. Use only well-defined behaviour: no undefined behaviour, randomness, input, or platform-specific sizes. "options" is [].',
} as const;

/**
 * Original placement-style practice items for one topic (fast tier). Drafts are checked against
 * the item rules here and land in the review queue; a reviewer approves, corrects or rejects them.
 */
export const draftTask: AiTask<DraftInput, DraftOutput> = {
  id: 'practice_draft',
  feature: 'practice',
  tier: 'fast',
  system: [
    'You write original practice questions for Indian college students preparing for campus placement aptitude and coding tests. Source 1 lists questions already in the bank: never repeat or rephrase them.',
    'Write fresh questions in clear, simple English. The numbers and names in a question are part of a made-up exercise, not facts. Never copy questions from any company\x27s paper, book or website, and never name a real company.',
    'Work out every answer step by step before writing it, and make sure the explanation shows that working in at most four short sentences.',
    'Return {"items":[{"text":"…","code":"…","codeLanguage":null|"c"|"cpp"|"java"|"python"|"javascript","options":["…"],"answer":"…","explanation":"…"}]}.',
  ].join('\n'),
  buildUser: (i) => ({
    ask: [`Write ${i.count} ${i.difficulty} questions on ${topicWords(i.topic)}.`, KIND_RULES[i.kind]].join(
      '\n',
    ),
    documents: [
      { label: 'Questions already in the bank', text: i.existing.slice(0, 30).join('\n') || '(none yet)' },
    ],
  }),
  output: z.strictObject({ items: z.array(draft).max(PRACTICE_DRAFTS_MAX) }),
  maxTokens: 1600,
  mock: (i) => ({
    items: Array.from({ length: i.count }, (_, n) =>
      i.kind === 'mcq'
        ? {
            text: `Practice draft ${n + 1} on ${topicWords(i.topic)}: what is ${n + 2} × 5?`,
            code: '',
            codeLanguage: null,
            options: [String((n + 2) * 5), String((n + 2) * 5 + 1), String((n + 2) * 4), String(n + 7)],
            answer: '0',
            explanation: `${n + 2} × 5 = ${(n + 2) * 5}. The other options are near misses.`,
          }
        : i.kind === 'numeric'
          ? {
              text: `Practice draft ${n + 1} on ${topicWords(i.topic)}: what is 15% of ${(n + 1) * 200}?`,
              code: '',
              codeLanguage: null,
              options: [],
              answer: String((n + 1) * 30),
              explanation: `15% is 0.15, and 0.15 × ${(n + 1) * 200} = ${(n + 1) * 30}.`,
            }
          : {
              text: 'What does this program print?',
              code: `print(${n + 2} * 3)`,
              codeLanguage: 'python',
              options: [],
              answer: String((n + 2) * 3),
              explanation: `The expression ${n + 2} * 3 is evaluated and printed: ${(n + 2) * 3}.`,
            },
    ),
  }),
};

/** Drafts the item rules accept (a draft with no right option, or a non-number answer, is dropped). */
export function usableDrafts(kind: DraftInput['kind'], items: Draft[]): Draft[] {
  return items.filter(
    (d) =>
      !itemProblem({
        kind,
        options: d.options,
        answer: d.answer,
        code: d.code,
        codeLanguage: d.codeLanguage,
        tests: [],
      }),
  );
}
