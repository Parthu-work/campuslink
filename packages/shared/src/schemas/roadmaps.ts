import { z } from 'zod';
import { objectId } from './common.js';
import { httpsUrl } from './people.js';
import type { PersonRef } from './mentorship.js';
import { BRANCHES, type Branch } from '../constants/people.js';
import {
  MAX_NODES,
  NODE_KINDS,
  ROADMAP_CATEGORIES,
  type RoadmapCategory,
  type RoadmapStatus,
  type VersionStatus,
  graphProblems,
} from '../constants/roadmaps.js';

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const sourceRef = z.strictObject({ title: text(2, 200), url: httpsUrl });
export type SourceRef = z.infer<typeof sourceRef>;

export const roadmapNode = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Use lowercase letters, digits and dashes'),
  title: text(2, 100),
  kind: z.enum(NODE_KINDS),
  summary: text(10, 400),
  prerequisites: z.array(z.string()).max(6).default([]),
  estimateHours: z
    .tuple([z.number().int().min(0).max(2000), z.number().int().min(0).max(2000)])
    .refine(([a, b]) => b >= a, 'The maximum must be at least the minimum'),
  resources: z.array(sourceRef).max(5).default([]),
  proof: z.string().trim().max(300).default(''),
  sources: z.array(sourceRef).max(6).default([]),
  needsReview: z.boolean().default(false),
});
export type RoadmapNode = z.infer<typeof roadmapNode>;

export const roadmapContent = z
  .strictObject({
    title: text(3, 100),
    summary: text(20, 600),
    category: z.enum(ROADMAP_CATEGORIES),
    branches: z.array(z.enum(BRANCHES)).min(1).max(10),
    outcomes: z.array(text(2, 80)).max(6).default([]),
    sources: z.array(sourceRef).max(12).default([]),
    nodes: z.array(roadmapNode).min(1).max(MAX_NODES),
  })
  .superRefine((c, ctx) => {
    for (const p of graphProblems(c.nodes)) ctx.addIssue({ code: 'custom', message: p, path: ['nodes'] });
  });
export type RoadmapContent = z.infer<typeof roadmapContent>;

/** What still blocks publishing (shown as a checklist to authors and reviewers). */
export function publishProblems(c: RoadmapContent): string[] {
  const out: string[] = [];
  if (c.sources.length < 2) out.push('Add at least two sources for the roadmap as a whole');
  for (const n of c.nodes)
    if (!n.sources.length && !n.needsReview)
      out.push(`“${n.title}” needs a source, or mark it “needs review”`);
  if (!c.nodes.some((n) => n.kind === 'project')) out.push('Add at least one project node (proof of skill)');
  return out;
}

// ── Bodies ─────────────────────────────
export const createRoadmapBody = z.strictObject({ content: roadmapContent });
export const saveDraftBody = z.strictObject({
  content: roadmapContent,
  changeNote: z.string().trim().max(300).default(''),
});
export const reviewBody = z
  .strictObject({
    decision: z.enum(['approve', 'request_changes']),
    note: z.string().trim().max(1000).default(''),
  })
  .refine((b) => b.decision === 'approve' || b.note.length >= 5, {
    message: 'Tell the author what to change',
    path: ['note'],
  });
export const roadmapFlagsBody = z.strictObject({
  featured: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export const progressBody = z.strictObject({
  nodeId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  done: z.boolean(),
});
export const weeklyGoalBody = z.strictObject({ nodesPerWeek: z.number().int().min(0).max(10) });
export const nodeCommentBody = z.strictObject({
  nodeId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  body: text(2, 1000),
});
export const roadmapsQuery = z.strictObject({
  category: z.enum(ROADMAP_CATEGORIES).optional(),
  branch: z.enum(BRANCHES).optional(),
  q: z.string().trim().max(80).optional(),
  mine: z.enum(['authored', 'following']).optional(),
  status: z.enum(['in_review', 'draft', 'archived']).optional(),
});
export const versionParams = z.strictObject({
  id: objectId,
  version: z.coerce.number().int().min(1).max(10_000),
});

// ── Views ─────────────────────────────
export interface RoadmapSummaryView {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: RoadmapCategory;
  branches: Branch[];
  status: RoadmapStatus;
  featured: boolean;
  nodeCount: number;
  needsReviewCount: number;
  lastReviewedAt: string | null;
  fromLibrary: boolean;
  author: PersonRef | null;
  progress: { done: number; total: number } | null;
  hasPendingReview: boolean;
}
export interface VersionView {
  version: number;
  status: VersionStatus;
  changeNote: string;
  author: PersonRef | null;
  reviewer: PersonRef | null;
  reviewNote: string;
  createdAt: string;
  reviewedAt: string | null;
}
export interface RoadmapView extends RoadmapSummaryView {
  /** The published content (or the draft, for its author and reviewers before first publication). */
  content: RoadmapContent;
  version: number;
  canEdit: boolean;
  canReview: boolean;
  draft: { version: number; status: VersionStatus; reviewNote: string } | null;
  myProgress: { done: string[]; nodesPerWeek: number; doneThisWeek: number } | null;
}
export interface NodeCommentView {
  id: string;
  nodeId: string;
  version: number;
  author: PersonRef;
  body: string;
  isMine: boolean;
  createdAt: string;
}
export interface ReviewQueueItem {
  roadmapId: string;
  slug: string;
  title: string;
  version: number;
  author: PersonRef | null;
  changeNote: string;
  submittedAt: string;
  isMine: boolean;
}
