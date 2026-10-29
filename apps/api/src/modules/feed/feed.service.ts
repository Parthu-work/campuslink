import { Types } from 'mongoose';
import type { z } from 'zod';
import type { FeedEntry, feedQuery } from '@campuslink/shared';
import type { PostDoc } from './post.model.js';
import type { ItemDoc } from '../content-sources/source.model.js';
import type { PostRankFields, PostsService } from './posts.service.js';
import type { FollowsService } from './social.service.js';
import type { ContentSourcesService } from '../content-sources/sources.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { SafetyService } from '../moderation/safety.service.js';
import { badRequest } from '../../lib/errors.js';
import type { AuthState } from '../../types.js';
import { featureEnabled } from '../tenants/features.js';

const HOUR = 3600_000;
const POST_WINDOW = 14 * 24 * HOUR;
const ITEM_WINDOW = 7 * 24 * HOUR;

/** Ranking inputs for one candidate (documented in docs/feed-ranking.md). */
export interface RankInput {
  createdAt: Date;
  followedAuthor: boolean;
  followedSource: boolean;
  topicMatches: number;
  branchMatch: boolean;
  alumniAuthor: boolean;
  announcement: boolean;
  /** reactions + 2 × comments + saves (shares are excluded: too easy to inflate). */
  engagement: number;
}

/**
 * score = recency × boost
 *   recency = 0.5 ^ (age in hours / 24)               (half-life of one day)
 *   boost   = 1 + 1.0·followed author + 0.8·followed source + 0.3·min(3, topic matches)
 *             + 0.3·branch match + 0.25·alumni author + 0.5·official announcement
 *             + 0.15·ln(1 + engagement)
 */
export function rankScore(c: RankInput, asOf: Date): number {
  const ageH = Math.max(0, (asOf.getTime() - c.createdAt.getTime()) / HOUR);
  const recency = 0.5 ** (ageH / 24);
  const boost =
    1 +
    (c.followedAuthor ? 1 : 0) +
    (c.followedSource ? 0.8 : 0) +
    0.3 * Math.min(3, c.topicMatches) +
    (c.branchMatch ? 0.3 : 0) +
    (c.alumniAuthor ? 0.25 : 0) +
    (c.announcement ? 0.5 : 0) +
    0.15 * Math.log1p(Math.max(0, c.engagement));
  return recency * boost;
}

/** Opaque cursor: the ranking snapshot time and an offset, so pages stay stable while scrolling. */
export const encodeCursor = (c: { a: number; o: number }) =>
  Buffer.from(JSON.stringify(c)).toString('base64url');
export function decodeCursor(raw: string | undefined): { a: number; o: number } | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { a?: unknown; o?: unknown };
    if (typeof c.a !== 'number' || typeof c.o !== 'number' || c.o < 0 || c.o > 2000 || !Number.isFinite(c.a))
      return null;
    return { a: c.a, o: Math.floor(c.o) };
  } catch {
    return null;
  }
}

type Candidate =
  | { kind: 'post'; doc: PostDoc; at: Date; score: number }
  | { kind: 'item'; doc: ItemDoc; at: Date; score: number };
type Ranked =
  | { kind: 'post'; doc: PostRankFields; at: Date; score: number }
  | { kind: 'item'; doc: ItemDoc; at: Date; score: number };

/** Feature switches that shape the feed (B1): reels and outside content leave it while off. */
async function switches() {
  const [reels, outside] = await Promise.all([featureEnabled('reels'), featureEnabled('contentSources')]);
  return { postFilter: reels ? {} : { kind: { $ne: 'reel' } }, outside };
}

export class FeedService {
  constructor(
    private readonly d: {
      posts: PostsService;
      follows: FollowsService;
      sources: ContentSourcesService;
      profiles: ProfilesService;
      safety: SafetyService;
    },
  ) {}

  async feed(viewer: AuthState, q: z.output<typeof feedQuery>) {
    return q.tab === 'following'
      ? this.following(viewer, q.cursor, q.limit)
      : this.forYou(viewer, q.cursor, q.limit);
  }

  private async hydrate(viewer: AuthState, page: Candidate[]): Promise<FeedEntry[]> {
    const posts = page.filter((c): c is Extract<Candidate, { kind: 'post' }> => c.kind === 'post');
    const items = page.filter((c): c is Extract<Candidate, { kind: 'item' }> => c.kind === 'item');
    const [postViews, itemViews] = await Promise.all([
      this.d.posts.views(
        viewer,
        posts.map((p) => p.doc),
      ),
      this.d.sources.itemViews(items.map((i) => i.doc)),
    ]);
    const pv = new Map(postViews.map((p) => [p.id, p]));
    const iv = new Map(itemViews.map((i) => [i.id, i]));
    return page.flatMap((c): FeedEntry[] => {
      const id = String(c.doc._id);
      if (c.kind === 'post') {
        const post = pv.get(id);
        return post ? [{ type: 'post', post }] : [];
      }
      const item = iv.get(id);
      return item ? [{ type: 'item', item }] : [];
    });
  }

  async forYou(viewer: AuthState, cursor: string | undefined, limit: number) {
    const c = decodeCursor(cursor);
    if (cursor && !c) throw badRequest('Invalid cursor');
    const asOf = new Date(c?.a ?? Date.now());
    const offset = c?.o ?? 0;
    const [follows, own, hidden] = await Promise.all([
      this.d.follows.state(viewer.userId),
      this.d.profiles.own(viewer.userId),
      this.d.safety.hiddenFor(viewer.userId),
    ]);
    // Members under 18 get a chronological For you: no personalised ranking (B2).
    const rank: typeof rankScore = viewer.minor ? () => 0 : rankScore;
    const followedUsers = new Set(follows.users);
    const followedSources = new Set(follows.sources);
    const interests = new Set<string>([...follows.topics]);
    const { postFilter, outside } = await switches();
    const [posts, items] = await Promise.all([
      this.d.posts.rankingCandidates(new Date(asOf.getTime() - POST_WINDOW), asOf, 400, postFilter),
      !outside
        ? Promise.resolve([] as ItemDoc[])
        : this.d.sources.recentItems({
            since: new Date(asOf.getTime() - ITEM_WINDOW),
            until: asOf,
            limit: 300,
            // No follows yet: sample every active source so the feed is never empty.
            ...(follows.sources.length || follows.topics.length
              ? { sourceIds: follows.sources, topics: follows.topics }
              : {}),
          }),
    ]);
    const candidates: Ranked[] = [
      ...posts
        .filter((p) => !hidden.has(String(p.authorId)))
        .map((p): Ranked => {
          const counts = p.counts ?? { helpful: 0, insightful: 0, celebrate: 0, comments: 0, saves: 0 };
          return {
            kind: 'post',
            doc: p,
            at: p.createdAt,
            score: rank(
              {
                createdAt: p.createdAt,
                followedAuthor: followedUsers.has(String(p.authorId)),
                followedSource: false,
                topicMatches: p.topics.filter((t) => interests.has(t)).length,
                branchMatch: !!own.branch && p.authorBranch === own.branch,
                alumniAuthor: p.authorAlumni,
                announcement: p.announcement,
                engagement:
                  (counts.helpful ?? 0) +
                  (counts.insightful ?? 0) +
                  (counts.celebrate ?? 0) +
                  2 * (counts.comments ?? 0) +
                  (counts.saves ?? 0),
              },
              asOf,
            ),
          };
        }),
      ...items.map((i): Ranked => ({
        kind: 'item',
        doc: i,
        at: i.publishedAt,
        score: rank(
          {
            createdAt: i.publishedAt,
            followedAuthor: false,
            followedSource: followedSources.has(String(i.sourceId)),
            topicMatches: i.topics.filter((t) => interests.has(t)).length,
            branchMatch: !!own.branch && (i.branches as string[]).includes(own.branch),
            alumniAuthor: false,
            announcement: false,
            engagement: 0,
          },
          asOf,
        ),
      })),
    ];
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        b.at.getTime() - a.at.getTime() ||
        String(b.doc._id).localeCompare(String(a.doc._id)),
    );
    const ranked = candidates.slice(offset, offset + limit);
    const next =
      offset + limit < candidates.length ? encodeCursor({ a: asOf.getTime(), o: offset + limit }) : null;
    // Full posts only for the page being returned.
    const full = new Map(
      (await this.d.posts.byIds(ranked.filter((r) => r.kind === 'post').map((r) => String(r.doc._id)))).map(
        (p) => [String(p._id), p],
      ),
    );
    const page = ranked.flatMap((r): Candidate[] => {
      if (r.kind === 'item') return [r];
      const doc = full.get(String(r.doc._id));
      return doc ? [{ ...r, doc }] : [];
    });
    return { items: await this.hydrate(viewer, page), nextCursor: next };
  }

  /** Following: newest first from people, topics and sources you follow (and your own posts). */
  async following(viewer: AuthState, cursor: string | undefined, limit: number) {
    const before = cursor ? new Date(Number(cursor)) : new Date();
    if (Number.isNaN(before.getTime())) throw badRequest('Invalid cursor');
    const [follows, hidden] = await Promise.all([
      this.d.follows.state(viewer.userId),
      this.d.safety.hiddenFor(viewer.userId),
    ]);
    const authors = [viewer.userId, ...follows.users].map((u) => new Types.ObjectId(u));
    const or: Record<string, unknown>[] = [{ authorId: { $in: authors } }];
    if (follows.topics.length) or.push({ topics: { $in: follows.topics } });
    const until = new Date(before.getTime() - 1);
    const { postFilter, outside } = await switches();
    const [posts, items] = await Promise.all([
      this.d.posts.recent(new Date(0), until, limit + 1, { $or: or, ...postFilter }),
      outside && (follows.sources.length || follows.topics.length)
        ? this.d.sources.recentItems({
            since: new Date(0),
            until,
            limit: limit + 1,
            sourceIds: follows.sources,
            topics: follows.topics,
          })
        : Promise.resolve([] as ItemDoc[]),
    ]);
    const merged: Candidate[] = [
      ...posts
        .filter((p) => !hidden.has(String(p.authorId)))
        .map((p): Candidate => ({ kind: 'post', doc: p, at: p.createdAt, score: 0 })),
      ...items.map((i): Candidate => ({ kind: 'item', doc: i, at: i.publishedAt, score: 0 })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    const page = merged.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await this.hydrate(viewer, page),
      nextCursor: merged.length > limit && last ? String(last.at.getTime()) : null,
    };
  }
}
