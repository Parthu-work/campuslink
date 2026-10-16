/**
 * MANDATORY tenant-isolation suite for Phase 4: posts, comments, reactions, saves, poll votes,
 * stories, follows, One Useful Thing, questions, answers, answer votes, content sources and items,
 * moderation actions and appeals, plus post and story media. Every cross-tenant read, write,
 * update, delete and search must fail. Blocks CI.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Model } from 'mongoose';
import {
  api,
  jpegWithExif,
  makeTenant,
  makeUser,
  testApp,
  type TestTenant,
  type TestUser,
} from '../helpers.js';
import { fakeFetcher, rss } from '../feed-fixtures.js';
import { runInTenant } from '../../src/lib/context.js';
import {
  CommentModel,
  PollVoteModel,
  PostModel,
  ReactionModel,
  SaveModel,
} from '../../src/modules/feed/post.model.js';
import { FollowModel, OneUsefulThingModel, StoryModel } from '../../src/modules/feed/story.model.js';
import { AnswerModel, AnswerVoteModel, QuestionModel } from '../../src/modules/qa/question.model.js';
import { ContentItemModel, ContentSourceModel } from '../../src/modules/content-sources/source.model.js';
import { AppealModel, ModerationActionModel } from '../../src/modules/moderation/moderation.model.js';

const FEED = 'https://alpha-news.example.org/rss';
const fake = fakeFetcher({
  'https://alpha-news.example.org/robots.txt': { status: 404 },
  [FEED]: {
    body: rss([
      {
        title: 'Alpha-only campus headline',
        link: 'https://alpha-news.example.org/1',
        description: 'Alpha snippet',
      },
    ]),
  },
});
const ctx = testApp({ fetcher: fake.fn });
let A: TestTenant, B: TestTenant;
let alumA: TestUser, studentA: TestUser, modA: TestUser, adminA: TestUser;
let alumB: TestUser, studentB: TestUser, modB: TestUser, adminB: TestUser;
let postA: string,
  pollA: string,
  removedA: string,
  commentA: string,
  storyA: string,
  photoA: string,
  storyFileA: string;
let questionA: string, answerA: string, sourceA: string, itemA: string, appealA: string;
const a = (u: TestUser) => api(ctx, A.host, u.token);
const inB = (u: TestUser) => api(ctx, B.host, u.token);

beforeAll(async () => {
  A = await makeTenant('isofeeda');
  B = await makeTenant('isofeedb');
  [alumA, studentA, modA, adminA] = [
    await makeUser(ctx, A, { roles: ['ALUMNI'] }),
    await makeUser(ctx, A, { roles: ['STUDENT'] }),
    await makeUser(ctx, A, { roles: ['FACULTY'] }),
    await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true }),
  ];
  [alumB, studentB, modB, adminB] = [
    await makeUser(ctx, B, { roles: ['ALUMNI'] }),
    await makeUser(ctx, B, { roles: ['STUDENT'] }),
    await makeUser(ctx, B, { roles: ['FACULTY'] }),
    await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true }),
  ];
  const ok = <T extends { status: number; body: { data: unknown } }>(r: T, status = 201) => {
    if (r.status !== status) throw new Error(JSON.stringify(r.body));
    return r.body.data as { id: string; [k: string]: unknown };
  };
  postA = ok(
    await a(alumA)
      .post('/posts')
      .send({ kind: 'text', body: 'Zyxquark alpha-only post #alphatag', topics: ['dsa'] }),
  ).id;
  pollA = ok(
    await a(alumA)
      .post('/posts')
      .send({ kind: 'poll', body: 'Alpha poll?', poll: { options: ['One', 'Two'], closesInDays: 2 } }),
  ).id;
  const img = ok(
    await a(alumA)
      .post('/media/images')
      .attach('file', await jpegWithExif(), 'a.jpg'),
  );
  photoA = img.id;
  ok(
    await a(alumA)
      .post('/posts')
      .send({ kind: 'photo', media: [{ fileId: photoA, alt: 'Alpha lab' }] }),
  );
  const sImg = ok(
    await a(alumA)
      .post('/media/images')
      .field('for', 'story')
      .attach('file', await jpegWithExif(), 's.jpg'),
  );
  storyFileA = sImg.id;
  storyA = ok(
    await a(alumA).post('/stories').send({ kind: 'photo', fileId: storyFileA, alt: 'Alpha story' }),
  ).id;
  ok(await a(studentA).post(`/posts/${postA}/reactions`).send({ reaction: 'helpful' }), 200);
  ok(await a(studentA).post(`/posts/${postA}/save`).send({}), 200);
  ok(await a(studentA).post(`/posts/${pollA}/vote`).send({ option: 0 }), 200);
  commentA = ok(await a(studentA).post(`/posts/${postA}/comments`).send({ body: 'Alpha comment' })).id;
  ok(await a(studentA).post('/follows').send({ targetType: 'user', targetId: alumA.id }), 200);
  ok(await a(modA).post('/feed/one-useful-thing').send({ targetType: 'post', targetId: postA }), 200);
  questionA = ok(
    await a(studentA).post('/questions').send({ title: 'Zyxquark alpha-only question here?' }),
  ).id;
  ok(
    await a(modA).post(`/admin/moderation/questions/${questionA}/decision`).send({ decision: 'approve' }),
    200,
  );
  answerA = ok(
    await a(alumA).post(`/questions/${questionA}/answers`).send({ body: 'Alpha answer with detail' }),
  ).id;
  ok(await a(modA).post(`/answers/${answerA}/helpful`).send({}), 200);
  sourceA = ok(await a(adminA).post('/admin/sources').send({ name: 'Alpha news', url: FEED })).id;
  await ctx.queue.drain();
  itemA = String((await runInTenant(A._id, () => ContentItemModel.findOne({}).lean()))?._id);
  ok(await a(studentA).post('/follows').send({ targetType: 'source', targetId: sourceA }), 200);
  removedA = ok(await a(alumA).post('/posts').send({ kind: 'text', body: 'Alpha post to remove' })).id;
  ok(
    await a(modA)
      .post('/admin/moderation/actions')
      .send({ targetType: 'post', targetId: removedA, action: 'remove', reason: 'spam' }),
    200,
  );
  appealA = ok(
    await a(alumA)
      .post('/appeals')
      .send({ targetType: 'post', targetId: removedA, message: 'Alpha appeal message text' }),
  ).id;
  // B has its own content so empty results are meaningful.
  ok(await inB(alumB).post('/posts').send({ kind: 'text', body: 'Beta post' }));
  ok(await inB(alumB).post('/stories').send({ kind: 'text', text: 'Beta story', background: 'brand' }));
});

describe('HTTP: nothing of college A is reachable from college B', () => {
  it('posts, polls and interactions', async () => {
    for (const [m, p, body] of [
      ['get', `/posts/${postA}`, undefined],
      ['get', `/posts/${postA}/comments`, undefined],
      ['post', `/posts/${postA}/reactions`, { reaction: 'celebrate' }],
      ['post', `/posts/${postA}/save`, {}],
      ['post', `/posts/${postA}/share`, {}],
      ['post', `/posts/${postA}/comments`, { body: 'from B' }],
      ['post', `/posts/${pollA}/vote`, { option: 1 }],
      ['delete', `/posts/${postA}`, undefined],
      ['delete', `/comments/${commentA}`, undefined],
      ['delete', `/posts/${postA}/save`, undefined],
    ] as const) {
      const c = inB(m === 'delete' && p.startsWith('/posts/') && !p.endsWith('save') ? alumB : studentB);
      const res =
        m === 'get' ? await c.get(p) : m === 'delete' ? await c.delete(p) : await c.post(p).send(body ?? {});
      expect(res.status, `${m} ${p}`).toBe(404);
    }
    const feed = JSON.stringify((await inB(studentB).get('/feed?limit=30')).body.data);
    expect(feed).not.toContain(postA);
    expect(feed).not.toContain('alpha');
    expect((await inB(studentB).get(`/posts?author=${alumA.id}`)).body.data).toEqual([]);
    expect((await inB(studentB).get('/posts?saved=true')).body.data).toEqual([]);
    expect((await inB(studentB).get('/posts?topic=dsa')).body.data).toEqual([]);
    // A's counts are untouched.
    expect((await a(studentA).get(`/posts/${postA}`)).body.data.counts).toMatchObject({
      reactions: { helpful: 1, celebrate: 0 },
      comments: 1,
      saves: 1,
      shares: 0,
    });
  });

  it('media files and stories', async () => {
    expect((await inB(studentB).get(`/files/${photoA}`)).status).toBe(404);
    expect((await inB(studentB).get(`/files/${storyFileA}`)).status).toBe(404);
    expect(
      (
        await inB(alumB)
          .post('/posts')
          .send({ kind: 'photo', media: [{ fileId: photoA, alt: 'steal' }] })
      ).status,
    ).toBe(400);
    expect(
      (await inB(alumB).post('/stories').send({ kind: 'photo', fileId: storyFileA, alt: 'steal' })).status,
    ).toBe(400);
    expect((await inB(studentB).get('/stories')).body.data.map((s: { id: string }) => s.id)).not.toContain(
      storyA,
    );
    expect((await inB(alumB).delete(`/stories/${storyA}`)).status).toBe(404);
  });

  it('follows, suggestions and One Useful Thing', async () => {
    expect(
      (await inB(studentB).post('/follows').send({ targetType: 'user', targetId: alumA.id })).status,
    ).toBe(404);
    expect(
      (await inB(studentB).post('/follows').send({ targetType: 'source', targetId: sourceA })).status,
    ).toBe(404);
    expect((await inB(studentB).get('/me/follows')).body.data).toEqual({
      users: [],
      topics: [],
      sources: [],
    });
    const sug = JSON.stringify((await inB(studentB).get('/feed/suggestions')).body.data);
    expect(sug).not.toContain(alumA.id);
    expect(sug).not.toContain(sourceA);
    const out = (await inB(studentB).get('/feed/one-useful-thing')).body.data;
    expect(JSON.stringify(out ?? {})).not.toContain(postA);
    expect(
      (await inB(modB).post('/feed/one-useful-thing').send({ targetType: 'post', targetId: postA })).status,
    ).toBe(404);
    expect(
      (await inB(modB).post('/feed/one-useful-thing').send({ targetType: 'item', targetId: itemA })).status,
    ).toBe(404);
  });

  it('questions and answers', async () => {
    expect((await inB(studentB).get(`/questions/${questionA}`)).status).toBe(404);
    expect(
      (await inB(alumB).post(`/questions/${questionA}/answers`).send({ body: 'Answer from beta college' }))
        .status,
    ).toBe(404);
    expect(
      (await inB(studentB).post(`/questions/${questionA}/accept`).send({ answerId: answerA })).status,
    ).toBe(404);
    expect((await inB(studentB).post(`/answers/${answerA}/helpful`).send({})).status).toBe(404);
    expect((await inB(studentB).delete(`/answers/${answerA}/helpful`)).status).toBe(404);
    expect((await inB(alumB).delete(`/answers/${answerA}`)).status).toBe(404);
    expect((await inB(studentB).delete(`/questions/${questionA}`)).status).toBe(409);
    expect((await inB(studentB).get('/questions')).body.data).toEqual([]);
    expect((await inB(modB).get('/admin/moderation/questions')).body.data).toEqual([]);
    expect(
      (
        await inB(modB)
          .post(`/admin/moderation/questions/${questionA}/decision`)
          .send({ decision: 'reject', reason: 'spam' })
      ).status,
    ).toBe(404);
  });

  it('search', async () => {
    const r = (await inB(studentB).get('/search?q=Zyxquark')).body.data;
    expect(r.posts).toEqual([]);
    expect(r.questions).toEqual([]);
    expect((await a(studentA).get('/search?q=Zyxquark')).body.data.posts).toHaveLength(1);
  });

  it('content sources and items', async () => {
    expect((await inB(adminB).get('/admin/sources')).body.data).toEqual([]);
    expect((await inB(studentB).get('/sources')).body.data).toEqual([]);
    expect((await inB(adminB).patch(`/admin/sources/${sourceA}`).send({ status: 'paused' })).status).toBe(
      404,
    );
    expect((await inB(adminB).post(`/admin/sources/${sourceA}/fetch`).send({})).status).toBe(404);
    expect((await inB(adminB).delete(`/admin/sources/${sourceA}`)).status).toBe(404);
    expect(JSON.stringify((await inB(studentB).get('/feed?limit=30')).body.data)).not.toContain(itemA);
    expect(
      (await inB(modB).post(`/admin/moderation/items/${itemA}/decision`).send({ decision: 'reject' })).status,
    ).toBe(404);
    // The same feed URL is a separate source in B.
    expect((await inB(adminB).post('/admin/sources').send({ name: 'Alpha news', url: FEED })).status).toBe(
      201,
    );
  });

  it('moderation, reports and appeals', async () => {
    for (const [type, id] of [
      ['post', postA],
      ['comment', commentA],
      ['question', questionA],
      ['answer', answerA],
      ['story', storyA],
      ['item', itemA],
    ] as const) {
      expect(
        (
          await inB(modB)
            .post('/admin/moderation/actions')
            .send({ targetType: type, targetId: id, action: 'remove', reason: 'spam' })
        ).status,
        type,
      ).toBe(404);
      if (type !== 'item')
        expect(
          (await inB(studentB).post('/reports').send({ targetType: type, targetId: id, reason: 'spam' }))
            .status,
          type,
        ).toBe(404);
      expect((await inB(modB).get(`/admin/moderation/history/${type}/${id}`)).body.data).toEqual([]);
    }
    expect(
      (
        await inB(modB)
          .post(`/admin/moderation/actions`)
          .send({ targetType: 'post', targetId: removedA, action: 'restore' })
      ).status,
    ).toBe(404);
    expect((await inB(modB).get('/admin/moderation/appeals')).body.data).toEqual([]);
    expect(
      (await inB(modB).post(`/admin/moderation/appeals/${appealA}/decision`).send({ decision: 'reverse' }))
        .status,
    ).toBe(404);
    expect(
      (
        await inB(alumB)
          .post('/appeals')
          .send({ targetType: 'post', targetId: removedA, message: 'Appeal from B college' })
      ).status,
    ).toBe(404);
    expect((await inB(modB).get('/admin/moderation/summary')).body.data).toMatchObject({
      heldItems: 0,
      pendingQuestions: 0,
      appeals: 0,
    });
    expect((await a(alumA).get(`/posts/${removedA}`)).body.data.status).toBe('removed');
  });

  it('a token from A never works on B', async () => {
    const r = await api(ctx, B.host, studentA.token).get('/feed');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });
});

describe('database layer: every Phase 4 collection is scoped', () => {
  const MODELS: [string, Model<unknown>][] = [
    ['Post', PostModel as Model<unknown>],
    ['Comment', CommentModel as Model<unknown>],
    ['Reaction', ReactionModel as Model<unknown>],
    ['SavedPost', SaveModel as Model<unknown>],
    ['PollVote', PollVoteModel as Model<unknown>],
    ['Story', StoryModel as Model<unknown>],
    ['Follow', FollowModel as Model<unknown>],
    ['OneUsefulThing', OneUsefulThingModel as Model<unknown>],
    ['Question', QuestionModel as Model<unknown>],
    ['Answer', AnswerModel as Model<unknown>],
    ['AnswerVote', AnswerVoteModel as Model<unknown>],
    ['ContentSource', ContentSourceModel as Model<unknown>],
    ['ContentItem', ContentItemModel as Model<unknown>],
    ['Appeal', AppealModel as Model<unknown>],
  ];
  const ALL: [string, Model<unknown>][] = [
    ...MODELS,
    ['ModerationAction', ModerationActionModel as Model<unknown>],
  ];

  it.each(MODELS)('%s: B cannot read, search, update or delete A’s documents', async (_name, model) => {
    const docA = await runInTenant(A._id, () => model.findOne({}).select('_id').lean<{ _id: unknown }>());
    expect(docA, 'fixture created a document in A').toBeTruthy();
    const id = docA?._id;
    await runInTenant(B._id, async () => {
      expect(await model.findById(id).lean()).toBeNull();
      expect(await model.findOne({ _id: id }).lean()).toBeNull();
      expect(await model.countDocuments({ _id: id })).toBe(0);
      expect((await model.updateOne({ _id: id }, { $set: { updatedAt: new Date(0) } })).matchedCount).toBe(0);
      await model.updateMany({}, { $set: { updatedAt: new Date(0) } });
      expect((await model.deleteOne({ _id: id })).deletedCount).toBe(0);
    });
    const after = await runInTenant(A._id, () =>
      model.findById(id).select('updatedAt').lean<{ updatedAt: Date }>(),
    );
    expect(after?.updatedAt.getTime()).not.toBe(0);
  });

  it('ModerationAction: B cannot read A’s log (and nobody can change it)', async () => {
    const docA = await runInTenant(A._id, () => ModerationActionModel.findOne({}).select('_id').lean());
    expect(docA).toBeTruthy();
    await runInTenant(B._id, async () => {
      expect(await ModerationActionModel.findById(docA?._id).lean()).toBeNull();
      expect(await ModerationActionModel.countDocuments({ _id: docA?._id })).toBe(0);
    });
  });

  it.each(ALL)('%s: no tenant context, no access', async (_name, model) => {
    await expect(model.findOne({})).rejects.toThrow(/tenant context/i);
  });
});
