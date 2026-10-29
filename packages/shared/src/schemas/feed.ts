import { z } from 'zod';
import { objectId } from './common.js';
import { httpsUrl } from './people.js';
import type { PersonRef } from './mentorship.js';
import { BRANCHES, type Branch } from '../constants/people.js';

// ── Topics ─────────────────────────────
/** Fixed topic list (labels are translated in the web app). */
export const TOPICS = [
  'placements',
  'internships',
  'higher-studies',
  'gate',
  'core-jobs',
  'govt-exams',
  'dsa',
  'web-dev',
  'data',
  'ai-ml',
  'cloud-devops',
  'cybersecurity',
  'electronics',
  'electrical',
  'mechanical',
  'civil',
  'chemical',
  'scholarships',
  'events',
  'campus-life',
  'govt-schemes',
  'startups',
  'tech-news',
  'education-news',
] as const;
export type Topic = (typeof TOPICS)[number];
const topics = z
  .array(z.enum(TOPICS))
  .max(3)
  .refine((t) => new Set(t).size === t.length, 'Duplicate topics')
  .default([]);

// ── Posts ─────────────────────────────
export const POST_KINDS = ['text', 'photo', 'reel', 'poll', 'link'] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const REACTIONS = ['helpful', 'insightful', 'celebrate'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const POST_MAX = 3000;
export const REEL_MAX_SECONDS = 60;
export const REEL_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const mediaRef = (altMax: number) => z.strictObject({ fileId: objectId, alt: text(1, altMax) });
const common = { topics, announcement: z.boolean().default(false) };

export const createPostBody = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), body: text(1, POST_MAX), ...common }),
  z.strictObject({
    kind: z.literal('photo'),
    body: text(0, POST_MAX).default(''),
    media: z
      .array(mediaRef(200))
      .min(1)
      .max(4)
      .refine((m) => new Set(m.map((x) => x.fileId)).size === m.length, 'Each photo once'),
    ...common,
  }),
  z.strictObject({
    kind: z.literal('reel'),
    body: text(0, 600).default(''),
    /** The alt text of a reel is a short description of the video (screen readers, no autoplay). */
    media: z.array(mediaRef(300)).length(1),
    ...common,
  }),
  z.strictObject({
    kind: z.literal('poll'),
    body: text(3, 300),
    poll: z.strictObject({
      options: z
        .array(text(1, 80))
        .min(2)
        .max(4)
        .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, 'Options must differ'),
      closesInDays: z.number().int().min(1).max(14),
    }),
    ...common,
  }),
  z.strictObject({ kind: z.literal('link'), body: text(0, POST_MAX).default(''), url: httpsUrl, ...common }),
]);
export type CreatePostBody = z.infer<typeof createPostBody>;

export const commentBody = z.strictObject({ body: text(1, 1000), parentId: objectId.optional() });
export const reactBody = z.strictObject({ reaction: z.enum(REACTIONS).nullable() });
export const voteBody = z.strictObject({ option: z.number().int().min(0).max(3) });
export const feedQuery = z.strictObject({
  tab: z.enum(['for_you', 'following']).default('for_you'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});
export const postsQuery = z.strictObject({
  kind: z.enum(POST_KINDS).optional(),
  author: objectId.optional(),
  topic: z.enum(TOPICS).optional(),
  saved: z.enum(['true']).optional(),
  cursor: objectId.optional(),
});

// ── Stories ─────────────────────────────
export const STORY_BACKGROUNDS = ['brand', 'accent', 'sunset', 'ocean', 'forest'] as const;
const storyLink = { link: httpsUrl.optional(), linkLabel: text(1, 40).optional() };
export const storyBody = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    text: text(1, 200),
    background: z.enum(STORY_BACKGROUNDS),
    ...storyLink,
  }),
  z.strictObject({
    kind: z.literal('photo'),
    fileId: objectId,
    alt: text(1, 200),
    text: text(0, 120).default(''),
    ...storyLink,
  }),
]);

// ── Follows ─────────────────────────────
export const FOLLOW_TARGETS = ['user', 'topic', 'source'] as const;
export const followBody = z
  .strictObject({ targetType: z.enum(FOLLOW_TARGETS), targetId: z.string().min(1).max(40) })
  .refine(
    (f) =>
      f.targetType === 'topic'
        ? (TOPICS as readonly string[]).includes(f.targetId)
        : /^[a-f0-9]{24}$/.test(f.targetId),
    { message: 'Unknown follow target', path: ['targetId'] },
  );

// ── Q&A ─────────────────────────────
export const questionBody = z.strictObject({ title: text(10, 150), body: text(0, 2000).default(''), topics });
export const answerBody = z.strictObject({ body: text(10, 3000) });
export const questionsQuery = z.strictObject({
  topic: z.enum(TOPICS).optional(),
  mine: z.enum(['true']).optional(),
  unanswered: z.enum(['true']).optional(),
  cursor: objectId.optional(),
});

// ── Content sources ─────────────────────────────
export const FETCH_INTERVALS = [30, 60, 180, 360, 720, 1440] as const;
const intervalMin = z
  .number()
  .int()
  .refine((n) => (FETCH_INTERVALS as readonly number[]).includes(n), 'Unsupported interval');
export const sourceBody = z.strictObject({
  name: text(2, 80),
  url: httpsUrl,
  topics: z.array(z.enum(TOPICS)).max(5).default([]),
  branches: z.array(z.enum(BRANCHES)).max(5).default([]),
  intervalMin: intervalMin.default(180),
});
export const sourceUpdateBody = z.strictObject({
  name: text(2, 80).optional(),
  topics: z.array(z.enum(TOPICS)).max(5).optional(),
  branches: z.array(z.enum(BRANCHES)).max(5).optional(),
  intervalMin: intervalMin.optional(),
  status: z.enum(['active', 'paused']).optional(),
});
export const sourceTestBody = z.strictObject({ url: httpsUrl });

// ── Moderation ─────────────────────────────
export const CONTENT_TARGETS = [
  'post',
  'comment',
  'question',
  'answer',
  'story',
  'item',
  'job',
  'roadmap',
  'roadmap_comment',
  'event',
  'event_question',
  'review',
] as const;
export type ContentTarget = (typeof CONTENT_TARGETS)[number];
export const REMOVAL_REASONS = [
  'spam',
  'harassment',
  'inappropriate',
  'misinformation',
  'off_topic',
  'copyright',
  'privacy',
  'other',
] as const;
export type RemovalReason = (typeof REMOVAL_REASONS)[number];
export const moderateBody = z
  .strictObject({
    targetType: z.enum(CONTENT_TARGETS),
    targetId: objectId,
    action: z.enum(['remove', 'restore']),
    reason: z.enum(REMOVAL_REASONS).optional(),
    note: text(0, 500).optional(),
    reportId: objectId.optional(),
  })
  .refine((b) => b.action !== 'remove' || !!b.reason, { message: 'Pick a reason', path: ['reason'] });
export const appealBody = z.strictObject({ message: text(10, 1000) });
export const appealDecisionBody = z.strictObject({
  decision: z.enum(['uphold', 'reverse']),
  note: text(0, 500).optional(),
});
export const questionDecisionBody = z
  .strictObject({ decision: z.enum(['approve', 'reject']), reason: z.enum(REMOVAL_REASONS).optional() })
  .refine((b) => b.decision !== 'reject' || !!b.reason, { message: 'Pick a reason', path: ['reason'] });
export const featureBody = z.strictObject({ targetType: z.enum(['post', 'item']), targetId: objectId });

// ── Views ─────────────────────────────
export interface AuthorRef extends PersonRef {
  roles: string[];
  headline: string;
  branch: Branch | null;
  gradYear: number | null;
}
export interface MediaView {
  fileId: string;
  alt: string;
  kind: 'image' | 'video';
  mime: string;
  durationSec: number | null;
}
export interface RemovalView {
  reason: RemovalReason;
  note: string;
  at: string;
  appeal: { status: 'open' | 'upheld' | 'reversed'; message: string; decisionNote: string | null } | null;
}
export interface PostView {
  id: string;
  kind: PostKind;
  author: AuthorRef;
  body: string;
  topics: Topic[];
  hashtags: string[];
  media: MediaView[];
  poll: {
    options: { text: string; votes: number }[];
    total: number;
    closesAt: string;
    closed: boolean;
    myVote: number | null;
  } | null;
  link: { url: string; host: string; title: string; description: string; siteName: string } | null;
  announcement: boolean;
  counts: { reactions: Record<Reaction, number>; comments: number; saves: number; shares: number };
  myReaction: Reaction | null;
  saved: boolean;
  isMine: boolean;
  status: 'published' | 'removed';
  /** Only for the author and moderators. */
  removal: RemovalView | null;
  createdAt: string;
}
export interface ItemView {
  id: string;
  title: string;
  snippet: string;
  url: string;
  host: string;
  source: { id: string; name: string };
  topics: Topic[];
  publishedAt: string;
}
export type FeedEntry = { type: 'post'; post: PostView } | { type: 'item'; item: ItemView };
export interface CommentView {
  id: string;
  postId: string;
  parentId: string | null;
  author: AuthorRef;
  body: string;
  status: 'published' | 'removed';
  isMine: boolean;
  removal: RemovalView | null;
  createdAt: string;
}
export interface StoryView {
  id: string;
  author: AuthorRef;
  kind: 'text' | 'photo';
  text: string;
  background: (typeof STORY_BACKGROUNDS)[number] | null;
  fileId: string | null;
  alt: string;
  link: string | null;
  linkLabel: string | null;
  isMine: boolean;
  createdAt: string;
  expiresAt: string;
}
export interface QuestionView {
  id: string;
  title: string;
  body: string;
  topics: Topic[];
  author: AuthorRef;
  status: 'pending' | 'published' | 'rejected' | 'removed';
  answers: number;
  acceptedAnswerId: string | null;
  isMine: boolean;
  removal: RemovalView | null;
  createdAt: string;
}
export interface AnswerView {
  id: string;
  questionId: string;
  author: AuthorRef;
  body: string;
  helpful: number;
  votedHelpful: boolean;
  accepted: boolean;
  status: 'published' | 'removed';
  isMine: boolean;
  removal: RemovalView | null;
  createdAt: string;
}
export interface OneUsefulThingView {
  date: string;
  kind: 'post' | 'item';
  curated: boolean;
  post: PostView | null;
  item: ItemView | null;
}
export interface SourceView {
  id: string;
  name: string;
  url: string;
  host: string;
  topics: Topic[];
  branches: Branch[];
  intervalMin: number;
  status: 'active' | 'paused';
  health: {
    state: 'ok' | 'failing' | 'blocked' | 'new';
    lastFetchedAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
    itemsLast7d: number;
    heldLast7d: number;
    nextFetchAt: string | null;
  };
  followers: number;
}
export interface FollowState {
  users: string[];
  topics: Topic[];
  sources: string[];
}
