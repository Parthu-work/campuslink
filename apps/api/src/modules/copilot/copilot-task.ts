import { LOCALE_ENGLISH_NAMES, type Locale } from '@campuslink/shared';
import type { AiTask } from '../ai-tasks/ai-tasks.service.js';
import { contentWords } from '../study/ai/tokens.js';

/** What the model replies when the sources do not answer the question (then a refusal is shown). */
export const NOT_COVERED = 'NOT_COVERED';

export interface CopilotAnswerInput {
  question: string;
  language: Locale;
  sources: { title: string; text: string }[];
}

/** Citations in an answer that point at real sources (1…n). */
export function citedNumbers(text: string, sources: number): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= sources) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The demo answer (the built-in mock provider cannot write prose from sources): for each source,
 * its first sentence that shares a word with the question, cited; nothing shared → NOT_COVERED.
 */
export function demoAnswer(input: CopilotAnswerInput): string {
  const want = new Set(contentWords(input.question));
  const lines: string[] = [];
  input.sources.forEach((s, i) => {
    if (lines.length >= 3) return;
    const sentence = s.text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((x) => x.trim())
      .find((x) => x.length > 12 && contentWords(x).some((w) => want.has(w)));
    if (sentence) lines.push(`- ${sentence} [${i + 1}]`);
  });
  return lines.length ? lines.join('\n') : NOT_COVERED;
}

/**
 * The Career Copilot's answer (prompt 2, G11, E2): from the numbered sources only, every fact
 * cited, no predictions or promises, nothing invented; NOT_COVERED otherwise. Run through
 * `AiTasksService.stream` (budgets, the daily limit, the breaker, delimiting, usage).
 */
export const copilotAnswerTask: Omit<AiTask<CopilotAnswerInput, string>, 'output' | 'mock' | 'fallback'> & {
  mock: (i: CopilotAnswerInput) => string;
} = {
  id: 'copilot_answer',
  feature: 'copilot',
  tier: 'fast',
  maxTokens: 700,
  system: [
    'You are the Career Copilot of an Indian engineering college. You answer a student’s career question only from the numbered document sources: the college’s own placement records, interview write-ups by its seniors, roadmaps, campus drive announcements, alumni mentor cards and the student’s own facts.',
    'Rules:',
    `1. Use only the numbered <source kind="document"> blocks. If they do not answer the question, reply exactly: ${NOT_COVERED}`,
    '2. Cite the source number after each fact, like [1] or [2][3]. Cite only document numbers that exist; never cite the question.',
    '3. Never predict a salary, package, selection, admission or placement, and never promise an outcome. Past figures in the sources may be stated as past figures.',
    '4. Never invent companies, people, numbers, dates, cut-offs or interview questions.',
    '5. Be brief and practical: at most 150 words, simple markdown only (bold, lists). No links and no HTML.',
  ].join('\n'),
  buildUser: (i) => ({
    ask: `Answer the student's question (the last source, kind "member") from the document sources, in ${LOCALE_ENGLISH_NAMES[i.language]}.`,
    documents: i.sources.map((s) => ({ label: s.title, text: s.text })),
    member: [{ label: 'The student’s question', text: i.question }],
    documentsFirst: true,
  }),
  mock: demoAnswer,
};
