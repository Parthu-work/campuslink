import { z } from 'zod';
import { objectId } from './common.js';
import type { PersonRef } from './mentorship.js';
import { BRANCHES, type Branch } from '../constants/people.js';
import {
  AI_CONSENT_VERSION,
  AI_KEY_TARGETS,
  AI_PROVIDERS,
  EMBEDDING_PROVIDERS,
  SEMESTER_MAX,
  SEMESTER_MIN,
  SUBJECT_STATUSES,
  SYLLABUS_MAX_TOPICS,
  SYLLABUS_MAX_UNITS,
  type AiFeature,
  type AiKeyTarget,
  type AiProvider,
  type EmbeddingProvider,
  type KeyStatus,
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

// ── AI settings ─────────────────────────────
/** An OpenAI-compatible endpoint. Only public https is accepted unless the platform allowlists it. */
export const endpointUrl = z
  .url({ protocol: /^https?$/, error: 'Use an https:// address' })
  .max(500)
  .refine((u) => !/[?#]/.test(u), 'Leave out query strings and fragments');
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
    facultySeeChats: z.boolean(),
  }),
  /** Stops every AI call at once (keyword-only mode stays). */
  killSwitch: z.boolean().default(false),
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
  can: { manage: boolean; upload: boolean };
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
  keys: Record<AiKeyTarget, AiKeyView>;
  consent: { version: string; acceptedAt: string; by: PersonRef } | null;
  consentVersion: string;
  /** The platform owner configured a default provider this college can fall back to. */
  platformDefault: { provider: AiProvider; embeddingProvider: EmbeddingProvider | null } | null;
  status: AiStatusView;
  providers: AiProviderInfo[];
}
export type AiOffReason =
  'not_configured' | 'chatbot_off' | 'kill_switch' | 'consent_needed' | 'key_invalid' | 'budget_exhausted';
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
export interface AiTestResult {
  ok: boolean;
  models: string[];
  error: string | null;
}
