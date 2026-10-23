import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  ErrorCode,
  publishProblems,
  roadmapContent,
  type NodeCommentView,
  type PersonRef,
  type ReviewQueueItem,
  type RoadmapContent,
  type RoadmapSummaryView,
  type RoadmapView,
  type VersionView,
  type nodeCommentBody,
  type progressBody,
  type reviewBody,
  type roadmapFlagsBody,
  type roadmapsQuery,
  type saveDraftBody,
} from '@campuslink/shared';
import {
  RoadmapCommentModel,
  RoadmapModel,
  RoadmapProgressModel,
  RoadmapVersionModel,
  type ProgressDoc,
  type RoadmapCommentDoc,
  type RoadmapDoc,
  type VersionDoc,
} from './roadmap.model.js';
import { LIBRARY, type LibraryRoadmap } from './library/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { plainText } from '../../lib/text.js';
import { requireTenantId, withPlatformScope } from '../../lib/context.js';
import { withTextSearch } from '../../db/search.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';
import { backgroundAuth } from '../users/users.service.js';
import { findTenantById } from '../tenants/tenant.cache.js';
import { isModerator, type Removal } from '../moderation/moderation.service.js';
import type { JobQueue, TenantJob } from '../../lib/jobs.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { AuthState } from '../../types.js';
import { noAward, type Award } from '../../lib/awards.js';

export const NUDGE_JOB = 'roadmaps.nudge';
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

const canReview = (v: AuthState) => v.permissions.has('roadmaps:review');
const canWrite = (v: AuthState) => v.permissions.has('roadmaps:write');
const isLive = (r: Pick<RoadmapDoc, 'status' | 'removal'>) => r.status === 'published' && !r.removal;

export function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'roadmap'
  );
}

/** Stored text is plain text (ADR 0007); URLs were validated as https by the schema. */
function clean(c: RoadmapContent): RoadmapContent {
  const t = (s: string) => plainText(s);
  const refs = (r: { title: string; url: string }[]) => r.map((x) => ({ title: t(x.title), url: x.url }));
  return {
    ...c,
    title: t(c.title),
    summary: t(c.summary),
    outcomes: c.outcomes.map(t),
    sources: refs(c.sources),
    nodes: c.nodes.map((n) => ({
      ...n,
      title: t(n.title),
      summary: t(n.summary),
      proof: t(n.proof),
      resources: refs(n.resources),
      sources: refs(n.sources),
    })),
  };
}

function summaryFields(c: RoadmapContent) {
  return {
    title: c.title,
    summary: c.summary,
    category: c.category,
    branches: c.branches,
    nodeCount: c.nodes.length,
    needsReviewCount: c.nodes.filter((n) => n.needsReview).length,
  };
}

async function installNew(l: LibraryRoadmap) {
  const c = roadmapContent.parse(l.content);
  const reviewed = new Date(`${l.lastReviewedAt}T00:00:00Z`);
  let r;
  try {
    r = await RoadmapModel.create({
      slug: (await RoadmapModel.exists({ slug: l.key }))
        ? `${l.key}-${randomBytes(3).toString('hex')}`
        : l.key,
      libraryKey: l.key,
      libraryHash: l.hash,
      status: 'published',
      ...summaryFields(c),
      createdBy: null,
      publishedVersion: 1,
      latestVersion: 1,
      openVersion: null,
      lastReviewedAt: reviewed,
    });
  } catch (e) {
    if (isDuplicate(e)) return false;
    throw e;
  }
  await RoadmapVersionModel.create({
    roadmapId: r._id,
    version: 1,
    status: 'published',
    content: c,
    changeNote: `From the researched library (reviewed ${l.lastReviewedAt})`,
    authorId: null,
    editorIds: [],
    reviewedAt: reviewed,
  });
  return true;
}

/** Seed and new colleges: install every library roadmap not yet present (in the current tenant). */
export async function installLibraryRoadmaps() {
  let n = 0;
  for (const l of LIBRARY)
    if (!(await RoadmapModel.exists({ libraryKey: l.key })) && (await installNew(l))) n++;
  return n;
}

export interface RoadmapsDeps {
  profiles: ProfilesService;
  notifications: NotificationsService;
  jobs: JobQueue;
}

/**
 * Cited, reviewed roadmaps: drafts by writers, approval by a different reviewer, version history,
 * per-node comments, personal progress with a weekly goal and gentle nudges.
 */
export class RoadmapsService {
  // ── Privacy ─────────────────────────────
  async exportFor(userId: string) {
    const [progress, comments] = await Promise.all([
      RoadmapProgressModel.find({ userId: oid(userId) })
        .select('roadmapId done nodesPerWeek')
        .lean(),
      RoadmapCommentModel.find({ authorId: oid(userId) })
        .select('roadmapId nodeId body createdAt')
        .lean(),
    ]);
    return { progress, comments };
  }

  /** Progress and comments are deleted; roadmaps I wrote stay for the college (shown as "Former member"). */
  async eraseFor(userId: string) {
    await Promise.all([
      RoadmapProgressModel.deleteMany({ userId: oid(userId) }),
      RoadmapCommentModel.deleteMany({ authorId: oid(userId) }),
    ]);
  }

  /** Points for actions this module confirms (wired in app.ts). */
  award: Award = noAward;
  constructor(private readonly d: RoadmapsDeps) {}

  // ── Loading and access ─────────────────────────────
  private async byId(id: string) {
    const r = await RoadmapModel.findById(id).lean<RoadmapDoc>();
    if (!r) throw notFound('Roadmap');
    return r;
  }

  private async openVersion(r: RoadmapDoc) {
    if (r.openVersion === null || r.openVersion === undefined) return null;
    return RoadmapVersionModel.findOne({ roadmapId: r._id, version: r.openVersion }).lean<VersionDoc>();
  }

  /** Who may see a roadmap: everyone when live; its editors and reviewers otherwise. */
  private async visible(viewer: AuthState, r: RoadmapDoc, open?: VersionDoc | null) {
    if (isLive(r)) return true;
    if (r.removal) return isModerator(viewer);
    if (canReview(viewer)) return true;
    if (r.status === 'archived') return false;
    const v = open === undefined ? await this.openVersion(r) : open;
    return this.isEditor(viewer, r, v);
  }

  private isEditor(viewer: AuthState, r: RoadmapDoc, v: VersionDoc | null) {
    if (!canWrite(viewer)) return false;
    if (r.createdBy && String(r.createdBy) === viewer.userId && r.publishedVersion === null) return true;
    return !!v?.editorIds.some((e) => String(e) === viewer.userId);
  }

  private async load(viewer: AuthState, id: string) {
    const r = await this.byId(id);
    const open = await this.openVersion(r);
    if (!(await this.visible(viewer, r, open))) throw notFound('Roadmap');
    return { r, open };
  }

  private async person(id: Types.ObjectId | null | undefined, refs: Map<string, PersonRef>) {
    return id ? (refs.get(String(id)) ?? null) : null;
  }

  // ── Views ─────────────────────────────
  private async summaries(viewer: AuthState, rows: RoadmapDoc[]): Promise<RoadmapSummaryView[]> {
    const ids = rows.map((r) => r._id);
    const [progress, refs] = await Promise.all([
      RoadmapProgressModel.find({ userId: oid(viewer.userId), roadmapId: { $in: ids } })
        .select('roadmapId done')
        .lean<ProgressDoc[]>(),
      this.d.profiles.refsFor(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : []))),
    ]);
    const mine = new Map(progress.map((p) => [String(p.roadmapId), p.done.length]));
    return Promise.all(
      rows.map(async (r) => ({
        id: String(r._id),
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        category: r.category,
        branches: r.branches,
        status: r.status,
        featured: r.featured,
        nodeCount: r.nodeCount,
        needsReviewCount: r.needsReviewCount,
        lastReviewedAt: r.lastReviewedAt?.toISOString() ?? null,
        fromLibrary: !!r.libraryKey,
        author: await this.person(r.createdBy, refs),
        progress: mine.has(String(r._id)) ? { done: mine.get(String(r._id)) ?? 0, total: r.nodeCount } : null,
        hasPendingReview: r.openVersion !== null && r.openVersion !== undefined,
      })),
    );
  }

  private myProgress(p: ProgressDoc | null, content: RoadmapContent) {
    if (!p) return null;
    const ids = new Set(content.nodes.map((n) => n.id));
    const done = p.done.filter((d) => ids.has(d.nodeId ?? ''));
    const since = Date.now() - WEEK;
    return {
      done: done.map((d) => d.nodeId ?? ''),
      nodesPerWeek: p.nodesPerWeek,
      doneThisWeek: done.filter((d) => (d.at?.getTime() ?? 0) >= since).length,
    };
  }

  private async view(viewer: AuthState, r: RoadmapDoc, open: VersionDoc | null): Promise<RoadmapView> {
    const published =
      r.publishedVersion !== null && r.publishedVersion !== undefined
        ? await RoadmapVersionModel.findOne({
            roadmapId: r._id,
            version: r.publishedVersion,
          }).lean<VersionDoc>()
        : null;
    const shown = published ?? open;
    if (!shown) throw notFound('Roadmap');
    const [summary] = await this.summaries(viewer, [r]);
    const editor = this.isEditor(viewer, r, open);
    const progress = published
      ? await RoadmapProgressModel.findOne({
          userId: oid(viewer.userId),
          roadmapId: r._id,
        }).lean<ProgressDoc>()
      : null;
    return {
      ...(summary as RoadmapSummaryView),
      content: shown.content,
      version: shown.version,
      canEdit:
        canWrite(viewer) &&
        !r.removal &&
        r.status !== 'archived' &&
        (!open || (open.status === 'draft' && (editor || canReview(viewer)))),
      canReview:
        canReview(viewer) &&
        open?.status === 'submitted' &&
        !open.editorIds.some((e) => String(e) === viewer.userId),
      draft:
        open && (editor || canReview(viewer))
          ? { version: open.version, status: open.status, reviewNote: open.reviewNote }
          : null,
      myProgress: published ? this.myProgress(progress, published.content) : null,
    };
  }

  private async versionView(v: VersionDoc, refs: Map<string, PersonRef>): Promise<VersionView> {
    return {
      version: v.version,
      status: v.status,
      changeNote: v.changeNote,
      author: await this.person(v.authorId, refs),
      reviewer: await this.person(v.reviewerId, refs),
      reviewNote: v.reviewNote,
      createdAt: v.createdAt.toISOString(),
      reviewedAt: v.reviewedAt?.toISOString() ?? null,
    };
  }

  // ── Reading ─────────────────────────────
  async list(viewer: AuthState, q: z.output<typeof roadmapsQuery>): Promise<RoadmapSummaryView[]> {
    const filter: Record<string, unknown> = { removal: null };
    if (q.category) filter.category = q.category;
    if (q.branch) filter.branches = q.branch;
    if (q.status === 'archived' || q.status === 'in_review') {
      if (!canReview(viewer)) throw forbidden();
      if (q.status === 'archived') filter.status = 'archived';
      else filter.openVersion = { $ne: null };
    } else if (q.status === 'draft') {
      // Unpublished drafts: my own (reviewers see everyone's).
      filter.status = { $in: ['draft', 'in_review'] };
      if (!canReview(viewer)) filter.createdBy = oid(viewer.userId);
    } else filter.status = 'published';
    if (q.mine === 'following') {
      const ids = await RoadmapProgressModel.find({ userId: oid(viewer.userId) })
        .select('roadmapId')
        .limit(200)
        .lean<ProgressDoc[]>();
      filter._id = { $in: ids.map((p) => p.roadmapId) };
    } else if (q.mine === 'authored') {
      const edited = await RoadmapVersionModel.find({ editorIds: oid(viewer.userId) })
        .select('roadmapId')
        .limit(200)
        .lean<VersionDoc[]>();
      filter.$or = [{ createdBy: oid(viewer.userId) }, { _id: { $in: edited.map((v) => v.roadmapId) } }];
    }
    let query = RoadmapModel.find(filter);
    if (q.q && q.q.length >= 3) query = withTextSearch(query, q.q);
    else if (q.q) {
      const term = q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query = query.where({ title: { $regex: `(^|\\s)${term}`, $options: 'i' } });
    }
    const rows = await query.sort({ featured: -1, title: 1 }).limit(200).lean<RoadmapDoc[]>();
    return this.summaries(viewer, rows);
  }

  async get(viewer: AuthState, slug: string): Promise<RoadmapView> {
    const r = await RoadmapModel.findOne({ slug }).lean<RoadmapDoc>();
    if (!r) throw notFound('Roadmap');
    const open = await this.openVersion(r);
    if (!(await this.visible(viewer, r, open))) throw notFound('Roadmap');
    return this.view(viewer, r, open);
  }

  async versions(viewer: AuthState, id: string): Promise<VersionView[]> {
    const { r, open } = await this.load(viewer, id);
    const all = await RoadmapVersionModel.find({ roadmapId: r._id })
      .select('-content')
      .sort({ version: -1 })
      .limit(100)
      .lean<VersionDoc[]>();
    const seesOpen = !!open && (this.isEditor(viewer, r, open) || canReview(viewer));
    const rows = all.filter((v) => v.status === 'published' || v.status === 'superseded' || seesOpen);
    const refs = await this.d.profiles.refsFor(
      rows.flatMap((v) => [v.authorId, v.reviewerId].filter((x): x is Types.ObjectId => !!x)),
    );
    return Promise.all(rows.map((v) => this.versionView(v, refs)));
  }

  async version(viewer: AuthState, id: string, version: number) {
    const { r, open } = await this.load(viewer, id);
    const v = await RoadmapVersionModel.findOne({ roadmapId: r._id, version }).lean<VersionDoc>();
    if (!v) throw notFound('Version');
    const isOpen = v.status === 'draft' || v.status === 'submitted';
    if (isOpen && !(this.isEditor(viewer, r, open) || canReview(viewer))) throw notFound('Version');
    const refs = await this.d.profiles.refsFor(
      [v.authorId, v.reviewerId].filter((x): x is Types.ObjectId => !!x),
    );
    return { ...(await this.versionView(v, refs)), content: v.content, problems: publishProblems(v.content) };
  }

  // ── Authoring ─────────────────────────────
  private async uniqueSlug(title: string) {
    const base = slugify(title);
    if (!(await RoadmapModel.exists({ slug: base }))) return base;
    return `${base.slice(0, 52)}-${randomBytes(3).toString('hex')}`;
  }

  async create(viewer: AuthState, content: RoadmapContent, meta: RequestMetaLite) {
    const c = clean(content);
    const me = oid(viewer.userId);
    let r: RoadmapDoc | null = null;
    for (let i = 0; i < 3 && !r; i++) {
      try {
        r = (
          await RoadmapModel.create({
            slug: await this.uniqueSlug(c.title),
            status: 'draft',
            ...summaryFields(c),
            createdBy: me,
            latestVersion: 1,
            openVersion: 1,
          })
        ).toObject() as RoadmapDoc;
      } catch (e) {
        if (!isDuplicate(e) || i === 2) throw e;
      }
    }
    if (!r) throw conflict('Try again');
    await RoadmapVersionModel.create({
      roadmapId: r._id,
      version: 1,
      status: 'draft',
      content: c,
      changeNote: 'First draft',
      authorId: me,
      editorIds: [me],
    });
    await audit.record(
      { action: 'roadmap.created', actorId: viewer.userId, targetType: 'roadmap', targetId: String(r._id) },
      meta,
    );
    return this.view(viewer, r, await this.openVersion(r));
  }

  /** Save the open draft, or start a new version from the published one. */
  async saveDraft(viewer: AuthState, id: string, body: z.output<typeof saveDraftBody>) {
    const r = await this.byId(id);
    if (r.removal || r.status === 'archived') throw conflict('This roadmap is archived');
    const open = await this.openVersion(r);
    if (!(await this.visible(viewer, r, open))) throw notFound('Roadmap');
    const c = clean(body.content);
    const me = oid(viewer.userId);
    const note = plainText(body.changeNote);
    if (open) {
      if (open.status === 'submitted') throw conflict('This version is waiting for review');
      if (!this.isEditor(viewer, r, open) && !canReview(viewer))
        throw conflict('Someone else is editing this roadmap. Leave them a comment instead.');
      const res = await RoadmapVersionModel.updateOne(
        { _id: open._id, status: 'draft' },
        { $set: { content: c, ...(note ? { changeNote: note } : {}) }, $addToSet: { editorIds: me } },
      );
      if (!res.modifiedCount && !res.matchedCount)
        throw conflict('This version changed; reload and try again');
    } else {
      const version = r.latestVersion + 1;
      // Claim the open slot atomically: one open version per roadmap.
      const claimed = await RoadmapModel.updateOne(
        { _id: r._id, openVersion: null, latestVersion: r.latestVersion },
        { $set: { openVersion: version, latestVersion: version } },
      );
      if (!claimed.modifiedCount) throw conflict('Someone just started editing this roadmap; reload');
      await RoadmapVersionModel.create({
        roadmapId: r._id,
        version,
        status: 'draft',
        content: c,
        changeNote: note,
        authorId: me,
        editorIds: [me],
      });
    }
    if (r.publishedVersion === null) await RoadmapModel.updateOne({ _id: r._id }, { $set: summaryFields(c) });
    const fresh = await this.byId(id);
    return this.view(viewer, fresh, await this.openVersion(fresh));
  }

  async discardDraft(viewer: AuthState, id: string, meta: RequestMetaLite) {
    const { r, open } = await this.load(viewer, id);
    if (!open) throw notFound('Draft');
    if (!this.isEditor(viewer, r, open) && !canReview(viewer)) throw forbidden();
    if (r.publishedVersion === null) {
      // Never published: remove it entirely (and progress, comments).
      await Promise.all([
        RoadmapVersionModel.deleteMany({ roadmapId: r._id }),
        RoadmapCommentModel.deleteMany({ roadmapId: r._id }),
        RoadmapProgressModel.deleteMany({ roadmapId: r._id }),
      ]);
      await RoadmapModel.deleteOne({ _id: r._id });
    } else {
      await RoadmapVersionModel.deleteOne({ _id: open._id });
      await RoadmapCommentModel.deleteMany({ roadmapId: r._id, version: open.version });
      await RoadmapModel.updateOne(
        { _id: r._id, openVersion: open.version },
        { $set: { openVersion: null, latestVersion: open.version - 1 } },
      );
    }
    await audit.record(
      { action: 'roadmap.draft_discarded', actorId: viewer.userId, targetType: 'roadmap', targetId: id },
      meta,
    );
    return { discarded: true };
  }

  async submit(viewer: AuthState, id: string) {
    const { r, open } = await this.load(viewer, id);
    if (!open || open.status !== 'draft') throw conflict('There is no draft to submit');
    if (!this.isEditor(viewer, r, open)) throw forbidden();
    const problems = publishProblems(open.content);
    if (problems.length) throw badRequest('This draft is not ready yet', { problems });
    await RoadmapVersionModel.updateOne(
      { _id: open._id, status: 'draft' },
      { $set: { status: 'submitted', submittedAt: new Date(), reviewNote: '' } },
    );
    if (r.publishedVersion === null)
      await RoadmapModel.updateOne({ _id: r._id }, { $set: { status: 'in_review' } });
    const fresh = await this.byId(id);
    return this.view(viewer, fresh, await this.openVersion(fresh));
  }

  /** A different reviewer approves (publishes) or asks for changes. Nobody approves their own edits. */
  async review(viewer: AuthState, id: string, body: z.output<typeof reviewBody>, meta: RequestMetaLite) {
    const r = await this.byId(id);
    const open = await this.openVersion(r);
    if (!open || open.status !== 'submitted') throw conflict('Nothing is waiting for review');
    if (open.editorIds.some((e) => String(e) === viewer.userId))
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Someone else must review changes you made');
    const now = new Date();
    const note = plainText(body.note);
    if (body.decision === 'request_changes') {
      const res = await RoadmapVersionModel.updateOne(
        { _id: open._id, status: 'submitted' },
        { $set: { status: 'draft', reviewNote: note, reviewerId: oid(viewer.userId), reviewedAt: now } },
      );
      if (!res.modifiedCount) throw conflict('This version was already reviewed');
      if (r.publishedVersion === null)
        await RoadmapModel.updateOne({ _id: r._id }, { $set: { status: 'draft' } });
    } else {
      const problems = publishProblems(open.content);
      if (problems.length) throw badRequest('This version is not ready yet', { problems });
      const res = await RoadmapVersionModel.updateOne(
        { _id: open._id, status: 'submitted' },
        { $set: { status: 'published', reviewNote: note, reviewerId: oid(viewer.userId), reviewedAt: now } },
      );
      if (!res.modifiedCount) throw conflict('This version was already reviewed');
      if (r.publishedVersion !== null)
        await RoadmapVersionModel.updateOne(
          { roadmapId: r._id, version: r.publishedVersion },
          { $set: { status: 'superseded' } },
        );
      await RoadmapModel.updateOne(
        { _id: r._id },
        {
          $set: {
            ...summaryFields(open.content),
            status: r.status === 'archived' ? 'archived' : 'published',
            publishedVersion: open.version,
            openVersion: null,
            lastReviewedAt: now,
          },
        },
      );
    }
    await audit.record(
      {
        action: body.decision === 'approve' ? 'roadmap.approved' : 'roadmap.changes_requested',
        actorId: viewer.userId,
        targetType: 'roadmap',
        targetId: id,
        meta: { version: open.version },
      },
      meta,
    );
    const name = (await this.d.profiles.refsFor([viewer.userId])).get(viewer.userId)?.name ?? '';
    const notifyIds = new Set(open.editorIds.map(String));
    if (body.decision === 'approve')
      for (const editor of notifyIds) await this.award(editor, 'roadmap_published', `${id}:v${open.version}`);
    for (const to of notifyIds)
      await this.d.notifications.notify(
        to,
        body.decision === 'approve' ? 'roadmap_approved' : 'roadmap_changes_requested',
        { name, roadmap: open.content.title, roadmapId: id, slug: r.slug },
      );
    const fresh = await this.byId(id);
    return this.view(viewer, fresh, await this.openVersion(fresh));
  }

  async setFlags(
    viewer: AuthState,
    id: string,
    body: z.output<typeof roadmapFlagsBody>,
    meta: RequestMetaLite,
  ) {
    const r = await this.byId(id);
    if (r.removal) throw conflict('This roadmap was removed by a moderator');
    const set: Record<string, unknown> = {};
    if (body.featured !== undefined) set.featured = body.featured;
    if (body.archived !== undefined) {
      if (r.publishedVersion === null) throw conflict('Only published roadmaps can be archived');
      set.status = body.archived ? 'archived' : 'published';
    }
    await RoadmapModel.updateOne({ _id: r._id }, { $set: set });
    await audit.record(
      {
        action: 'roadmap.flags_changed',
        actorId: viewer.userId,
        targetType: 'roadmap',
        targetId: id,
        meta: {
          featured: body.featured ?? null,
          archived: body.archived ?? null,
        },
      },
      meta,
    );
    const fresh = await this.byId(id);
    return this.view(viewer, fresh, await this.openVersion(fresh));
  }

  /** Versions waiting for review (Admin › Overview). */
  async reviewCount(): Promise<number> {
    return RoadmapVersionModel.countDocuments({ status: 'submitted' });
  }

  async reviewQueue(viewer: AuthState): Promise<ReviewQueueItem[]> {
    const open = await RoadmapVersionModel.find({ status: 'submitted' })
      .select('-content')
      .sort({ submittedAt: 1 })
      .limit(100)
      .lean<VersionDoc[]>();
    const roadmaps = new Map(
      (
        await RoadmapModel.find({ _id: { $in: open.map((v) => v.roadmapId) } })
          .select('slug title')
          .lean<RoadmapDoc[]>()
      ).map((r) => [String(r._id), r]),
    );
    const refs = await this.d.profiles.refsFor(open.flatMap((v) => (v.authorId ? [v.authorId] : [])));
    const out: ReviewQueueItem[] = [];
    for (const v of open) {
      const r = roadmaps.get(String(v.roadmapId));
      if (!r) continue;
      out.push({
        roadmapId: String(r._id),
        slug: r.slug,
        title: r.title,
        version: v.version,
        author: await this.person(v.authorId, refs),
        changeNote: v.changeNote,
        submittedAt: (v.submittedAt ?? v.createdAt).toISOString(),
        isMine: v.editorIds.some((e) => String(e) === viewer.userId),
      });
    }
    return out;
  }

  // ── Library ─────────────────────────────
  async library() {
    const installed = new Map(
      (
        await RoadmapModel.find({ libraryKey: { $in: LIBRARY.map((l) => l.key) } })
          .select('libraryKey libraryHash slug openVersion')
          .lean<RoadmapDoc[]>()
      ).map((r) => [r.libraryKey ?? '', r]),
    );
    return LIBRARY.map((l) => {
      const r = installed.get(l.key);
      return {
        key: l.key,
        title: l.content.title,
        category: l.content.category,
        branches: l.content.branches,
        nodeCount: l.content.nodes.length,
        needsReviewCount: l.content.nodes.filter((n) => n.needsReview).length,
        lastReviewedAt: l.lastReviewedAt,
        installed: !!r,
        slug: r?.slug ?? null,
        updateAvailable: !!r && r.libraryHash !== l.hash,
      };
    });
  }

  /** Install a library roadmap (published as version 1), or propose its update for review. */
  async installFromLibrary(viewer: AuthState | null, key: string, meta: RequestMetaLite = {}) {
    const l = LIBRARY.find((x) => x.key === key);
    if (!l) throw notFound('Library roadmap');
    const existing = await RoadmapModel.findOne({ libraryKey: key }).lean<RoadmapDoc>();
    if (!existing) {
      await installNew(l);
      await audit.record(
        {
          action: 'roadmap.library_installed',
          actorId: viewer?.userId ?? null,
          targetType: 'roadmap',
          meta: { key },
        },
        meta,
      );
      return { installed: true, proposed: false };
    }
    if (existing.libraryHash === l.hash) return { installed: false, proposed: false };
    if (existing.openVersion !== null && existing.openVersion !== undefined)
      throw conflict('Finish or discard the open draft first');
    const version = existing.latestVersion + 1;
    const claimed = await RoadmapModel.updateOne(
      { _id: existing._id, openVersion: null, latestVersion: existing.latestVersion },
      { $set: { openVersion: version, latestVersion: version, libraryHash: l.hash } },
    );
    if (!claimed.modifiedCount) throw conflict('This roadmap changed; reload');
    // Proposed by the platform's research: any reviewer may approve it.
    await RoadmapVersionModel.create({
      roadmapId: existing._id,
      version,
      status: 'submitted',
      submittedAt: new Date(),
      content: l.content,
      changeNote: `Library update (researched ${l.lastReviewedAt})`,
      authorId: null,
      editorIds: [],
    });
    await audit.record(
      {
        action: 'roadmap.library_update_proposed',
        actorId: viewer?.userId ?? null,
        targetType: 'roadmap',
        targetId: String(existing._id),
        meta: { key },
      },
      meta,
    );
    return { installed: false, proposed: true };
  }

  /** Seed and new colleges: install every library roadmap not yet present. */
  installLibrary() {
    return installLibraryRoadmaps();
  }

  // ── Progress ─────────────────────────────
  private async liveContent(id: string) {
    const r = await this.byId(id);
    if (!isLive(r) || r.publishedVersion === null) throw notFound('Roadmap');
    const v = await RoadmapVersionModel.findOne({
      roadmapId: r._id,
      version: r.publishedVersion,
    }).lean<VersionDoc>();
    if (!v) throw notFound('Roadmap');
    return { r, content: v.content };
  }

  async setProgress(viewer: AuthState, id: string, body: z.output<typeof progressBody>) {
    const { r, content } = await this.liveContent(id);
    if (!content.nodes.some((n) => n.id === body.nodeId)) throw badRequest('Unknown step');
    const key = { userId: oid(viewer.userId), roadmapId: r._id };
    if (body.done) {
      await RoadmapProgressModel.updateOne(
        key,
        { $setOnInsert: { nodesPerWeek: 0 } },
        { upsert: true },
      ).catch((e: unknown) => {
        if (!isDuplicate(e)) throw e;
      });
      await RoadmapProgressModel.updateOne(
        { ...key, 'done.nodeId': { $ne: body.nodeId } },
        { $push: { done: { nodeId: body.nodeId, at: new Date() } } },
      );
      await this.award(viewer.userId, 'roadmap_step', `${String(r._id)}:${body.nodeId}`);
    } else await RoadmapProgressModel.updateOne(key, { $pull: { done: { nodeId: body.nodeId } } });
    const p = await RoadmapProgressModel.findOne(key).lean<ProgressDoc>();
    const mine = this.myProgress(p, content);
    if (body.done && mine && mine.done.length === content.nodes.length)
      await this.award(viewer.userId, 'roadmap_finished', String(r._id));
    return mine;
  }

  /** Follow a roadmap with a weekly goal (0 = follow without a goal or nudges). */
  async setGoal(viewer: AuthState, id: string, nodesPerWeek: number) {
    const { r, content } = await this.liveContent(id);
    const key = { userId: oid(viewer.userId), roadmapId: r._id };
    const p = await RoadmapProgressModel.findOneAndUpdate(
      key,
      { $set: { nodesPerWeek, nextNudgeAt: nodesPerWeek > 0 ? new Date(Date.now() + WEEK) : null } },
      { upsert: true, returnDocument: 'after' },
    ).lean<ProgressDoc>();
    return this.myProgress(p, content);
  }

  async unfollow(viewer: AuthState, id: string) {
    await RoadmapProgressModel.deleteOne({ userId: oid(viewer.userId), roadmapId: oid(id) });
    return { unfollowed: true };
  }

  /** Scheduler (named platform path): one weekly check per due goal, in its college. */
  static async enqueueDueNudges(jobs: JobQueue, now = new Date()) {
    const due = await withPlatformScope('roadmaps:due-nudges', () =>
      RoadmapProgressModel.find({ nextNudgeAt: { $lte: now } })
        .select('_id tenantId nextNudgeAt')
        .limit(1000)
        .lean<(ProgressDoc & { tenantId: Types.ObjectId })[]>(),
    );
    for (const p of due)
      await jobs.enqueue(
        NUDGE_JOB,
        { tenantId: String(p.tenantId), progressId: String(p._id) },
        { jobId: `nudge-${String(p._id)}-${p.nextNudgeAt?.getTime() ?? 0}` },
      );
    return due.length;
  }

  /** Job handler: behind on the weekly goal → one gentle nudge (never more than one a week). */
  async runNudge(job: TenantJob) {
    const now = new Date();
    const p = await RoadmapProgressModel.findOneAndUpdate(
      { _id: job.progressId, nextNudgeAt: { $lte: now } },
      { $set: { nextNudgeAt: new Date(now.getTime() + WEEK) } },
      { returnDocument: 'before' },
    ).lean<ProgressDoc>();
    if (!p || p.nodesPerWeek <= 0) return;
    const r = await RoadmapModel.findById(p.roadmapId).lean<RoadmapDoc>();
    if (!r || !isLive(r) || r.publishedVersion === null) return;
    const tenant = await findTenantById(requireTenantId());
    const viewer = tenant ? await backgroundAuth(p.userId, tenant) : null;
    if (!viewer?.permissions.has('roadmaps:progress')) return;
    const v = await RoadmapVersionModel.findOne({
      roadmapId: r._id,
      version: r.publishedVersion,
    }).lean<VersionDoc>();
    if (!v) return;
    const mine = this.myProgress(p, v.content);
    if (!mine || mine.done.length >= v.content.nodes.length) {
      await RoadmapProgressModel.updateOne({ _id: p._id }, { $set: { nextNudgeAt: null } });
      return;
    }
    const since = now.getTime() - WEEK;
    const thisWeek = p.done.filter((d) => (d.at?.getTime() ?? 0) >= since).length;
    if (thisWeek >= p.nodesPerWeek) return;
    await this.d.notifications.notify(p.userId, 'roadmap_nudge', {
      roadmap: r.title,
      roadmapId: String(r._id),
      slug: r.slug,
    });
  }

  // ── Comments (authors and reviewers) ─────────────────────────────
  async comments(viewer: AuthState, id: string): Promise<NodeCommentView[]> {
    const { r } = await this.load(viewer, id);
    const rows = await RoadmapCommentModel.find({ roadmapId: r._id, status: 'published' })
      .sort({ _id: 1 })
      .limit(500)
      .lean<RoadmapCommentDoc[]>();
    const refs = await this.d.profiles.refsFor(rows.map((c) => c.authorId));
    return rows.map((c) => ({
      id: String(c._id),
      nodeId: c.nodeId,
      version: c.version,
      author: refs.get(String(c.authorId)) ?? {
        userId: String(c.authorId),
        name: 'Former member',
        avatarFileId: null,
      },
      body: c.body,
      isMine: String(c.authorId) === viewer.userId,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  async addComment(viewer: AuthState, id: string, body: z.output<typeof nodeCommentBody>) {
    const { r, open } = await this.load(viewer, id);
    const version = open?.version ?? r.publishedVersion;
    if (version === null || version === undefined) throw notFound('Roadmap');
    const v = open ?? (await RoadmapVersionModel.findOne({ roadmapId: r._id, version }).lean<VersionDoc>());
    if (!v?.content.nodes.some((n) => n.id === body.nodeId)) throw badRequest('Unknown step');
    const text = plainText(body.body);
    if (text.length < 2) throw badRequest('Write a comment');
    const c = await RoadmapCommentModel.create({
      roadmapId: r._id,
      version,
      nodeId: body.nodeId,
      authorId: oid(viewer.userId),
      body: text,
    });
    return (await this.comments(viewer, id)).find((x) => x.id === String(c._id));
  }

  async deleteComment(viewer: AuthState, commentId: string) {
    const c = await RoadmapCommentModel.findById(commentId).lean<RoadmapCommentDoc>();
    if (!c || c.status !== 'published') throw notFound('Comment');
    await this.load(viewer, String(c.roadmapId));
    if (String(c.authorId) !== viewer.userId && !canReview(viewer)) throw forbidden();
    await RoadmapCommentModel.deleteOne({ _id: c._id });
    return { deleted: true };
  }

  // ── Moderation and search ─────────────────────────────
  readonly handler = {
    load: async (id: string) => {
      const r = await RoadmapModel.findById(id).lean<RoadmapDoc>();
      if (!r) return null;
      return {
        authorId: r.createdBy ? String(r.createdBy) : '',
        status: r.removal ? 'removed' : isLive(r) ? 'published' : r.status,
        snapshot: `${r.title}\n${r.summary}`,
        context: { slug: r.slug },
      };
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await RoadmapModel.updateOne(
          removal ? { _id: id, removal: null } : { _id: id, removal: { $ne: null } },
          { $set: { removal } },
        )
      ).modifiedCount > 0,
  };

  readonly commentHandler = {
    load: async (id: string) => {
      const c = await RoadmapCommentModel.findById(id).lean<RoadmapCommentDoc>();
      if (!c) return null;
      const r = await RoadmapModel.findById(c.roadmapId).select('slug').lean<RoadmapDoc>();
      return {
        authorId: String(c.authorId),
        status: c.status,
        snapshot: c.body,
        context: { slug: r?.slug ?? '' },
      };
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await RoadmapCommentModel.updateOne(
          removal ? { _id: id, status: 'published' } : { _id: id, status: 'removed' },
          { $set: { status: removal ? 'removed' : 'published', removal } },
        )
      ).modifiedCount > 0,
  };

  /** Report target for comments: only people who can see the comment may report it. */
  async commentReportTarget(viewer: AuthState, id: string) {
    const c = await RoadmapCommentModel.findById(id).lean<RoadmapCommentDoc>();
    // Comments are only visible to writers and reviewers.
    if (!canWrite(viewer)) return null;
    if (!c || c.status !== 'published' || String(c.authorId) === viewer.userId) return null;
    try {
      await this.load(viewer, String(c.roadmapId));
    } catch {
      return null;
    }
    return { subjectUserId: String(c.authorId), snapshot: c.body.slice(0, 2500) };
  }

  async search(viewer: AuthState, text: string) {
    if (text.length < 2) return [];
    return (await this.list(viewer, { q: text })).slice(0, 5);
  }

  /** Analytics: roadmap steps marked done per member since a date. */
  async stepsByUserSince(since: Date) {
    const rows = await RoadmapProgressModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { 'done.at': { $gte: since } } },
      { $unwind: '$done' },
      { $match: { 'done.at': { $gte: since } } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  }
}
