import { z } from 'zod';
import {
  FOLLOW_TARGETS,
  IMAGE_MAX_BYTES,
  REEL_MAX_BYTES,
  REEL_MAX_SECONDS,
  commentBody,
  createPostBody,
  featureBody,
  feedQuery,
  followBody,
  postsQuery,
  reactBody,
  storyBody,
  voteBody,
} from '@campuslink/shared';
import type { AnyRouteSpec } from '../../http/registry.js';
import { idParams } from '../../http/validation.js';
import { authOf, tenantOf } from '../../http/request-context.js';
import { badRequest } from '../../lib/errors.js';
import type { FilesService } from '../files/files.service.js';
import type { PostsService } from './posts.service.js';
import type { FeedService } from './feed.service.js';
import type { FollowsService, OneUsefulThingService, StoriesService } from './social.service.js';
import type { ContentSourcesService } from '../content-sources/sources.service.js';

const READ = { kind: 'permission', permission: 'feed:read' } as const;
const POST = { kind: 'permission', permission: 'feed:post' } as const;
const INTERACT = { kind: 'permission', permission: 'feed:interact' } as const;
const FOLLOW = { kind: 'permission', permission: 'sources:follow' } as const;
const tag = 'Feed';

export function feedRoutes(s: {
  posts: PostsService;
  feed: FeedService;
  follows: FollowsService;
  stories: StoriesService;
  out: OneUsefulThingService;
  files: FilesService;
  sources: ContentSourcesService;
}): AnyRouteSpec[] {
  return [
    // ── Feed ─────────────────────────────
    {
      method: 'get',
      path: '/feed',
      tag,
      summary: 'For You (ranked, see docs/feed-ranking.md) or Following (newest first)',
      access: READ,
      query: feedQuery,
      handler: async ({ req, query }) => {
        const r = await s.feed.feed(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'get',
      path: '/feed/one-useful-thing',
      tag,
      summary: 'Today’s One Useful Thing (staff pick, else computed)',
      access: READ,
      handler: async ({ req }) => ({ data: await s.out.get(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/feed/one-useful-thing',
      tag,
      summary: 'Feature a post or item as today’s One Useful Thing',
      access: { kind: 'permission', permission: 'announcements:post' },
      body: featureBody,
      handler: async ({ req, body }) => ({
        data: await s.out.feature(authOf(req), body.targetType, body.targetId),
      }),
    },
    {
      method: 'get',
      path: '/feed/suggestions',
      tag,
      summary: 'People and sources to follow',
      access: READ,
      handler: async ({ req }) => ({ data: await s.follows.suggestions(authOf(req)) }),
    },
    // ── Posts ─────────────────────────────
    {
      method: 'get',
      path: '/posts',
      tag,
      summary: 'Posts by author, kind (reels), topic, or my saved posts',
      access: READ,
      query: postsQuery,
      handler: async ({ req, query }) => {
        const r = await s.posts.list(authOf(req), query);
        return { data: r.items, meta: { nextCursor: r.nextCursor } };
      },
    },
    {
      method: 'post',
      path: '/posts',
      tag,
      summary: 'Publish a post (text, photos, reel, poll or link)',
      access: POST,
      limiter: 'posting',
      bot: true,
      idempotent: true,
      body: createPostBody,
      handler: async ({ req, body }) => ({ status: 201, data: await s.posts.create(authOf(req), body) }),
    },
    {
      method: 'get',
      path: '/posts/:id',
      tag,
      summary: 'One post',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.posts.get(authOf(req), params.id) }),
    },
    {
      method: 'delete',
      path: '/posts/:id',
      tag,
      summary: 'Delete my post (with its comments and media)',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.posts.remove(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/posts/:id/reactions',
      tag,
      summary: 'React (helpful, insightful, celebrate) or clear my reaction',
      access: INTERACT,
      limiter: 'interact',
      params: idParams,
      body: reactBody,
      handler: async ({ req, params, body }) => ({
        data: await s.posts.react(authOf(req), params.id, body.reaction),
      }),
    },
    {
      method: 'post',
      path: '/posts/:id/save',
      tag,
      summary: 'Save a post',
      access: INTERACT,
      limiter: 'interact',
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.posts.save(authOf(req), params.id, true) }),
    },
    {
      method: 'delete',
      path: '/posts/:id/save',
      tag,
      summary: 'Unsave a post',
      access: INTERACT,
      limiter: 'interact',
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.posts.save(authOf(req), params.id, false) }),
    },
    {
      method: 'post',
      path: '/posts/:id/share',
      tag,
      summary: 'Count a share within the college',
      access: INTERACT,
      limiter: 'interact',
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.posts.share(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/posts/:id/vote',
      tag,
      summary: 'Vote in a poll (once)',
      access: INTERACT,
      limiter: 'interact',
      params: idParams,
      body: voteBody,
      handler: async ({ req, params, body }) => ({
        data: await s.posts.vote(authOf(req), params.id, body.option),
      }),
    },
    {
      method: 'get',
      path: '/posts/:id/comments',
      tag,
      summary: 'Comments on a post',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.posts.comments(authOf(req), params.id) }),
    },
    {
      method: 'post',
      path: '/posts/:id/comments',
      tag,
      summary: 'Comment, or reply to a comment',
      access: INTERACT,
      limiter: 'interact',
      params: idParams,
      body: commentBody,
      handler: async ({ req, params, body }) => ({
        status: 201,
        data: await s.posts.comment(authOf(req), params.id, body.body, body.parentId),
      }),
    },
    {
      method: 'delete',
      path: '/comments/:id',
      tag,
      summary: 'Delete my comment',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.posts.deleteComment(authOf(req), params.id) }),
    },
    // ── Media (upload first, attach on post) ─────────────────────────────
    {
      method: 'post',
      path: '/media/images',
      tag,
      summary: 'Upload a photo for a post or story (re-encoded, metadata removed)',
      access: POST,
      limiter: 'upload',
      upload: { field: 'file', maxBytes: IMAGE_MAX_BYTES },
      body: z.strictObject({ for: z.enum(['post', 'story']).default('post') }),
      handler: async ({ req, body, file }) => {
        if (!file) throw badRequest('Choose an image');
        const f = await s.files.storeImage(
          authOf(req).userId,
          body.for === 'story' ? 'story_media' : 'post_media',
          file.buffer,
        );
        return { status: 201, data: f };
      },
    },
    {
      method: 'post',
      path: '/media/videos',
      tag,
      summary: `Upload a Tips reel video (MP4/MOV, up to ${REEL_MAX_SECONDS} s, metadata removed)`,
      access: POST,
      limiter: 'upload',
      upload: { field: 'file', maxBytes: REEL_MAX_BYTES },
      handler: async ({ req, file }) => {
        if (!file) throw badRequest('Choose a video');
        return {
          status: 201,
          data: await s.files.storeVideo(authOf(req).userId, file.buffer, REEL_MAX_SECONDS),
        };
      },
    },
    // ── Stories ─────────────────────────────
    {
      method: 'get',
      path: '/stories',
      tag,
      summary: 'Live stories (24 hours)',
      access: READ,
      handler: async ({ req }) => ({ data: await s.stories.list(authOf(req)) }),
    },
    {
      method: 'post',
      path: '/stories',
      tag,
      summary: 'Post a 24-hour story',
      access: POST,
      limiter: 'posting',
      bot: true,
      body: storyBody,
      handler: async ({ req, body }) => ({
        status: 201,
        data: await s.stories.create(authOf(req), tenantOf(req), body),
      }),
    },
    {
      method: 'delete',
      path: '/stories/:id',
      tag,
      summary: 'Delete my story',
      access: READ,
      params: idParams,
      handler: async ({ req, params }) => ({ data: await s.stories.remove(authOf(req), params.id) }),
    },
    // ── Follows & sources ─────────────────────────────
    {
      method: 'get',
      path: '/me/follows',
      tag,
      summary: 'People, topics and sources I follow',
      access: FOLLOW,
      handler: async ({ req }) => ({ data: await s.follows.state(authOf(req).userId) }),
    },
    {
      method: 'post',
      path: '/follows',
      tag,
      summary: 'Follow a person, topic or source',
      access: FOLLOW,
      limiter: 'interact',
      body: followBody,
      handler: async ({ req, body }) => ({ data: await s.follows.follow(authOf(req), body) }),
    },
    {
      method: 'delete',
      path: '/follows/:targetType/:targetId',
      tag,
      summary: 'Unfollow',
      access: FOLLOW,
      params: z.strictObject({
        targetType: z.enum(FOLLOW_TARGETS),
        targetId: z.string().regex(/^[a-z0-9-]{2,40}$/),
      }),
      handler: async ({ req, params }) => ({
        data: await s.follows.unfollow(authOf(req), params.targetType, params.targetId),
      }),
    },
    {
      method: 'get',
      path: '/sources',
      tag,
      summary: 'Content sources you can follow',
      access: FOLLOW,
      handler: async () => ({ data: await s.sources.publicList() }),
    },
  ];
}
