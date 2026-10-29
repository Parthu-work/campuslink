import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  DEFAULT_TIMEZONE,
  TOPICS,
  type FollowState,
  type OneUsefulThingView,
  type StoryView,
  type Topic,
  type followBody,
  type storyBody,
} from '@campuslink/shared';
import { FollowModel, OneUsefulThingModel, StoryModel, type StoryDoc } from './story.model.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { ErrorCode } from '@campuslink/shared';
import { plainText } from '../../lib/text.js';
import { zonedParts } from '../../lib/timezone.js';
import type { FilesService } from '../files/files.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { SafetyService } from '../moderation/safety.service.js';
import { isModerator, type Removal } from '../moderation/moderation.service.js';
import type { ContentSourcesService } from '../content-sources/sources.service.js';
import type { PostsService } from './posts.service.js';
import type { TenantRecord } from '../tenants/tenant.cache.js';
import type { AuthState } from '../../types.js';
import { requireFeature } from '../tenants/features.js';

const STORY_TTL_MS = 24 * 3600_000;
const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

// ── Follows ─────────────────────────────
export class FollowsService {
  async exportFor(userId: string) {
    return FollowModel.find({ followerId: userId }).select('targetType targetId createdAt').lean();
  }

  async eraseFor(userId: string) {
    const u = new Types.ObjectId(userId);
    await FollowModel.deleteMany({ $or: [{ followerId: u }, { targetType: 'user', targetId: u }] });
  }

  constructor(
    private readonly d: {
      profiles: ProfilesService;
      safety: SafetyService;
      sources: () => ContentSourcesService;
    },
  ) {}

  async state(userId: string): Promise<FollowState> {
    const rows = await FollowModel.find({ followerId: new Types.ObjectId(userId) })
      .select('targetType targetId')
      .lean();
    return {
      users: rows.filter((r) => r.targetType === 'user').map((r) => r.targetId),
      topics: rows.filter((r) => r.targetType === 'topic').map((r) => r.targetId as Topic),
      sources: rows.filter((r) => r.targetType === 'source').map((r) => r.targetId),
    };
  }

  async follow(viewer: AuthState, body: z.output<typeof followBody>) {
    if (body.targetType === 'user') {
      if (body.targetId === viewer.userId) throw badRequest('You cannot follow yourself');
      if (
        !(await this.d.profiles.isActiveMember(body.targetId)) ||
        (await this.d.safety.isBlockedEither(viewer.userId, body.targetId))
      )
        throw notFound('Member');
    }
    if (body.targetType === 'source') {
      await requireFeature('contentSources');
      if (!(await this.d.sources().exists(body.targetId))) throw notFound('Source');
    }
    if (body.targetType === 'topic' && !(TOPICS as readonly string[]).includes(body.targetId))
      throw notFound('Topic');
    try {
      await FollowModel.create({ followerId: new Types.ObjectId(viewer.userId), ...body });
    } catch (e) {
      if (!isDuplicate(e)) throw e;
    }
    return this.state(viewer.userId);
  }

  async unfollow(viewer: AuthState, targetType: string, targetId: string) {
    await FollowModel.deleteOne({ followerId: new Types.ObjectId(viewer.userId), targetType, targetId });
    return this.state(viewer.userId);
  }

  async followerCounts(type: 'source' | 'user', ids: string[]) {
    const rows = await FollowModel.aggregate<{ _id: string; n: number }>([
      { $match: { targetType: type, targetId: { $in: ids } } },
      { $group: { _id: '$targetId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [r._id, r.n]));
  }

  async dropTarget(type: 'source' | 'user', id: string) {
    await FollowModel.deleteMany({ targetType: type, targetId: id });
  }

  /** Blocks end follows both ways. */
  async onBlock(a: string, b: string) {
    await FollowModel.deleteMany({
      targetType: 'user',
      $or: [
        { followerId: new Types.ObjectId(a), targetId: b },
        { followerId: new Types.ObjectId(b), targetId: a },
      ],
    });
  }

  /** Right-rail suggestions: alumni of your branch you don't follow, and sources you don't follow. */
  async suggestions(viewer: AuthState) {
    const [state, own] = await Promise.all([this.state(viewer.userId), this.d.profiles.own(viewer.userId)]);
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    const exclude = [viewer.userId, ...state.users, ...hidden];
    let people = await this.d.profiles.alumniOfBranch(own.branch, exclude, 5);
    if (people.length < 3)
      people = [...new Set([...people, ...(await this.d.profiles.alumniOfBranch(null, exclude, 5))])].slice(
        0,
        5,
      );
    const views = await this.d.profiles.authorsFor(viewer, people);
    const sources = (await this.d.sources().publicList())
      .filter((s) => !state.sources.includes(s.id))
      .slice(0, 5);
    return { people: people.flatMap((id) => views.get(id) ?? []), sources };
  }
}

// ── Stories ─────────────────────────────
export class StoriesService {
  async exportFor(userId: string) {
    return StoryModel.find({ authorId: userId }).select('kind text link createdAt expiresAt').lean();
  }

  async eraseFor(userId: string) {
    await StoryModel.deleteMany({ authorId: new Types.ObjectId(userId) });
  }

  constructor(
    private readonly d: { files: FilesService; profiles: ProfilesService; safety: SafetyService },
  ) {}

  private async views(viewer: AuthState, rows: StoryDoc[]): Promise<StoryView[]> {
    const authors = await this.d.profiles.authorsFor(
      viewer,
      rows.map((s) => s.authorId),
    );
    return rows.map((s) => ({
      id: String(s._id),
      author: authors.get(String(s.authorId)) ?? {
        userId: String(s.authorId),
        name: '',
        avatarFileId: null,
        roles: [],
        headline: '',
        branch: null,
        gradYear: null,
      },
      kind: s.kind as 'text' | 'photo',
      text: s.text,
      background: (s.background ?? null) as StoryView['background'],
      fileId: s.fileId ? String(s.fileId) : null,
      alt: s.alt,
      link: s.link ?? null,
      linkLabel: s.linkLabel ?? null,
      isMine: String(s.authorId) === viewer.userId,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
  }

  async list(viewer: AuthState) {
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    const rows = (
      await StoryModel.find({ status: 'published', expiresAt: { $gt: new Date() } })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean<StoryDoc[]>()
    ).filter((s) => !hidden.has(String(s.authorId)));
    return this.views(viewer, rows);
  }

  async create(viewer: AuthState, tenant: TenantRecord, body: z.output<typeof storyBody>) {
    if (tenant.features?.stories === false)
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Stories are turned off for your college');
    const expiresAt = new Date(Date.now() + STORY_TTL_MS);
    let fileId: Types.ObjectId | null = null;
    if (body.kind === 'photo') {
      const f = await this.d.files.claim(
        body.fileId,
        viewer.userId,
        'story_media',
        new Date(expiresAt.getTime() + 3600_000),
      );
      fileId = new Types.ObjectId(f.id);
    }
    const doc = await StoryModel.create({
      authorId: new Types.ObjectId(viewer.userId),
      kind: body.kind,
      text: plainText(body.text ?? ''),
      background: body.kind === 'text' ? body.background : null,
      fileId,
      alt: body.kind === 'photo' ? plainText(body.alt) : '',
      link: body.link ?? null,
      linkLabel: body.linkLabel ? plainText(body.linkLabel) : null,
      expiresAt,
    });
    return (await this.views(viewer, [doc.toObject() as StoryDoc]))[0] as StoryView;
  }

  async remove(viewer: AuthState, id: string) {
    const s = await StoryModel.findOneAndDelete({ _id: id, authorId: viewer.userId }).lean<StoryDoc>();
    if (!s) throw notFound('Story');
    if (s.fileId) await this.d.files.remove(s.fileId);
    return { deleted: true };
  }

  async mediaAccess(fileId: string, viewer: AuthState): Promise<{ name: string } | null> {
    const s = await StoryModel.findOne({ fileId }).select('authorId status expiresAt').lean<StoryDoc>();
    if (!s) return null;
    const live = s.status === 'published' && s.expiresAt.getTime() > Date.now();
    return live || String(s.authorId) === viewer.userId || isModerator(viewer) ? { name: 'story' } : null;
  }

  readonly handler = {
    load: async (id: string) => {
      const s = await StoryModel.findById(id).lean<StoryDoc>();
      return s
        ? {
            authorId: String(s.authorId),
            status: s.status,
            snapshot: [s.text, s.alt, s.link ?? ''].filter(Boolean).join('\n'),
            context: {},
          }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await StoryModel.updateOne(
          { _id: id, status: removal ? 'published' : 'removed' },
          { $set: { status: removal ? 'removed' : 'published', removal } },
        )
      ).modifiedCount > 0,
  };
}

// ── One Useful Thing ─────────────────────────────
export class OneUsefulThingService {
  constructor(
    private readonly d: { posts: PostsService; sources: ContentSourcesService; follows: FollowsService },
  ) {}

  static today(now = new Date()) {
    return zonedParts(now, DEFAULT_TIMEZONE).date;
  }

  /**
   * Today's card: the staff pick if there is one; otherwise the most engaged alumni tip of the last
   * 48 hours; otherwise the newest item from a source or topic you follow.
   */
  async get(viewer: AuthState): Promise<OneUsefulThingView | null> {
    const date = OneUsefulThingService.today();
    const picked = await OneUsefulThingModel.findOne({ date }).lean();
    if (picked) {
      const view = await this.resolve(
        viewer,
        picked.targetType as 'post' | 'item',
        String(picked.targetId),
        true,
        date,
      );
      if (view) return view;
    }
    const since = new Date(Date.now() - 48 * 3600_000);
    const posts = (
      await this.d.posts.recent(since, new Date(), 100, {
        authorAlumni: true,
        kind: { $in: ['text', 'reel', 'link'] },
      })
    ).sort(
      (a, b) =>
        (b.counts?.helpful ?? 0) * 2 +
        (b.counts?.saves ?? 0) * 3 +
        (b.counts?.comments ?? 0) -
        ((a.counts?.helpful ?? 0) * 2 + (a.counts?.saves ?? 0) * 3 + (a.counts?.comments ?? 0)),
    );
    const top = posts.find((p) => (p.counts?.helpful ?? 0) + (p.counts?.saves ?? 0) > 0);
    if (top)
      return {
        date,
        kind: 'post',
        curated: false,
        post: (await this.d.posts.views(viewer, [top]))[0] ?? null,
        item: null,
      };
    const follows = await this.d.follows.state(viewer.userId);
    const [item] = await this.d.sources.recentItems({
      since,
      until: new Date(),
      limit: 1,
      ...(follows.sources.length ? { sourceIds: follows.sources } : {}),
      ...(follows.topics.length ? { topics: follows.topics } : {}),
    });
    if (!item) return null;
    return {
      date,
      kind: 'item',
      curated: false,
      post: null,
      item: (await this.d.sources.itemViews([item]))[0] ?? null,
    };
  }

  private async resolve(
    viewer: AuthState,
    type: 'post' | 'item',
    id: string,
    curated: boolean,
    date: string,
  ) {
    if (type === 'post') {
      const [p] = await this.d.posts.byIds([id]);
      return p
        ? {
            date,
            kind: 'post' as const,
            curated,
            post: (await this.d.posts.views(viewer, [p]))[0] ?? null,
            item: null,
          }
        : null;
    }
    const [i] = await this.d.sources.itemsByIds([id]);
    return i
      ? {
          date,
          kind: 'item' as const,
          curated,
          post: null,
          item: (await this.d.sources.itemViews([i]))[0] ?? null,
        }
      : null;
  }

  async feature(actor: AuthState, targetType: 'post' | 'item', targetId: string) {
    const ok =
      targetType === 'post'
        ? (await this.d.posts.byIds([targetId])).length
        : (await this.d.sources.itemsByIds([targetId])).length;
    if (!ok) throw notFound(targetType === 'post' ? 'Post' : 'Item');
    const date = OneUsefulThingService.today();
    await OneUsefulThingModel.updateOne(
      { date },
      {
        $set: {
          date,
          targetType,
          targetId: new Types.ObjectId(targetId),
          curatedBy: new Types.ObjectId(actor.userId),
        },
      },
      { upsert: true },
    );
    return this.get(actor);
  }
}
