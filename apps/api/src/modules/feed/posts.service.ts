import { Types } from 'mongoose';
import type { z } from 'zod';
import {
  REEL_MAX_SECONDS,
  type CommentView,
  type CreatePostBody,
  type PostView,
  type Reaction,
  type Topic,
  type postsQuery,
} from '@campuslink/shared';
import {
  CommentModel,
  PollVoteModel,
  PostModel,
  ReactionModel,
  SaveModel,
  type CommentDoc,
  type PostDoc,
} from './post.model.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { ErrorCode } from '@campuslink/shared';
import { extractHashtags, plainText } from '../../lib/text.js';
import { linkPreview } from '../../lib/link-preview.js';
import { withTextSearch } from '../../db/search.js';
import type { safeFetch } from '../../lib/safe-fetch.js';
import type { FilesService } from '../files/files.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { SafetyService } from '../moderation/safety.service.js';
import { isModerator, type ModerationService, type Removal } from '../moderation/moderation.service.js';
import type { AuthState } from '../../types.js';
import { noAward, type Award } from '../../lib/awards.js';

const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

export interface PostsDeps {
  files: FilesService;
  profiles: ProfilesService;
  notifications: NotificationsService;
  safety: SafetyService;
  moderation: ModerationService;
  fetcher: typeof safeFetch;
}

export class PostsService {
  /** Points for actions this module confirms (wired in app.ts). */
  award: Award = noAward;
  constructor(private readonly d: PostsDeps) {}

  // ── Create ─────────────────────────────
  async create(viewer: AuthState, body: CreatePostBody): Promise<PostView> {
    if (body.announcement && !viewer.permissions.has('announcements:post'))
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Only staff can post official announcements');
    const text = plainText(body.body);
    if (body.kind === 'text' && !text) throw badRequest('Write something');
    const media: {
      fileId: Types.ObjectId;
      alt: string;
      kind: 'image' | 'video';
      mime: string;
      durationSec: number | null;
    }[] = [];
    if (body.kind === 'photo' || body.kind === 'reel') {
      // Validate every upload first so a rejected post never uses up the media.
      for (const m of body.media) {
        const f = await this.d.files.pending(m.fileId, viewer.userId, 'post_media');
        if (!f) throw badRequest('Upload the media again (it expired or is already used)');
        const isVideo = f.mime.startsWith('video/');
        if (isVideo !== (body.kind === 'reel'))
          throw badRequest(body.kind === 'reel' ? 'A reel needs a video' : 'Photos only');
        if (isVideo && (f.durationSec ?? 0) > REEL_MAX_SECONDS + 0.5)
          throw badRequest(`Reels can be up to ${REEL_MAX_SECONDS} seconds`);
      }
      for (const m of body.media) {
        const f = await this.d.files.claim(m.fileId, viewer.userId, 'post_media', null);
        media.push({
          fileId: new Types.ObjectId(f.id),
          alt: plainText(m.alt),
          kind: f.mime.startsWith('video/') ? 'video' : 'image',
          mime: f.mime,
          durationSec: f.durationSec,
        });
      }
    }
    const facts = (await this.d.profiles.rankingFacts([viewer.userId])).get(viewer.userId);
    const doc = await PostModel.create({
      authorId: new Types.ObjectId(viewer.userId),
      kind: body.kind,
      body: text,
      hashtags: extractHashtags(text),
      topics: body.topics,
      media,
      poll:
        body.kind === 'poll'
          ? {
              options: body.poll.options.map((o) => ({ text: plainText(o), votes: 0 })),
              closesAt: new Date(Date.now() + body.poll.closesInDays * 86_400_000),
            }
          : null,
      link: body.kind === 'link' ? await linkPreview(body.url, this.d.fetcher) : null,
      announcement: body.announcement,
      authorAlumni: facts?.alumni ?? false,
      authorBranch: facts?.branch ?? null,
    });
    if (!body.announcement) await this.award(viewer.userId, 'post_published', String(doc._id));
    return (await this.views(viewer, [doc.toObject() as PostDoc]))[0] as PostView;
  }

  // ── Views ─────────────────────────────
  async views(viewer: AuthState, docs: PostDoc[]): Promise<PostView[]> {
    if (!docs.length) return [];
    const ids = docs.map((p) => p._id);
    const me = new Types.ObjectId(viewer.userId);
    const [authors, reactions, saves, votes] = await Promise.all([
      this.d.profiles.authorsFor(
        viewer,
        docs.map((p) => p.authorId),
      ),
      ReactionModel.find({ postId: { $in: ids }, userId: me })
        .select('postId reaction')
        .lean(),
      SaveModel.find({ postId: { $in: ids }, userId: me })
        .select('postId')
        .lean(),
      PollVoteModel.find({ postId: { $in: ids }, userId: me })
        .select('postId option')
        .lean(),
    ]);
    const mod = isModerator(viewer);
    const removals = await this.d.moderation.removalViews(
      'post',
      docs.filter((p) => mod || String(p.authorId) === viewer.userId) as {
        _id: Types.ObjectId;
        status: string;
        removal?: Removal | null;
      }[],
    );
    const myReaction = new Map(reactions.map((r) => [String(r.postId), r.reaction as Reaction]));
    const saved = new Set(saves.map((s) => String(s.postId)));
    const myVote = new Map(votes.map((v) => [String(v.postId), v.option]));
    const now = Date.now();
    return docs.map((p) => {
      const id = String(p._id);
      const author = authors.get(String(p.authorId));
      const total = p.poll ? p.poll.options.reduce((n, o) => n + (o.votes ?? 0), 0) : 0;
      const closed = !!p.poll?.closesAt && p.poll.closesAt.getTime() <= now;
      const voted = myVote.get(id);
      const showResults = closed || voted !== undefined || String(p.authorId) === viewer.userId;
      return {
        id,
        kind: p.kind as PostView['kind'],
        author: author ?? {
          userId: String(p.authorId),
          name: '',
          avatarFileId: null,
          roles: [],
          headline: '',
          branch: null,
          gradYear: null,
        },
        body: p.body,
        topics: p.topics as Topic[],
        hashtags: p.hashtags,
        media: p.media.map((m) => ({
          fileId: String(m.fileId),
          alt: m.alt ?? '',
          kind: (m.kind ?? 'image') as 'image' | 'video',
          mime: m.mime ?? '',
          durationSec: m.durationSec ?? null,
        })),
        poll: p.poll?.closesAt
          ? {
              options: p.poll.options.map((o) => ({
                text: o.text ?? '',
                votes: showResults ? (o.votes ?? 0) : 0,
              })),
              total: showResults ? total : 0,
              closesAt: p.poll.closesAt.toISOString(),
              closed,
              myVote: voted ?? null,
            }
          : null,
        link: p.link?.url
          ? {
              url: p.link.url,
              host: p.link.host ?? '',
              title: p.link.title ?? '',
              description: p.link.description ?? '',
              siteName: p.link.siteName ?? '',
            }
          : null,
        announcement: p.announcement,
        counts: {
          reactions: {
            helpful: p.counts?.helpful ?? 0,
            insightful: p.counts?.insightful ?? 0,
            celebrate: p.counts?.celebrate ?? 0,
          },
          comments: p.counts?.comments ?? 0,
          saves: p.counts?.saves ?? 0,
          shares: p.counts?.shares ?? 0,
        },
        myReaction: myReaction.get(id) ?? null,
        saved: saved.has(id),
        isMine: String(p.authorId) === viewer.userId,
        status: p.status as PostView['status'],
        removal: removals.get(id) ?? null,
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  /** A post the viewer may see: published (authors not blocked), or removed and theirs / they moderate. */
  private async visible(viewer: AuthState, id: string): Promise<PostDoc> {
    const p = await PostModel.findById(id).lean<PostDoc>();
    if (!p) throw notFound('Post');
    const mine = String(p.authorId) === viewer.userId;
    if (p.status !== 'published' && !mine && !isModerator(viewer)) throw notFound('Post');
    if (!mine && (await this.d.safety.isBlockedEither(viewer.userId, p.authorId))) throw notFound('Post');
    return p;
  }

  private async published(viewer: AuthState, id: string): Promise<PostDoc> {
    const p = await this.visible(viewer, id);
    if (p.status !== 'published') throw conflict('This post was removed');
    return p;
  }

  async get(viewer: AuthState, id: string) {
    return (await this.views(viewer, [await this.visible(viewer, id)]))[0] as PostView;
  }

  async list(viewer: AuthState, q: z.output<typeof postsQuery>) {
    const filter: Record<string, unknown> = {};
    if (q.saved) {
      const saves = await SaveModel.find({
        userId: new Types.ObjectId(viewer.userId),
        ...(q.cursor ? { _id: { $lt: new Types.ObjectId(q.cursor) } } : {}),
      })
        .sort({ _id: -1 })
        .limit(21)
        .lean();
      const posts = await PostModel.find({
        _id: { $in: saves.map((s) => s.postId) },
        status: 'published',
      }).lean<PostDoc[]>();
      const byId = new Map(posts.map((p) => [String(p._id), p]));
      const ordered = saves.slice(0, 20).flatMap((s) => byId.get(String(s.postId)) ?? []);
      return {
        items: await this.views(viewer, ordered),
        nextCursor: saves.length > 20 ? String(saves[19]?._id) : null,
      };
    }
    const own = q.author === viewer.userId;
    if (q.author) filter.authorId = new Types.ObjectId(q.author);
    if (!own) filter.status = 'published';
    if (q.kind) filter.kind = q.kind;
    if (q.topic) filter.topics = q.topic;
    if (q.cursor) filter._id = { $lt: new Types.ObjectId(q.cursor) };
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    if (hidden.size)
      filter.authorId = q.author ? filter.authorId : { $nin: [...hidden].map((h) => new Types.ObjectId(h)) };
    if (q.author && hidden.has(q.author)) return { items: [], nextCursor: null };
    const rows = await PostModel.find(filter).sort({ _id: -1 }).limit(21).lean<PostDoc[]>();
    const page = rows.slice(0, 20);
    return {
      items: await this.views(viewer, page),
      nextCursor: rows.length > 20 ? String(page.at(-1)?._id) : null,
    };
  }

  /** Authors delete their own posts completely (comments, reactions and media go too). */
  async remove(viewer: AuthState, id: string) {
    const p = await PostModel.findOne({ _id: id, authorId: viewer.userId }).lean<PostDoc>();
    if (!p) throw notFound('Post');
    await Promise.all([
      CommentModel.deleteMany({ postId: p._id }),
      ReactionModel.deleteMany({ postId: p._id }),
      SaveModel.deleteMany({ postId: p._id }),
      PollVoteModel.deleteMany({ postId: p._id }),
    ]);
    for (const m of p.media) if (m.fileId) await this.d.files.remove(m.fileId);
    await PostModel.deleteOne({ _id: p._id });
    return { deleted: true };
  }

  // ── Interactions ─────────────────────────────
  async react(viewer: AuthState, id: string, reaction: Reaction | null) {
    const p = await this.published(viewer, id);
    const filter = { postId: p._id, userId: new Types.ObjectId(viewer.userId) };
    const prev = reaction
      ? await ReactionModel.findOneAndUpdate(
          filter,
          { $set: { reaction } },
          { upsert: true, returnDocument: 'before' },
        ).lean()
      : await ReactionModel.findOneAndDelete(filter).lean();
    const inc: Record<string, number> = {};
    if (prev?.reaction) inc[`counts.${prev.reaction}`] = -1;
    if (reaction) inc[`counts.${reaction}`] = (inc[`counts.${reaction}`] ?? 0) + 1;
    if (Object.values(inc).some((v) => v !== 0)) await PostModel.updateOne({ _id: p._id }, { $inc: inc });
    return this.get(viewer, id);
  }

  async save(viewer: AuthState, id: string, on: boolean) {
    const p = await this.published(viewer, id);
    const filter = { postId: p._id, userId: new Types.ObjectId(viewer.userId) };
    if (on) {
      try {
        await SaveModel.create(filter);
        await PostModel.updateOne({ _id: p._id }, { $inc: { 'counts.saves': 1 } });
      } catch (e) {
        if (!isDuplicate(e)) throw e;
      }
    } else if ((await SaveModel.deleteOne(filter)).deletedCount) {
      await PostModel.updateOne({ _id: p._id }, { $inc: { 'counts.saves': -1 } });
    }
    return { saved: on };
  }

  async share(viewer: AuthState, id: string) {
    const p = await this.published(viewer, id);
    await PostModel.updateOne({ _id: p._id }, { $inc: { 'counts.shares': 1 } });
    return { shared: true };
  }

  async vote(viewer: AuthState, id: string, option: number) {
    const p = await this.published(viewer, id);
    if (!p.poll?.closesAt) throw badRequest('This post has no poll');
    if (p.poll.closesAt.getTime() <= Date.now()) throw conflict('This poll has closed');
    if (option >= p.poll.options.length) throw badRequest('Unknown option');
    try {
      await PollVoteModel.create({ postId: p._id, userId: new Types.ObjectId(viewer.userId), option });
    } catch (e) {
      if (isDuplicate(e)) throw conflict('You already voted');
      throw e;
    }
    await PostModel.updateOne({ _id: p._id }, { $inc: { [`poll.options.${option}.votes`]: 1 } });
    return this.get(viewer, id);
  }

  // ── Comments ─────────────────────────────
  private async commentViews(viewer: AuthState, rows: CommentDoc[]): Promise<CommentView[]> {
    const authors = await this.d.profiles.authorsFor(
      viewer,
      rows.map((c) => c.authorId),
    );
    const mod = isModerator(viewer);
    const removals = await this.d.moderation.removalViews(
      'comment',
      rows.filter((c) => mod || String(c.authorId) === viewer.userId) as {
        _id: Types.ObjectId;
        status: string;
        removal?: Removal | null;
      }[],
    );
    return rows.map((c) => ({
      id: String(c._id),
      postId: String(c.postId),
      parentId: c.parentId ? String(c.parentId) : null,
      author: authors.get(String(c.authorId)) ?? {
        userId: String(c.authorId),
        name: '',
        avatarFileId: null,
        roles: [],
        headline: '',
        branch: null,
        gradYear: null,
      },
      body: c.body,
      status: c.status as CommentView['status'],
      isMine: String(c.authorId) === viewer.userId,
      removal: removals.get(String(c._id)) ?? null,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  async comments(viewer: AuthState, postId: string) {
    const p = await this.visible(viewer, postId);
    const mod = isModerator(viewer);
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    const rows = (
      await CommentModel.find({ postId: p._id }).sort({ _id: 1 }).limit(500).lean<CommentDoc[]>()
    ).filter(
      (c) =>
        !hidden.has(String(c.authorId)) &&
        (c.status === 'published' || mod || String(c.authorId) === viewer.userId),
    );
    return this.commentViews(viewer, rows);
  }

  async comment(viewer: AuthState, postId: string, body: string, parentId?: string) {
    const p = await this.published(viewer, postId);
    const text = plainText(body);
    if (!text) throw badRequest('Write a comment');
    let parent: CommentDoc | null = null;
    if (parentId) {
      parent = await CommentModel.findOne({
        _id: parentId,
        postId: p._id,
        parentId: null,
        status: 'published',
      }).lean<CommentDoc>();
      if (!parent) throw badRequest('You can reply to a comment on this post only');
    }
    const c = await CommentModel.create({
      postId: p._id,
      authorId: new Types.ObjectId(viewer.userId),
      parentId: parent?._id ?? null,
      body: text,
    });
    await PostModel.updateOne({ _id: p._id }, { $inc: { 'counts.comments': 1 } });
    const name = (await this.d.profiles.refsFor([viewer.userId])).get(viewer.userId)?.name ?? '';
    const postAuthor = String(p.authorId);
    if (postAuthor !== viewer.userId)
      await this.d.notifications.notify(postAuthor, 'post_comment', { name, postId });
    if (parent && String(parent.authorId) !== viewer.userId && String(parent.authorId) !== postAuthor)
      await this.d.notifications.notify(parent.authorId, 'comment_reply', { name, postId });
    return (await this.commentViews(viewer, [c.toObject() as CommentDoc]))[0] as CommentView;
  }

  async deleteComment(viewer: AuthState, id: string) {
    const c = await CommentModel.findOneAndDelete({ _id: id, authorId: viewer.userId }).lean<CommentDoc>();
    if (!c) throw notFound('Comment');
    const replies = await CommentModel.deleteMany({ parentId: c._id });
    await PostModel.updateOne(
      { _id: c.postId },
      { $inc: { 'counts.comments': -(1 + replies.deletedCount) } },
    );
    return { deleted: true };
  }

  // ── Hooks ─────────────────────────────
  /** Files hook: post media is readable while its post is visible (and by the uploader before posting). */
  async mediaAccess(fileId: string, viewer: AuthState): Promise<{ name: string } | null> {
    const p = await PostModel.findOne({ 'media.fileId': fileId }).select('authorId status').lean<PostDoc>();
    if (!p) return null;
    if (p.status === 'published' || String(p.authorId) === viewer.userId || isModerator(viewer))
      return { name: 'media' };
    return null;
  }

  readonly postHandler = {
    load: async (id: string) => {
      const p = await PostModel.findById(id).lean<PostDoc>();
      return p
        ? {
            authorId: String(p.authorId),
            status: p.status,
            snapshot: [p.body, p.link?.url ?? '', p.media.map((m) => `[${m.kind}: ${m.alt}]`).join(' ')]
              .filter(Boolean)
              .join('\n'),
            context: { postId: String(p._id) },
          }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await PostModel.updateOne(
          { _id: id, status: removal ? 'published' : 'removed' },
          { $set: { status: removal ? 'removed' : 'published', removal } },
        )
      ).modifiedCount > 0,
  };

  readonly commentHandler = {
    load: async (id: string) => {
      const c = await CommentModel.findById(id).lean<CommentDoc>();
      return c
        ? {
            authorId: String(c.authorId),
            status: c.status,
            snapshot: c.body,
            context: { postId: String(c.postId) },
          }
        : null;
    },
    setRemoved: async (id: string, removal: Removal | null) =>
      (
        await CommentModel.updateOne(
          { _id: id, status: removal ? 'published' : 'removed' },
          { $set: { status: removal ? 'removed' : 'published', removal } },
        )
      ).modifiedCount > 0,
  };

  async search(viewer: AuthState, text: string) {
    if (text.length < 3) return [];
    const hidden = await this.d.safety.hiddenFor(viewer.userId);
    const rows = (
      await withTextSearch(PostModel.find({ status: 'published' }), text)
        .limit(10)
        .lean<PostDoc[]>()
    ).filter((p) => !hidden.has(String(p.authorId)));
    return this.views(viewer, rows.slice(0, 5));
  }

  /** Feed candidates (ranking lives in FeedService). */
  async recent(since: Date, until: Date, limit: number, filter: Record<string, unknown> = {}) {
    return PostModel.find({ status: 'published', createdAt: { $gte: since, $lte: until }, ...filter })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<PostDoc[]>();
  }

  async byIds(ids: string[]) {
    return PostModel.find({ _id: { $in: ids }, status: 'published' }).lean<PostDoc[]>();
  }

  /** Analytics: published posts per author since a date. */
  async countByAuthorSince(since: Date) {
    const rows = await PostModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { status: 'published', createdAt: { $gte: since } } },
      { $group: { _id: '$authorId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  }
}
