import { z } from 'zod';
import { objectId } from './common.js';
import { BRANCHES, type Branch } from '../constants/people.js';
import { AI_FEATURE_LIMITS } from '../constants/study.js';

/**
 * AI mock interviews (prompt 2, G3): practice with questions from a curated bank, feedback on a
 * rubric with evidence quoted from the member's own answer, then a human mock with an alumnus.
 * No pass or fail, and nothing about hiring outcomes.
 */
export const INTERVIEW_TRACKS = ['hr', 'technical', 'drive'] as const;
export type InterviewTrack = (typeof INTERVIEW_TRACKS)[number];
export const INTERVIEW_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type InterviewDifficulty = (typeof INTERVIEW_DIFFICULTIES)[number];
/** `mixed`: the member answers in any mix of English, Telugu and Hindi. */
export const INTERVIEW_LANGUAGES = ['en', 'te', 'hi', 'mixed'] as const;
export type InterviewLanguage = (typeof INTERVIEW_LANGUAGES)[number];
export const INTERVIEW_MODES = ['text', 'voice'] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

export const INTERVIEW_QUESTIONS_MIN = 5;
export const INTERVIEW_QUESTIONS_MAX = 8;
/** Follow-ups per session (one per question at most), generated from the answer. */
export const INTERVIEW_FOLLOW_UPS_MAX = 3;
/**
 * AI calls one session can make at most: one per answer (questions and follow-ups), the summary,
 * and generating role questions for a drive. Sessions per day follow from the feature's limit.
 */
export const INTERVIEW_CALLS_PER_SESSION = INTERVIEW_QUESTIONS_MAX + INTERVIEW_FOLLOW_UPS_MAX + 2;
export const INTERVIEW_SESSIONS_PER_DAY = Math.max(
  1,
  Math.floor((AI_FEATURE_LIMITS.interview ?? 60) / INTERVIEW_CALLS_PER_SESSION),
);
/** A recorded answer: Opus in WebM or Ogg, mono, low bitrate; three minutes is about 1 MB. */
export const INTERVIEW_AUDIO_MAX_BYTES = 4 * 1024 * 1024;
export const INTERVIEW_ANSWER_MAX = 4000;

/** Who wrote a bank question. `starter` is the built-in set shipped with the app. */
export const INTERVIEW_QUESTION_SOURCES = [
  'starter',
  'faculty',
  'alumni',
  'interview_bank',
  'ai_generated',
] as const;
export type InterviewQuestionSource = (typeof INTERVIEW_QUESTION_SOURCES)[number];
/** AI-generated questions wait for a faculty decision before they enter the bank. */
export const INTERVIEW_QUESTION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type InterviewQuestionStatus = (typeof INTERVIEW_QUESTION_STATUSES)[number];

/** The rubric: each 1 to 5, or null where it does not apply (structure is HR's, correctness technical). */
export const RUBRIC_DIMENSIONS = ['clarity', 'structure', 'correctness', 'communication'] as const;
export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

export const interviewCreateBody = z
  .strictObject({
    track: z.enum(INTERVIEW_TRACKS),
    /** Technical questions for this branch (defaults to the member's own). */
    branch: z.enum(BRANCHES).optional(),
    driveId: objectId.optional(),
    difficulty: z.enum(INTERVIEW_DIFFICULTIES).default('medium'),
    language: z.enum(INTERVIEW_LANGUAGES).default('en'),
    mode: z.enum(INTERVIEW_MODES).default('text'),
    questions: z.number().int().min(INTERVIEW_QUESTIONS_MIN).max(INTERVIEW_QUESTIONS_MAX).default(6),
  })
  .refine((b) => (b.track === 'drive') === !!b.driveId, {
    message: 'A drive interview needs its drive, and only a drive interview takes one',
    path: ['driveId'],
  });
export const interviewIdParams = z.strictObject({ id: objectId });
export const interviewAnswerBody = z.strictObject({
  /** The turn being answered (guards against a double submit answering the next one). */
  turn: z
    .number()
    .int()
    .min(0)
    .max(INTERVIEW_QUESTIONS_MAX + INTERVIEW_FOLLOW_UPS_MAX),
  text: z.string().trim().min(1, 'Write an answer, or skip the question').max(INTERVIEW_ANSWER_MAX),
});
export const interviewSkipBody = z.strictObject({
  turn: z
    .number()
    .int()
    .min(0)
    .max(INTERVIEW_QUESTIONS_MAX + INTERVIEW_FOLLOW_UPS_MAX),
});

export const interviewQuestionBody = z.strictObject({
  track: z.enum(['hr', 'technical']),
  branch: z.enum(BRANCHES).nullable().default(null),
  difficulty: z.enum(INTERVIEW_DIFFICULTIES).default('medium'),
  topic: z.string().trim().min(2).max(60),
  text: z.string().trim().min(10).max(400),
  /** What a good answer covers, for the model and for the member's feedback. */
  rubric: z.string().trim().min(10).max(400),
});
export const interviewQuestionDecisionBody = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  /** Edits made while approving (an AI question often needs a word changed). */
  text: z.string().trim().min(10).max(400).optional(),
  rubric: z.string().trim().min(10).max(400).optional(),
});
export const interviewQuestionListQuery = z.strictObject({
  status: z.enum(INTERVIEW_QUESTION_STATUSES).default('pending'),
});

// ── Views ─────────────────────────────

export type RubricScores = Record<RubricDimension, number | null>;

export interface InterviewTurnView {
  index: number;
  kind: 'question' | 'follow_up';
  text: string;
  topic: string;
  /** What happened to it: waiting, a recording being transcribed, answered (scored or not), skipped. */
  status: 'open' | 'transcribing' | 'answered' | 'skipped' | 'voice_failed';
  answer: string | null;
  answeredBy: 'text' | 'voice' | null;
  scores: RubricScores | null;
  /** One short quote from the answer for each scored dimension, never invented. */
  evidence: Partial<Record<RubricDimension, string>>;
  tip: string | null;
}

export interface InterviewSummary {
  overall: string;
  strengths: string[];
  improve: string[];
  /** Average per dimension over scored answers. */
  averages: RubricScores;
  source: 'ai' | 'rules';
}

export interface InterviewView {
  id: string;
  track: InterviewTrack;
  branch: Branch | null;
  drive: { id: string; company: string; title: string } | null;
  difficulty: InterviewDifficulty;
  language: InterviewLanguage;
  mode: InterviewMode;
  status: 'in_progress' | 'completed' | 'abandoned';
  turns: InterviewTurnView[];
  /** The turn to answer now, or null when every turn is done. */
  current: number | null;
  /** Main questions planned (follow-ups are extra). */
  planned: number;
  summary: InterviewSummary | null;
  /** AI feedback was unavailable for some answers (limit, budget, provider): they show unscored. */
  unscored: number;
  createdAt: string;
  completedAt: string | null;
  /** The viewer's relation: the owner, or the alumnus they shared it with for a human mock. */
  mine: boolean;
  owner: { id: string; name: string };
}

export interface InterviewListItem {
  id: string;
  track: InterviewTrack;
  company: string | null;
  difficulty: InterviewDifficulty;
  status: InterviewView['status'];
  averages: RubricScores | null;
  createdAt: string;
}

export interface InterviewHistoryView {
  sessions: InterviewListItem[];
  /** Completed sessions, oldest first, per dimension: progress over time. */
  trend: { at: string; averages: RubricScores }[];
  today: { started: number; limit: number };
  /** Voice needs a transcription service; text always works. */
  voiceAvailable: boolean;
}

export interface InterviewQuestionView {
  id: string;
  track: 'hr' | 'technical';
  branch: Branch | null;
  difficulty: InterviewDifficulty;
  topic: string;
  text: string;
  rubric: string;
  source: InterviewQuestionSource;
  status: InterviewQuestionStatus;
  reviewedBy: { id: string; name: string } | null;
  createdAt: string;
}
