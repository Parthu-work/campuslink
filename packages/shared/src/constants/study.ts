/**
 * Study (subject library and AI study assistant) vocabulary.
 * Zod-free on purpose: screens that only need these values never load Zod (bundle budget).
 */
export const SUBJECT_STATUSES = ['active', 'archived'] as const;
export type SubjectStatus = (typeof SUBJECT_STATUSES)[number];
export const SEMESTER_MIN = 1;
export const SEMESTER_MAX = 8;
export const SYLLABUS_MAX_UNITS = 20;
export const SYLLABUS_MAX_TOPICS = 40;

export const MATERIAL_TYPES = [
  'pdf',
  'doc',
  'slides',
  'notes',
  'image',
  'video_file',
  'video_link',
  'audio',
] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];
/** The library tabs on a subject page. */
export const MATERIAL_TABS = ['notes', 'slides', 'videos', 'pyqs', 'other'] as const;
export type MaterialTab = (typeof MATERIAL_TABS)[number];
export const MATERIAL_VISIBILITY = ['draft', 'in_review', 'published', 'archived'] as const;
export type MaterialVisibility = (typeof MATERIAL_VISIBILITY)[number];
export const PROCESSING_STAGES = [
  'uploaded',
  'scanning',
  'extracting',
  'ocr',
  'transcribing',
  'chunking',
  'embedding',
  'indexed',
  'failed',
] as const;
export type ProcessingStage = (typeof PROCESSING_STAGES)[number];

/** Chat providers. `mock` is the built-in demo responder: no key, no external calls. */
export const AI_PROVIDERS = ['mock', 'anthropic', 'openai', 'gemini', 'openai_compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
/** Embedding providers. Anthropic offers no embeddings API, so it is not one of them. */
export const EMBEDDING_PROVIDERS = ['mock', 'openai', 'gemini', 'openai_compatible'] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];
/** Providers that need an API key (everything except the built-in demo). */
export const KEYED_PROVIDERS: readonly string[] = ['anthropic', 'openai', 'gemini', 'openai_compatible'];
/** Providers whose endpoint the admin enters (OpenAI-compatible servers). */
export const CUSTOM_ENDPOINT_PROVIDERS: readonly string[] = ['openai_compatible'];
/**
 * Default chat model per provider. Only Anthropic's is filled in: for the others the admin picks a
 * model from the list "Test connection" detects, so we never guess a model name.
 */
export const DEFAULT_CHAT_MODEL: Record<AiProvider, string> = {
  mock: 'mock-chat-1',
  anthropic: 'claude-opus-5-5',
  openai: '',
  gemini: '',
  openai_compatible: '',
};
export const DEFAULT_EMBEDDING_MODEL: Record<EmbeddingProvider, string> = {
  mock: 'mock-embed-1',
  openai: '',
  gemini: '',
  openai_compatible: '',
};
/** Which stored key a request uses. YouTube is the optional key for external video suggestions. */
export const AI_KEY_TARGETS = ['chat', 'embedding', 'youtube'] as const;
export type AiKeyTarget = (typeof AI_KEY_TARGETS)[number];
export const KEY_STATUSES = ['not_set', 'valid', 'invalid'] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];
/**
 * Version of the data-processing notice the admin accepts before external AI is enabled. Bump it
 * when the notice changes: admins then accept again.
 */
export const AI_CONSENT_VERSION = '2026-10-1';
export const AI_FEATURES = [
  'chatbot',
  'studentUploads',
  'externalVideos',
  'ocr',
  'transcription',
  'facultySeeChats',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const ANSWER_MODES = ['simple', 'detailed', 'exam'] as const;
export type AnswerMode = (typeof ANSWER_MODES)[number];
export const SLASH_COMMANDS = [
  'videos',
  'notes',
  'summary',
  'explain',
  'quiz',
  'flashcards',
  'important',
  'syllabus',
  'subject',
  'help',
] as const;
export type SlashCommand = (typeof SLASH_COMMANDS)[number];
/** Commands that need the language model; the rest work from retrieval and metadata alone. */
export const GENERATIVE_COMMANDS: readonly SlashCommand[] = [
  'summary',
  'explain',
  'quiz',
  'flashcards',
  'important',
];

/** Where a material is shown by default, from its type (the uploader can change it). */
export const DEFAULT_TAB: Record<MaterialType, MaterialTab> = {
  pdf: 'notes',
  doc: 'notes',
  slides: 'slides',
  notes: 'notes',
  image: 'other',
  video_file: 'videos',
  video_link: 'videos',
  audio: 'other',
};
export const MATERIAL_LANGUAGES = ['en', 'te', 'other'] as const;
export type MaterialLanguage = (typeof MATERIAL_LANGUAGES)[number];
/** Size caps (the API enforces them again after sniffing the real type). */
export const MATERIAL_MAX_MB = { document: 50, media: 200 } as const;
/** What the upload picker offers (the server sniffs content; extensions are only a hint). */
export const MATERIAL_ACCEPT =
  '.pdf,.docx,.pptx,.txt,.md,.csv,.jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,.mp3,.m4a,.ogg,.wav,application/pdf,image/*,video/*,audio/*';
/** Caption files that can accompany a video (used as its transcript). */
export const TRANSCRIPT_ACCEPT = '.vtt,.srt,text/vtt';
/** Hosts whose links are accepted as video links (metadata through their official oEmbed). */
export const VIDEO_LINK_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'vimeo.com',
  'www.vimeo.com',
] as const;
export const CHUNK_EMBEDDING_STATUSES = ['embedding_pending', 'embedded', 'failed'] as const;
/** What AI usage is counted for (budgets and the admin dashboard). */
export const AI_USAGE_KINDS = ['chat', 'embedding', 'transcription', 'rerank'] as const;
export type AiUsageKind = (typeof AI_USAGE_KINDS)[number];
export type ChunkEmbeddingStatus = (typeof CHUNK_EMBEDDING_STATUSES)[number];
