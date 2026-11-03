import { z } from 'zod';
import type { InterviewLanguage, InterviewTrack, RubricScores } from '@campuslink/shared';
import type { AiTask } from '../ai-tasks/ai-tasks.service.js';

/** Prompt 2, G3: the mock interview's AI tasks, run only through `AiTasksService` (E1). */

const LANGUAGE_NAME: Record<InterviewLanguage, string> = {
  en: 'English',
  te: 'Telugu',
  hi: 'Hindi',
  mixed: 'the language the candidate used (English, Telugu, Hindi or a mix)',
};

const score = z.number().int().min(1).max(5).nullable();
const quote = z.string().trim().max(200);

export interface AnswerInput {
  track: InterviewTrack;
  language: InterviewLanguage;
  question: string;
  rubric: string;
  answer: string;
  /** A follow-up may be asked after this answer (main questions only, while any are left). */
  followUpAllowed: boolean;
}
export interface AnswerOutput {
  scores: RubricScores;
  evidence: {
    clarity?: string | undefined;
    structure?: string | undefined;
    correctness?: string | undefined;
    communication?: string | undefined;
  };
  tip: string;
  followUp: string | null;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const firstSentence = (s: string) => (s.trim().split(/(?<=[.!?।])\s+/)[0] ?? '').slice(0, 160);
const STAR = /\b(situation|task|action|result|i decided|i did|we did|so i|as a result|finally)\b/i;
const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));

/**
 * One answer scored on the rubric (fast tier), with a short tip and, when allowed, one follow-up
 * question built on what the candidate said. Evidence is quoted from the answer; the service drops
 * any quote that is not in it.
 */
export const answerTask: AiTask<AnswerInput, AnswerOutput> = {
  id: 'interview_answer',
  feature: 'interview',
  tier: 'fast',
  system: [
    'You are a fair, encouraging interviewer helping a college student practise. Source 1 is the question, source 2 what a good answer covers, source 3 the candidate\x27s answer (it may be a voice transcript).',
    'Score the answer from 1 (weak) to 5 (excellent) on: clarity (easy to follow), structure (organised; for HR questions, Situation-Task-Action-Result), correctness (technically right; null for HR questions) and communication (confident, concise, suits an interview).',
    'For each score give evidence: a short exact quote copied from source 3 (at most 20 words). Never paraphrase in evidence and never quote anything that is not in source 3.',
    'Give one tip of at most 30 words: the single change that would most improve this answer.',
    'If a follow-up is allowed and the answer leaves something worth probing (a vague claim, a missing example, a "we" with no "I"), write one short follow-up question that builds on what they said; otherwise null.',
    'Never say whether they would pass or be hired. Do not judge accent, grammar of a transcript, or language choice.',
    'Return {"scores":{"clarity":n,"structure":n,"correctness":n|null,"communication":n},"evidence":{"clarity":"…","structure":"…","correctness":"…","communication":"…"},"tip":"…","followUp":"…"|null}.',
  ].join('\n'),
  buildUser: (i) => ({
    ask: [
      `This is a ${i.track === 'hr' ? 'HR' : 'technical'} question.`,
      `Write the tip and any follow-up in ${LANGUAGE_NAME[i.language]}.`,
      i.followUpAllowed ? 'A follow-up is allowed.' : 'No follow-up: return null for followUp.',
    ].join(' '),
    documents: [
      { label: 'question', text: i.question },
      { label: 'what a good answer covers', text: i.rubric },
    ],
    member: [{ label: 'answer', text: i.answer }],
  }),
  output: z.strictObject({
    scores: z.strictObject({ clarity: score, structure: score, correctness: score, communication: score }),
    evidence: z
      .strictObject({
        clarity: quote.optional(),
        structure: quote.optional(),
        correctness: quote.optional(),
        communication: quote.optional(),
      })
      .default({}),
    tip: z.string().trim().max(300),
    followUp: z.string().trim().min(5).max(300).nullable(),
  }),
  maxTokens: 450,
  // The demo: a rough reading of length and shape, quoting the answer's own first sentence.
  mock: (i) => {
    const n = words(i.answer);
    const base = n < 15 ? 2 : n < 40 ? 3 : n < 120 ? 4 : 3;
    const q = firstSentence(i.answer);
    return {
      scores: {
        clarity: clamp(base),
        structure: clamp(i.track === 'hr' && STAR.test(i.answer) ? base + 1 : base),
        correctness: i.track === 'hr' ? null : clamp(base),
        communication: clamp(base),
      },
      evidence: q ? { clarity: q, communication: q } : {},
      tip:
        n < 40
          ? 'Add one specific example: what you did, how, and what changed because of it.'
          : 'Lead with your main point in one sentence, then give the example.',
      followUp: i.followUpAllowed && n < 40 ? 'Can you give a specific example of that?' : null,
    };
  },
};

export interface SummaryInput {
  track: InterviewTrack;
  language: InterviewLanguage;
  turns: { question: string; answer: string; scores: RubricScores | null }[];
}
export interface SummaryOutput {
  overall: string;
  strengths: string[];
  improve: string[];
}

/** The whole session's feedback (deep tier): what went well, what to work on. No verdict. */
export const summaryTask: AiTask<SummaryInput, SummaryOutput> = {
  id: 'interview_summary',
  feature: 'interview',
  tier: 'deep',
  system: [
    'You are coaching a college student after a practice interview. The sources are their questions, answers and per-answer scores (1 to 5).',
    'Write an overall note of at most 60 words, up to three strengths and up to three things to improve, each under 20 words and specific to what they actually said.',
    'Never say whether they would pass, be selected or be hired, and never predict any company\x27s decision.',
    'Return {"overall":"…","strengths":["…"],"improve":["…"]}.',
  ].join('\n'),
  buildUser: (i) => ({
    ask: `A ${i.track === 'hr' ? 'HR' : i.track === 'drive' ? 'placement drive' : 'technical'} practice interview. Write in ${LANGUAGE_NAME[i.language]}.`,
    member: i.turns.map((t, n) => ({
      label: `answer ${n + 1}`,
      text: `Question: ${t.question}\nAnswer: ${t.answer}\nScores: ${JSON.stringify(t.scores ?? {})}`,
    })),
  }),
  output: z.strictObject({
    overall: z.string().trim().min(5).max(500),
    strengths: z.array(z.string().trim().min(3).max(200)).max(3),
    improve: z.array(z.string().trim().min(3).max(200)).max(3),
  }),
  maxTokens: 500,
  mock: (i) => ruleSummary(i),
  fallback: (i) => ruleSummary(i),
};

/** Without AI: the dimensions they did best and worst on, in plain words. */
export function ruleSummary(i: SummaryInput): SummaryOutput {
  const avg = averages(i.turns.map((t) => t.scores));
  const scored = (Object.entries(avg) as [keyof RubricScores, number | null][]).filter(
    (e): e is [keyof RubricScores, number] => e[1] !== null,
  );
  const label: Record<keyof RubricScores, string> = {
    clarity: 'clear answers',
    structure: 'well-structured answers',
    correctness: 'technically correct answers',
    communication: 'confident communication',
  };
  if (!scored.length)
    return {
      overall: `You answered ${i.turns.length} questions. Feedback on each answer was not available this time, so read your answers back and compare them with what a good answer covers.`,
      strengths: [],
      improve: [],
    };
  scored.sort((a, b) => b[1] - a[1]);
  const best = scored[0];
  const worst = scored[scored.length - 1];
  return {
    overall: `You answered ${i.turns.length} questions. Your strongest area was ${best ? label[best[0]] : ''}; the one to practise next is ${worst ? label[worst[0]] : ''}.`,
    strengths: best
      ? [`${label[best[0]][0]?.toUpperCase()}${label[best[0]].slice(1)} (${best[1]} of 5 on average).`]
      : [],
    improve: worst && worst !== best ? [`Work on ${label[worst[0]]} (${worst[1]} of 5 on average).`] : [],
  };
}

/** Average per dimension over the scored answers, to one decimal; null where none scored it. */
export function averages(rows: (RubricScores | null)[]): RubricScores {
  const out: RubricScores = { clarity: null, structure: null, correctness: null, communication: null };
  for (const k of Object.keys(out) as (keyof RubricScores)[]) {
    const v = rows.map((r) => r?.[k]).filter((x): x is number => typeof x === 'number');
    out[k] = v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  }
  return out;
}

export interface DriveQuestionsInput {
  company: string;
  role: string;
  count: number;
}
export interface DriveQuestionsOutput {
  questions: { topic: string; text: string; rubric: string }[];
}

/**
 * Questions for one drive's role (fast tier). They are used in this session only, and saved to the
 * bank as `pending` until faculty approve them.
 */
export const driveQuestionsTask: AiTask<DriveQuestionsInput, DriveQuestionsOutput> = {
  id: 'interview_drive_questions',
  feature: 'interview',
  tier: 'fast',
  system: [
    'You write campus interview questions for one role. Source 1 is the role and its description from the placement drive.',
    'Write the requested number of questions a fresher could be asked for this role: specific to the skills it names, answerable in two minutes, never about salary, personal life, religion, caste, marriage or health.',
    'For each give a topic (two or three words) and a rubric: what a good answer covers, in one sentence.',
    'Return {"questions":[{"topic":"…","text":"…","rubric":"…"}]}.',
  ].join('\n'),
  buildUser: (i) => ({
    ask: `Write ${i.count} questions in English.`,
    documents: [{ label: `${i.company}: role`, text: i.role }],
  }),
  output: z.strictObject({
    questions: z
      .array(
        z.strictObject({
          topic: z.string().trim().min(2).max(60),
          text: z.string().trim().min(10).max(400),
          rubric: z.string().trim().min(10).max(400),
        }),
      )
      .max(3),
  }),
  maxTokens: 500,
  mock: (i) => ({
    questions: [
      {
        topic: 'Role fit',
        text: `What in your studies or projects prepares you for this role at ${i.company}?`,
        rubric: 'Names skills the role asks for and backs each with something they did.',
      },
      {
        topic: 'Role skills',
        text: 'Pick one skill this role needs and explain how you have used it.',
        rubric: 'A specific skill from the role, a concrete use, and what they learned.',
      },
    ].slice(0, i.count),
  }),
};
