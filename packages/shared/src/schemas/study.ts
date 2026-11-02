import { z } from 'zod';
import { objectId } from './common.js';
import type { PersonRef } from './mentorship.js';
import type { Count } from './analytics.js';
import { BRANCHES, type Branch } from '../constants/people.js';
import {
  AI_CONSENT_VERSION,
  AI_KEY_TARGETS,
  AI_PROVIDERS,
  ANSWER_MODES,
  CHAT_DIFFICULTIES,
  CHAT_FEEDBACK_REASONS,
  CHAT_QUESTION_MAX,
  EMBEDDING_PROVIDERS,
  QUIZ_SIZE,
  SERVER_COMMANDS,
  SEMESTER_MAX,
  SEMESTER_MIN,
  MATERIAL_LANGUAGES,
  MATERIAL_TABS,
  PRICE_CURRENCIES,
  STUDY_PERIODS,
  SUBJECT_STATUSES,
  SYLLABUS_MAX_TOPICS,
  SYLLABUS_MAX_UNITS,
  type AiFeature,
  type AiKeyTarget,
  type AiProvider,
  type AiUsageKind,
  type AnswerMode,
  type ChatFeedbackReason,
  type EmbeddingProvider,
  type KeyStatus,
  type MaterialLanguage,
  type MaterialTab,
  type MaterialType,
  type MaterialVisibility,
  type PriceCurrency,
  type ProcessingStage,
  type ServerCommand,
  type SubjectStatus,
} from '../constants/study.js';

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const year = z.number().int().min(1950).max(2100);

// ── Subjects ─────────────────────────────
const subjectFields = {
  name: text(2, 120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9 .\-/]{0,19}$/, 'Letters, digits, spaces, dots, dashes and slashes (up to 20)'),
  /** Which branches take it; empty means every branch. */
  branches: z.array(z.enum(BRANCHES)).max(10).default([]),
  /** Which batches (graduation years) take it; empty means every batch. */
  batches: z.array(year).max(8).default([]),
  semester: z.number().int().min(SEMESTER_MIN).max(SEMESTER_MAX).nullable().default(null),
  regulation: text(0, 20).default(''),
  description: text(0, 2000).default(''),
  /** Faculty who own the subject (they manage its syllabus and material). */
  ownerIds: z.array(objectId).max(10).default([]),
};
export const subjectBody = z.strictObject(subjectFields);
export const subjectUpdateBody = z
  .strictObject({
    ...subjectFields,
    status: z.enum(SUBJECT_STATUSES),
  })
  .partial();
export const subjectsQuery = z.strictObject({
  scope: z.enum(['mine', 'all']).default('mine'),
  q: text(1, 80).optional(),
  status: z.enum(SUBJECT_STATUSES).default('active'),
});

// ── Syllabus ─────────────────────────────
const keyword = z.string().trim().min(1).max(40);
export const syllabusTopicInput = z.strictObject({
  /** Present for an existing topic (kept, so material tags survive edits). */
  id: objectId.optional(),
  title: text(1, 160),
  keywords: z.array(keyword).max(12).default([]),
});
export const syllabusUnitInput = z.strictObject({
  id: objectId.optional(),
  title: text(1, 160),
  topics: z.array(syllabusTopicInput).max(SYLLABUS_MAX_TOPICS).default([]),
});
/** The whole tree, in order. Units and topics left out are deleted. */
export const syllabusBody = z.strictObject({
  units: z.array(syllabusUnitInput).max(SYLLABUS_MAX_UNITS),
});
export type SyllabusInput = z.infer<typeof syllabusBody>;
/** Pasted syllabus text to turn into a suggested tree (the faculty reviews it before saving). */
export const syllabusParseBody = z.strictObject({ text: text(1, 20_000) });

// ── Who takes a subject ─────────────────────────────
/** An admin or owner override: include a student the rule misses, or exclude one it catches. */
export const enrollmentBody = z.strictObject({
  userId: objectId,
  kind: z.enum(['include', 'exclude']),
});
export const contributorBody = z.strictObject({ userId: objectId, grant: z.boolean() });

// ── Materials ─────────────────────────────
const idList = z
  .string()
  .max(25 * 25)
  .default('')
  .transform((v) => [
    ...new Set(
      v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ])
  .pipe(z.array(objectId).max(20));
/** Multipart fields that come with an uploaded file (all strings on the wire). */
export const materialUploadFields = z.strictObject({
  subjectId: objectId,
  title: text(0, 160).default(''),
  description: text(0, 2000).default(''),
  category: z.enum(MATERIAL_TABS).optional(),
  unitId: z.union([objectId, z.literal('')]).default(''),
  /** Comma-separated topic ids. */
  topicIds: idList,
  language: z.enum(MATERIAL_LANGUAGES).default('en'),
  /** "I have the right to share this" must be ticked. */
  rights: z.literal('true', { error: 'Confirm you have the right to share this' }),
});
const chapter = z.strictObject({
  at: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600),
  title: text(1, 120),
});
/** A video link (YouTube or Vimeo). Metadata comes from their official oEmbed; nothing is downloaded. */
export const materialLinkBody = z.strictObject({
  subjectId: objectId,
  url: z.url({ protocol: /^https$/, error: 'Use an https:// link' }).max(500),
  title: text(0, 160).default(''),
  description: text(0, 2000).default(''),
  category: z.enum(MATERIAL_TABS).default('videos'),
  unitId: objectId.nullable().default(null),
  topicIds: z.array(objectId).max(20).default([]),
  language: z.enum(MATERIAL_LANGUAGES).default('en'),
  chapters: z.array(chapter).max(100).default([]),
  rights: z.literal(true, { error: 'Confirm you have the right to share this' }),
});
export const materialUpdateBody = z
  .strictObject({
    title: text(1, 160),
    description: text(0, 2000),
    category: z.enum(MATERIAL_TABS),
    unitId: objectId.nullable(),
    topicIds: z.array(objectId).max(20),
    language: z.enum(MATERIAL_LANGUAGES),
    chapters: z.array(chapter).max(100),
  })
  .partial();
export const materialsQuery = z.strictObject({
  category: z.enum(MATERIAL_TABS).optional(),
  unitId: objectId.optional(),
  topicId: objectId.optional(),
  /** Managers only: drafts and material waiting for review. */
  status: z.enum(['published', 'in_review', 'all']).default('published'),
});
export const materialReviewBody = z.strictObject({
  action: z.enum(['publish', 'reject']),
  reason: text(0, 500).default(''),
});
export const takedownBody = z.strictObject({ reason: text(5, 500) });
export const studySearchQuery = z.strictObject({
  q: text(2, 100),
  /** Omitted: every subject the member reads. */
  subjectId: objectId.optional(),
  unitId: objectId.optional(),
  topicId: objectId.optional(),
});

// ── AI settings ─────────────────────────────
/** An OpenAI-compatible endpoint. Only public https is accepted unless the platform allowlists it. */
export const endpointUrl = z
  .url({ protocol: /^https?$/, error: 'Use an https:// address' })
  .max(500)
  .refine((u) => !/[?#]/.test(u), 'Leave out query strings and fragments');
const price = z.number().min(0).max(100_000).nullable();
/** Per million tokens, as the provider lists them; null until the admin enters one. */
export const aiPrices = z.strictObject({
  currency: z.enum(PRICE_CURRENCIES),
  chatInput: price,
  chatOutput: price,
  embedding: price,
});
export type AiPrices = z.infer<typeof aiPrices>;
export const aiSettingsBody = z.strictObject({
  /** null: not configured (members get keyword search and extractive answers). */
  chatProvider: z.enum(AI_PROVIDERS).nullable(),
  chatModel: text(0, 120),
  embeddingProvider: z.enum(EMBEDDING_PROVIDERS).nullable(),
  embeddingModel: text(0, 120),
  /** For `openai_compatible` chat. */
  baseUrl: endpointUrl.nullable().default(null),
  /** For `openai_compatible` embeddings (may be the same server). */
  embeddingBaseUrl: endpointUrl.nullable().default(null),
  /** null leaves the provider's default (Anthropic ignores it). */
  temperature: z.number().min(0).max(1).nullable().default(null),
  maxAnswerTokens: z.number().int().min(128).max(4096).default(1024),
  maxChunks: z.number().int().min(2).max(20).default(6),
  /** Tokens per calendar month for the college; 0 means no budget. */
  monthlyTokenBudget: z.number().int().min(0).max(1_000_000_000).default(0),
  dailyMessagesPerUser: z.number().int().min(1).max(500).default(40),
  /** Days a chat is kept; 0 keeps it until the student deletes it. */
  chatRetentionDays: z.number().int().min(0).max(3650).default(180),
  features: z.strictObject({
    chatbot: z.boolean(),
    studentUploads: z.boolean(),
    externalVideos: z.boolean(),
    ocr: z.boolean(),
    transcription: z.boolean(),
  }),
  /** Stops every AI call at once (keyword-only mode stays). */
  killSwitch: z.boolean().default(false),
  /**
   * The provider's prices as the admin read them on its pricing page, per million tokens, for the
   * dashboard's cost estimate. Never filled in by the app (prices change and differ by account).
   */
  prices: aiPrices.default({ currency: 'USD', chatInput: null, chatOutput: null, embedding: null }),
});
export type AiSettingsInput = z.infer<typeof aiSettingsBody>;
export const aiKeyBody = z.strictObject({
  target: z.enum(AI_KEY_TARGETS),
  key: z
    .string()
    .trim()
    .min(8, 'That key looks too short')
    .max(500)
    .regex(/^[\x21-\x7e]+$/, 'Keys have no spaces or special characters'),
});
export const aiKeyTargetParams = z.strictObject({ target: z.enum(AI_KEY_TARGETS) });
export const aiTestBody = z.strictObject({ target: z.enum(['chat', 'embedding']) });
export const aiConsentBody = z.strictObject({
  version: z.literal(AI_CONSENT_VERSION),
  accept: z.literal(true),
});

// ── Views ─────────────────────────────
export interface SubjectView {
  id: string;
  name: string;
  code: string;
  branches: Branch[];
  batches: number[];
  semester: number | null;
  regulation: string;
  description: string;
  status: SubjectStatus;
  owners: PersonRef[];
  contributorCount: number;
  unitCount: number;
  topicCount: number;
  materialCount: number;
  /** What this viewer may do (the API enforces it again). */
  can: { manage: boolean; upload: boolean; analyse: boolean };
  /** True when the subject is in the viewer's own list (enrolled, owner or contributor). */
  mine: boolean;
  updatedAt: string;
}
export interface SyllabusTopicView {
  id: string;
  title: string;
  keywords: string[];
}
export interface SyllabusUnitView {
  id: string;
  title: string;
  topics: SyllabusTopicView[];
}
export interface SyllabusView {
  subjectId: string;
  units: SyllabusUnitView[];
}
export interface EnrollmentView {
  user: PersonRef;
  kind: 'include' | 'exclude';
}
export interface MaterialView {
  id: string;
  subjectId: string;
  title: string;
  description: string;
  type: MaterialType;
  category: MaterialTab;
  language: MaterialLanguage;
  mime: string | null;
  size: number;
  pageCount: number | null;
  durationSec: number | null;
  unitId: string | null;
  topicIds: string[];
  visibility: MaterialVisibility;
  version: number;
  uploader: PersonRef;
  /** Where processing is, and why it failed (shown to the uploader and managers). */
  stage: ProcessingStage;
  progress: number;
  error: string | null;
  chunkCount: number;
  hasTranscript: boolean;
  thumbnailFileId: string | null;
  /** For video links: the provider and the privacy-enhanced embed address (loaded only on tap). */
  link: { provider: 'youtube' | 'vimeo'; url: string; embedUrl: string; author: string } | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  can: { edit: boolean; review: boolean };
}
export interface TranscriptSegmentView {
  start: number;
  end: number;
  text: string;
}
export interface MaterialDetailView extends MaterialView {
  chapters: { at: number; title: string }[];
  transcript: TranscriptSegmentView[];
  /** Pages of extracted text (documents), for search inside the viewer. */
  pages: { page: number; text: string }[];
}
export interface SignedFileView {
  url: string;
  expiresAt: string;
}
export interface StudySearchHit {
  chunkId: string;
  materialId: string;
  subjectId: string;
  title: string;
  type: MaterialType;
  page: number | null;
  startSec: number | null;
  snippet: string;
  /** How it was found: by meaning (vectors), by its words, or both. */
  match: 'semantic' | 'keyword' | 'both';
}
/** Live processing progress (socket `study:material`, to the uploader). */
export interface MaterialProgressEvent {
  materialId: string;
  stage: ProcessingStage;
  progress: number;
  error: string | null;
}

export interface AiKeyView {
  status: KeyStatus;
  /** The last four characters only; the key itself never leaves the server. */
  last4: string | null;
  validatedAt: string | null;
  /** Models the provider reported at the last successful test. */
  models: string[];
  /** Short reason from the last failed test (never contains the key). */
  error: string | null;
}
export interface AiProviderInfo {
  id: AiProvider;
  embeddings: boolean;
  needsKey: boolean;
  customEndpoint: boolean;
  defaultChatModel: string;
}
export interface AiSettingsView {
  chatProvider: AiProvider | null;
  chatModel: string;
  embeddingProvider: EmbeddingProvider | null;
  embeddingModel: string;
  baseUrl: string | null;
  embeddingBaseUrl: string | null;
  temperature: number | null;
  maxAnswerTokens: number;
  maxChunks: number;
  monthlyTokenBudget: number;
  dailyMessagesPerUser: number;
  chatRetentionDays: number;
  features: Record<AiFeature, boolean>;
  killSwitch: boolean;
  prices: AiPrices;
  keys: Record<AiKeyTarget, AiKeyView>;
  consent: { version: string; acceptedAt: string; by: PersonRef } | null;
  consentVersion: string;
  /** The platform owner configured a default provider this college can fall back to. */
  platformDefault: { provider: AiProvider; embeddingProvider: EmbeddingProvider | null } | null;
  /**
   * Tokens a month the college's plan includes on the platform's provider, when it answers on it
   * (B11): the budget can be set lower, never higher. Null when the college uses its own provider.
   */
  planAllowance: number | null;
  status: AiStatusView;
  providers: AiProviderInfo[];
}
export type AiOffReason =
  | 'not_configured'
  | 'chatbot_off'
  | 'kill_switch'
  | 'consent_needed'
  | 'key_invalid'
  | 'budget_exhausted'
  /** This member used today's AI answers (per-member daily limit). */
  | 'daily_limit';
/** What members see: whether AI answers are on, and if not, why (no settings detail). */
export interface AiStatusView {
  /** AI answers (the language model) are available. */
  answers: boolean;
  /** Semantic search (embeddings) is available; otherwise keyword search only. */
  semantic: boolean;
  reason: AiOffReason | null;
  /** Built-in demo responder (no external provider). */
  demo: boolean;
}
/** The college's semantic index (Admin › AI assistant): back-fill progress and where vectors live. */
export interface AiIndexView {
  /** An embedding provider is ready (otherwise everything stays keyword-only). */
  semantic: boolean;
  /** `provider:model` of the current vectors. */
  model: string | null;
  store: 'memory' | 'qdrant' | 'atlas';
  /** Passages in the library. */
  total: number;
  /** Passages with a vector of the current model. */
  embedded: number;
  /** Passages waiting for one (new material, a new model, or a provider that was down). */
  pending: number;
  /** Passages the provider refused (too long or unreadable); they stay keyword-searchable. */
  failed: number;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
}
export interface AiTestResult {
  ok: boolean;
  models: string[];
  error: string | null;
}

// ── AI usage and study insights (aggregates only) ─────────────────────────────
/** `?days=` for the admin AI dashboard and the faculty insights. */
export const studyPeriodQuery = z.strictObject({
  days: z.coerce
    .number()
    .int()
    .refine((n) => (STUDY_PERIODS as readonly number[]).includes(n), 'Choose 7, 30 or 90 days')
    .default(30),
});
/** Tokens on one UTC day, by what they were for. */
export interface AiUsageDay {
  day: string;
  chat: number;
  embedding: number;
  /** Transcription and re-ranking. */
  other: number;
  requests: Count;
}
export interface AiUsageModelRow {
  /** `provider:model`. */
  model: string;
  kind: AiUsageKind;
  requests: Count;
  inputTokens: number;
  outputTokens: number;
  /** From the prices the admin entered; null when there is no price for this kind. */
  cost: number | null;
}
/** How much of a subject's material is processed and searchable by meaning. */
export interface AiSubjectCoverage {
  subjectId: string;
  name: string;
  code: string;
  materials: number;
  indexed: number;
  processing: number;
  failed: number;
  passages: number;
  embedded: number;
}
/** Admin › AI assistant › Usage: college totals only, never per member. */
export interface AiUsageView {
  days: number;
  series: AiUsageDay[];
  month: {
    /** `YYYY-MM` (UTC). */
    month: string;
    used: number;
    /** 0 means no budget. */
    budget: number;
    percent: number | null;
    exhausted: boolean;
    /** When the month's count starts again (UTC midnight on the 1st). */
    resetsAt: string;
  };
  models: AiUsageModelRow[];
  cost: { currency: PriceCurrency; period: number | null; month: number | null; priced: boolean };
  answers: { total: Count; failed: Count; refused: Count; notCovered: Count };
  lastError: { message: string; at: string } | null;
  /** Answers are paused after repeated provider failures (this server), until `until`. */
  breaker: { open: boolean; until: string | null };
  queue: {
    processing: number;
    failed: number;
    /** Minutes the oldest unfinished material has waited. */
    oldestWaitingMin: number | null;
    embeddingsPending: number;
    embeddingsRunning: boolean;
  };
  coverage: AiSubjectCoverage[];
}
/**
 * Faculty insights for one subject (spec §10): what students ask about, what the material does
 * not cover, which material helps, and how each unit is used. Counts under 5 are suppressed;
 * no question text and no member is ever shown.
 */
export interface StudyInsightsView {
  subjectId: string;
  days: number;
  generatedAt: string;
  questions: Count;
  students: Count;
  answered: Count;
  notCovered: Count;
  feedback: {
    up: Count;
    down: Count;
    /** Share of rated answers marked helpful; null with fewer than 5 ratings. */
    helpfulRate: number | null;
    reasons: { reason: ChatFeedbackReason; count: Count }[];
  };
  topics: { topicId: string; title: string; unitTitle: string; questions: Count }[];
  /**
   * Content gaps: syllabus topics with questions the material did not cover, and words asked
   * about by at least 5 students that match no topic (`topicId` null).
   */
  gaps: { topicId: string | null; unitId: string | null; title: string; questions: Count; students: Count }[];
  materials: { id: string; title: string; type: MaterialType; cited: Count; views: Count }[];
  units: { unitId: string; title: string; questions: Count; students: Count; views: Count }[];
}

// ── Study chat ─────────────────────────────
export const chatAskBody = z.strictObject({
  /** Continue a conversation; omitted starts a new one. */
  sessionId: objectId.optional(),
  /** One subject, or null for every subject I read. */
  subjectId: objectId.nullable().default(null),
  question: text(1, CHAT_QUESTION_MAX),
  mode: z.enum(ANSWER_MODES).default('simple'),
  command: z.enum(SERVER_COMMANDS).optional(),
  difficulty: z.enum(CHAT_DIFFICULTIES).optional(),
  count: z.number().int().min(QUIZ_SIZE.min).max(QUIZ_SIZE.max).optional(),
  /** "Ask about this": the material open in the viewer, where, and the words selected. */
  context: z
    .strictObject({
      materialId: objectId,
      page: z.number().int().min(1).max(10_000).nullable().default(null),
      startSec: z.number().min(0).max(86_400).nullable().default(null),
      text: text(0, 1500).default(''),
    })
    .optional(),
  /** Answer one of my earlier questions again (the assistant message id). */
  regenerate: objectId.optional(),
});
export type ChatAskInput = z.input<typeof chatAskBody>;
export const chatFeedbackBody = z.strictObject({
  rating: z.enum(['up', 'down']).nullable(),
  reason: z.enum(CHAT_FEEDBACK_REASONS).nullable().default(null),
});
export const quizAnswersBody = z.strictObject({
  /** One per question: an option index for multiple choice, the typed answer for short ones. */
  answers: z
    .array(z.union([z.number().int().min(0).max(9), text(0, 300)]))
    .min(1)
    .max(QUIZ_SIZE.max),
});
export const deckBody = z.strictObject({
  messageId: objectId,
  title: text(1, 120),
});
export const chatSessionsQuery = z.strictObject({ cursor: objectId.optional() });

/** A source an answer cites: opens the material at its page or moment. */
export interface ChatCitation {
  n: number;
  chunkId: string;
  materialId: string;
  subjectId: string;
  title: string;
  type: MaterialType;
  page: number | null;
  startSec: number | null;
  snippet: string;
}
export interface ChatVideo {
  material: MaterialView;
  /** The moments that best match the topic (transcript passages). */
  moments: { startSec: number; text: string }[];
}
export interface WebVideo {
  title: string;
  url: string;
  channel: string;
}
export type QuizQuestion =
  | { kind: 'mcq'; q: string; options: string[]; answer: number; explain: string; cite: number | null }
  | { kind: 'short'; q: string; answer: string; explain: string; cite: number | null };
/** Structured results of commands and of answers that could not be generated. */
export type ChatResult =
  | {
      kind: 'videos';
      topic: string;
      exact: ChatVideo[];
      related: ChatVideo[];
      web: WebVideo[] | null;
      nearby: string[];
    }
  | {
      kind: 'notes';
      topic: string;
      items: { material: MaterialView; pages: number[] }[];
      nearby: string[];
    }
  | {
      kind: 'quiz';
      topic: string;
      questions: QuizQuestion[];
      /** Saved when the member finishes the quiz. */
      score: { correct: number; total: number; answers: (number | string)[]; at: string } | null;
    }
  | { kind: 'flashcards'; topic: string; cards: { front: string; back: string; cite: number | null }[] }
  /** The material does not cover it (logged for the faculty's content gaps). */
  | { kind: 'not_covered'; nearby: string[] }
  /** AI answers are off: the matching passages, quoted, instead of a generated answer. */
  | { kind: 'passages'; reason: AiOffReason | null };
export type ChatMessageStatus = 'complete' | 'stopped' | 'failed' | 'refused';
export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  command: ServerCommand | null;
  citations: ChatCitation[];
  result: ChatResult | null;
  status: ChatMessageStatus;
  /** Answered from passages that cover the question (retrieval was confident). */
  grounded: boolean;
  mode: AnswerMode;
  feedback: 'up' | 'down' | null;
  createdAt: string;
}
export interface ChatSessionView {
  id: string;
  title: string;
  subjectId: string | null;
  mode: AnswerMode;
  lastMessageAt: string;
  messageCount: number;
}
export interface ChatSessionDetail extends ChatSessionView {
  messages: ChatMessageView[];
}
/** The server-sent events of one question (POST /study/chat). */
export type ChatStreamEvent =
  | { type: 'start'; sessionId: string; question: ChatMessageView; messageId: string }
  | { type: 'sources'; citations: ChatCitation[] }
  | { type: 'delta'; text: string }
  /** The provider refused part-way: replace what was shown. */
  | { type: 'replace'; text: string }
  | { type: 'done'; message: ChatMessageView }
  | { type: 'error'; code: string; message: string };
export interface FlashcardDeckView {
  id: string;
  title: string;
  subjectId: string | null;
  cards: { front: string; back: string }[];
  createdAt: string;
}
