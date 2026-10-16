import { beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  jpegWithExif,
  makeTenant,
  makeUser,
  testApp,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { fakeFetcher, fakeMp4 } from './feed-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { invalidateTenant } from '../src/modules/tenants/tenant.cache.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { PostModel } from '../src/modules/feed/post.model.js';
import { decodeCursor, encodeCursor, rankScore } from '../src/modules/feed/feed.service.js';

const page = `<!doctype html><html><head>
  <meta property="og:title" content="Placement prep guide &amp; checklist">
  <meta property="og:description" content="Ten things to do before campus drives.">
  <meta property="og:site_name" content="Demo Careers">
  <meta property="og:image" content="https://cdn.example.org/tracker.png">
  <script>alert(1)</script></head><body>hi</body></html>`;
const fake = fakeFetcher({
  'https://careers.example.org/guide': { body: page, contentType: 'text/html; charset=utf-8' },
});
const ctx = testApp({ fetcher: fake.fn });
let T: TestTenant;
let alum: TestUser, alum2: TestUser, student: TestUser, student2: TestUser, staff: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);

async function setFeatures(features: Record<string, boolean>) {
  await TenantModel.updateOne(
    { _id: T._id },
    { $set: Object.fromEntries(Object.entries(features).map(([k, v]) => [`features.${k}`, v])) },
  );
  invalidateTenant(T.slug);
}
async function textPost(u: TestUser, body: string, extra: Record<string, unknown> = {}) {
  const r = await as(u)
    .post('/posts')
    .send({ kind: 'text', body, ...extra });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.data as { id: string; [k: string]: unknown };
}
async function uploadImage(u: TestUser, purpose: 'post' | 'story' = 'post') {
  const r = await as(u)
    .post('/media/images')
    .field('for', purpose)
    .attach('file', await jpegWithExif(), 'p.jpg');
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.data.id as string;
}

beforeAll(async () => {
  T = await makeTenant('feedtest');
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  alum2 = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  student2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  staff = await makeUser(ctx, T, { roles: ['TPO'] });
  await runInTenant(T._id, async () => {
    await ProfileModel.updateMany({ userId: { $in: [alum.id, student.id] } }, { $set: { branch: 'CSE' } });
    await ProfileModel.updateMany({ userId: alum2.id }, { $set: { branch: 'MECH' } });
  });
});

describe('ranking maths', () => {
  const base = {
    createdAt: new Date('2026-01-02T00:00:00Z'),
    followedAuthor: false,
    followedSource: false,
    topicMatches: 0,
    branchMatch: false,
    alumniAuthor: false,
    announcement: false,
    engagement: 0,
  };
  const asOf = new Date('2026-01-02T00:00:00Z');
  it('halves every 24 hours and adds documented boosts', () => {
    expect(rankScore(base, asOf)).toBeCloseTo(1);
    expect(rankScore({ ...base, createdAt: new Date('2026-01-01T00:00:00Z') }, asOf)).toBeCloseTo(0.5);
    expect(rankScore({ ...base, followedAuthor: true }, asOf)).toBeCloseTo(2);
    expect(rankScore({ ...base, topicMatches: 9 }, asOf)).toBeCloseTo(1.9); // capped at 3
    expect(rankScore({ ...base, engagement: Math.E - 1 }, asOf)).toBeCloseTo(1.15);
    // A future timestamp never beats "now".
    expect(rankScore({ ...base, createdAt: new Date('2026-01-03T00:00:00Z') }, asOf)).toBeCloseTo(1);
  });
  it('cursors are opaque and validated', () => {
    expect(decodeCursor(encodeCursor({ a: 5, o: 15 }))).toEqual({ a: 5, o: 15 });
    expect(decodeCursor('not-base64-json')).toBeNull();
    expect(decodeCursor(encodeCursor({ a: 5, o: 99999 }))).toBeNull();
  });
});

describe('posts', () => {
  it('stores rich text as plain text and extracts hashtags', async () => {
    const p = await textPost(alum, 'Hello <b>team</b><script>steal()</script> &amp; friends #GATE2027 #dsa', {
      topics: ['gate'],
    });
    expect(p.body).toBe('Hello team & friends #GATE2027 #dsa');
    expect(p.hashtags).toEqual(['gate2027', 'dsa']);
    expect(p).toMatchObject({ kind: 'text', topics: ['gate'], isMine: true, status: 'published' });
  });

  it('rejects unknown keys, too many topics and empty text', async () => {
    expect((await as(alum).post('/posts').send({ kind: 'text', body: 'x', extra: 1 })).status).toBe(400);
    expect(
      (
        await as(alum)
          .post('/posts')
          .send({ kind: 'text', body: 'x', topics: ['gate', 'dsa', 'data', 'civil'] })
      ).status,
    ).toBe(400);
    expect((await as(alum).post('/posts').send({ kind: 'text', body: '<p></p>' })).status).toBe(400);
  });

  it('students cannot post until the college turns on student posting', async () => {
    expect((await as(student).post('/posts').send({ kind: 'text', body: 'Hi all' })).status).toBe(403);
    await setFeatures({ studentPosting: true });
    const fresh = await makeUser(ctx, T, { roles: ['STUDENT'] });
    expect(
      (await api(ctx, T.host, fresh.token).post('/posts').send({ kind: 'text', body: 'Hi all' })).status,
    ).toBe(201);
    await setFeatures({ studentPosting: false });
  });

  it('only staff can post official announcements', async () => {
    expect(
      (await as(alum).post('/posts').send({ kind: 'text', body: 'Official', announcement: true })).status,
    ).toBe(403);
    const a = await textPost(staff, 'Placement drive on Friday', { announcement: true });
    expect(a.announcement).toBe(true);
  });

  it('photo posts claim uploaded media once, by the uploader only', async () => {
    const fileId = await uploadImage(alum);
    // Another member cannot attach someone else's upload.
    expect(
      (
        await as(alum2)
          .post('/posts')
          .send({ kind: 'photo', media: [{ fileId, alt: 'Lab bench' }] })
      ).status,
    ).toBe(400);
    const r = await as(alum)
      .post('/posts')
      .send({ kind: 'photo', body: 'Lab day', media: [{ fileId, alt: 'Lab bench' }] });
    expect(r.status).toBe(201);
    expect(r.body.data.media[0]).toMatchObject({
      fileId,
      alt: 'Lab bench',
      kind: 'image',
      mime: 'image/webp',
    });
    // Single use.
    expect(
      (
        await as(alum)
          .post('/posts')
          .send({ kind: 'photo', media: [{ fileId, alt: 'Again' }] })
      ).status,
    ).toBe(400);
    // Re-encoded without EXIF, readable by members.
    const f = await as(student).get(`/files/${fileId}`).buffer(true);
    expect(f.status).toBe(200);
    expect(f.body.toString('latin1')).not.toContain('SECRET-EXIF-MARKER');
  });

  it('a reel needs a video: up to 60 s, with metadata removed', async () => {
    const tooLong = await as(alum).post('/media/videos').attach('file', fakeMp4(75), 'long.mp4');
    expect(tooLong.status).toBe(400);
    const notVideo = await as(alum)
      .post('/media/videos')
      .attach('file', await jpegWithExif(), 'x.mp4');
    expect(notVideo.status).toBe(415);
    const up = await as(alum).post('/media/videos').attach('file', fakeMp4(42), 'tip.mp4');
    expect(up.status).toBe(201);
    expect(up.body.data.durationSec).toBe(42);
    const fileId = up.body.data.id as string;
    const raw = (await as(alum).get(`/files/${fileId}`).buffer(true)).body as Buffer;
    expect(raw.toString('latin1')).not.toContain('GPS-SECRET');
    expect(raw.toString('latin1')).not.toContain('TRACK-SECRET-NAME');
    // A photo post cannot use a video, and a reel cannot use a photo.
    expect(
      (
        await as(alum)
          .post('/posts')
          .send({ kind: 'photo', media: [{ fileId, alt: 'x' }] })
      ).status,
    ).toBe(400);
    const reel = await as(alum)
      .post('/posts')
      .send({
        kind: 'reel',
        body: 'Resume tip',
        media: [{ fileId, alt: 'Alumna explains one resume rule' }],
        topics: ['placements'],
      });
    expect(reel.status).toBe(201);
    expect(reel.body.data.media[0]).toMatchObject({ kind: 'video', durationSec: 42 });
    const reels = (await as(student).get('/posts?kind=reel')).body.data;
    expect(reels.map((p: { id: string }) => p.id)).toContain(reel.body.data.id);
  });

  it('link posts show a text-only preview through the SSRF-safe fetcher', async () => {
    const r = await as(alum)
      .post('/posts')
      .send({ kind: 'link', body: 'Worth a read', url: 'https://careers.example.org/guide' });
    expect(r.status).toBe(201);
    expect(r.body.data.link).toEqual({
      url: 'https://careers.example.org/guide',
      host: 'careers.example.org',
      title: 'Placement prep guide & checklist',
      description: 'Ten things to do before campus drives.',
      siteName: 'Demo Careers',
    });
    expect(JSON.stringify(r.body.data)).not.toContain('tracker.png');
    // An unreachable page still posts, with the bare link.
    const r2 = await as(alum).post('/posts').send({ kind: 'link', url: 'https://down.example.org/x' });
    expect(r2.status).toBe(201);
    expect(r2.body.data.link).toMatchObject({ url: 'https://down.example.org/x', title: '' });
    expect(
      (await as(alum).post('/posts').send({ kind: 'link', url: 'http://insecure.example.org' })).status,
    ).toBe(400);
  });

  it('polls: one vote each, results hidden until you vote', async () => {
    const r = await as(alum)
      .post('/posts')
      .send({
        kind: 'poll',
        body: 'Which track next?',
        poll: { options: ['GATE', 'Placements'], closesInDays: 3 },
      });
    expect(r.status).toBe(201);
    const id = r.body.data.id as string;
    expect(r.body.data.poll).toMatchObject({ total: 0, closed: false, myVote: null });
    expect((await as(student).post(`/posts/${id}/vote`).send({ option: 2 })).status).toBe(400);
    const v = await as(student).post(`/posts/${id}/vote`).send({ option: 1 });
    expect(v.status).toBe(200);
    expect(v.body.data.poll).toMatchObject({ total: 1, myVote: 1 });
    expect((await as(student).post(`/posts/${id}/vote`).send({ option: 0 })).status).toBe(409);
    const other = (await as(student2).get(`/posts/${id}`)).body.data.poll;
    expect(other).toMatchObject({ total: 0, myVote: null });
    expect(other.options.every((o: { votes: number }) => o.votes === 0)).toBe(true);
    expect(
      (
        await as(student)
          .post(`/posts/${(await textPost(alum, 'No poll')).id}/vote`)
          .send({ option: 0 })
      ).status,
    ).toBe(400);
    await runInTenant(T._id, () =>
      PostModel.updateOne({ _id: id }, { $set: { 'poll.closesAt': new Date(Date.now() - 1000) } }),
    );
    expect((await as(student2).post(`/posts/${id}/vote`).send({ option: 0 })).status).toBe(409);
    expect((await as(student2).get(`/posts/${id}`)).body.data.poll).toMatchObject({ total: 1, closed: true });
  });
});

describe('interactions', () => {
  let postId: string;
  beforeAll(async () => {
    postId = (await textPost(alum, 'Interview tips thread', { topics: ['placements'] })).id;
  });

  it('reactions switch and clear without double counting', async () => {
    let r = await as(student).post(`/posts/${postId}/reactions`).send({ reaction: 'helpful' });
    expect(r.body.data).toMatchObject({
      myReaction: 'helpful',
      counts: { reactions: { helpful: 1, insightful: 0 } },
    });
    r = await as(student).post(`/posts/${postId}/reactions`).send({ reaction: 'helpful' });
    expect(r.body.data.counts.reactions.helpful).toBe(1);
    r = await as(student).post(`/posts/${postId}/reactions`).send({ reaction: 'insightful' });
    expect(r.body.data.counts.reactions).toEqual({ helpful: 0, insightful: 1, celebrate: 0 });
    r = await as(student).post(`/posts/${postId}/reactions`).send({ reaction: null });
    expect(r.body.data).toMatchObject({ myReaction: null, counts: { reactions: { insightful: 0 } } });
    expect((await as(student).post(`/posts/${postId}/reactions`).send({ reaction: 'love' })).status).toBe(
      400,
    );
  });

  it('saves are idempotent and listed under Saved', async () => {
    await as(student).post(`/posts/${postId}/save`).send({});
    await as(student).post(`/posts/${postId}/save`).send({});
    const p = (await as(student).get(`/posts/${postId}`)).body.data;
    expect(p).toMatchObject({ saved: true, counts: { saves: 1 } });
    expect((await as(student).get('/posts?saved=true')).body.data.map((x: { id: string }) => x.id)).toEqual([
      postId,
    ]);
    expect((await as(student2).get('/posts?saved=true')).body.data).toEqual([]);
    await as(student).delete(`/posts/${postId}/save`);
    await as(student).delete(`/posts/${postId}/save`);
    expect((await as(student).get(`/posts/${postId}`)).body.data).toMatchObject({
      saved: false,
      counts: { saves: 0 },
    });
  });

  it('shares are counted', async () => {
    await as(student).post(`/posts/${postId}/share`).send({});
    expect((await as(student).get(`/posts/${postId}`)).body.data.counts.shares).toBe(1);
  });

  it('comments, replies and notifications without the comment text', async () => {
    const c = await as(student)
      .post(`/posts/${postId}/comments`)
      .send({ body: 'Thanks, <i>very</i> useful' });
    expect(c.status).toBe(201);
    expect(c.body.data.body).toBe('Thanks, very useful');
    const reply = await as(student2)
      .post(`/posts/${postId}/comments`)
      .send({ body: 'Agreed', parentId: c.body.data.id });
    expect(reply.status).toBe(201);
    expect(reply.body.data.parentId).toBe(c.body.data.id);
    // No reply-to-reply.
    expect(
      (
        await as(student)
          .post(`/posts/${postId}/comments`)
          .send({ body: 'Deep', parentId: reply.body.data.id })
      ).status,
    ).toBe(400);
    const list = (await as(alum).get(`/posts/${postId}/comments`)).body.data;
    expect(list).toHaveLength(2);
    const authorNotes = (await as(alum).get('/notifications')).body.data;
    const n = authorNotes.find((x: { type: string }) => x.type === 'post_comment');
    expect(n.data).toMatchObject({ postId });
    expect(JSON.stringify(authorNotes)).not.toContain('useful');
    const replyNotes = (await as(student).get('/notifications')).body.data;
    expect(replyNotes.some((x: { type: string }) => x.type === 'comment_reply')).toBe(true);
    expect((await as(alum).get(`/posts/${postId}`)).body.data.counts.comments).toBe(2);
    // Only the author deletes a comment; replies go with it.
    expect((await as(student2).delete(`/comments/${c.body.data.id}`)).status).toBe(404);
    expect((await as(student).delete(`/comments/${c.body.data.id}`)).status).toBe(200);
    expect((await as(alum).get(`/posts/${postId}/comments`)).body.data).toEqual([]);
    expect((await as(alum).get(`/posts/${postId}`)).body.data.counts.comments).toBe(0);
  });

  it('blocking hides posts and stops interactions both ways', async () => {
    const p = await textPost(alum2, 'Mech core jobs list');
    await as(student2).post('/me/blocks').send({ userId: alum2.id });
    expect((await as(student2).get(`/posts/${p.id}`)).status).toBe(404);
    expect(
      (
        await as(alum2)
          .post(`/posts/${(await textPost(alum, 'x post')).id}/comments`)
          .send({ body: 'ok' })
      ).status,
    ).toBe(201);
    const feed = (await as(student2).get('/feed?limit=30')).body.data;
    expect(
      feed.some((e: { post?: { author: { userId: string } } }) => e.post?.author.userId === alum2.id),
    ).toBe(false);
    expect((await as(student2).get(`/posts?author=${alum2.id}`)).body.data).toEqual([]);
    await as(student2).delete(`/me/blocks/${alum2.id}`);
  });

  it('authors delete their own posts with everything attached', async () => {
    const fileId = await uploadImage(alum);
    const p = (
      await as(alum)
        .post('/posts')
        .send({ kind: 'photo', media: [{ fileId, alt: 'Poster' }] })
    ).body.data;
    await as(student).post(`/posts/${p.id}/comments`).send({ body: 'Nice poster' });
    expect((await as(student).delete(`/posts/${p.id}`)).status).toBe(404);
    expect((await as(alum).delete(`/posts/${p.id}`)).status).toBe(200);
    expect((await as(student).get(`/posts/${p.id}`)).status).toBe(404);
    expect((await as(alum).get(`/files/${fileId}`)).status).toBe(404);
  });
});

describe('feed tabs', () => {
  it('For You ranks followed authors higher and pages stay stable', async () => {
    const viewer = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const v = api(ctx, T.host, viewer.token);
    const followed = await textPost(alum2, 'From someone I follow');
    await v.post('/follows').send({ targetType: 'user', targetId: alum2.id });
    const first = await v.get('/feed?limit=3');
    expect(first.status).toBe(200);
    expect(first.body.data[0].post.id).toBe(followed.id);
    const cursor = first.body.meta.nextCursor as string;
    expect(cursor).toBeTruthy();
    // New posts after the snapshot don't shift the next page.
    await textPost(alum, 'Brand new after snapshot');
    const second = await v.get(`/feed?limit=3&cursor=${cursor}`);
    const ids1 = first.body.data.map((e: { post?: { id: string } }) => e.post?.id);
    const ids2 = second.body.data.map((e: { post?: { id: string } }) => e.post?.id);
    expect(ids2.some((id: string) => ids1.includes(id))).toBe(false);
    expect(
      second.body.data.some((e: { post?: { body: string } }) => e.post?.body === 'Brand new after snapshot'),
    ).toBe(false);
    expect((await v.get('/feed?cursor=garbage')).status).toBe(400);
  });

  it('Following is newest first from follows and my own posts only', async () => {
    const viewer = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    const v = api(ctx, T.host, viewer.token);
    const mine = await textPost(viewer, 'My own update');
    const topical = await textPost(alum, 'GATE schedule is out', { topics: ['gate'] });
    await textPost(alum2, 'Unrelated to my follows');
    await v.post('/follows').send({ targetType: 'topic', targetId: 'gate' });
    const r = await v.get('/feed?tab=following&limit=30');
    const ids = r.body.data.map((e: { post: { id: string } }) => e.post.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(topical.id);
    expect(
      r.body.data.every(
        (e: { post: { author: { userId: string }; topics: string[] } }) =>
          e.post.author.userId === viewer.id || e.post.topics.includes('gate'),
      ),
    ).toBe(true);
    const page1 = await v.get('/feed?tab=following&limit=1');
    expect(page1.body.data).toHaveLength(1);
    const page2 = await v.get(`/feed?tab=following&limit=1&cursor=${page1.body.meta.nextCursor}`);
    expect(page2.body.data[0].post.id).not.toBe(page1.body.data[0].post.id);
  });
});

describe('follows', () => {
  it('validates targets', async () => {
    expect(
      (await as(student).post('/follows').send({ targetType: 'user', targetId: student.id })).status,
    ).toBe(400);
    expect(
      (await as(student).post('/follows').send({ targetType: 'topic', targetId: 'astrology' })).status,
    ).toBe(400);
    expect(
      (
        await as(student)
          .post('/follows')
          .send({ targetType: 'source', targetId: '0123456789abcdef01234567' })
      ).status,
    ).toBe(404);
    expect(
      (await as(student).post('/follows').send({ targetType: 'user', targetId: '0123456789abcdef01234567' }))
        .status,
    ).toBe(404);
    const s = await as(student).post('/follows').send({ targetType: 'topic', targetId: 'dsa' });
    expect(s.body.data.topics).toContain('dsa');
    expect((await as(student).delete('/follows/topic/dsa')).body.data.topics).not.toContain('dsa');
  });

  it('blocking ends follows both ways', async () => {
    const a = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await api(ctx, T.host, a.token).post('/follows').send({ targetType: 'user', targetId: alum.id });
    expect((await api(ctx, T.host, a.token).get('/me/follows')).body.data.users).toEqual([alum.id]);
    await as(alum).post('/me/blocks').send({ userId: a.id });
    expect((await api(ctx, T.host, a.token).get('/me/follows')).body.data.users).toEqual([]);
    expect(
      (await api(ctx, T.host, a.token).post('/follows').send({ targetType: 'user', targetId: alum.id }))
        .status,
    ).toBe(404);
    await as(alum).delete(`/me/blocks/${a.id}`);
  });

  it('suggests alumni to follow', async () => {
    const s = (await as(student).get('/feed/suggestions')).body.data;
    expect(s.people.map((p: { userId: string }) => p.userId)).toContain(alum.id);
    expect(s.people.map((p: { userId: string }) => p.userId)).not.toContain(student.id);
  });
});

describe('stories', () => {
  it('text and photo stories last 24 hours', async () => {
    const t = await as(alum)
      .post('/stories')
      .send({ kind: 'text', text: 'Mock interviews today', background: 'ocean' });
    expect(t.status).toBe(201);
    const exp = new Date(t.body.data.expiresAt).getTime() - Date.now();
    expect(exp).toBeGreaterThan(23.9 * 3600_000);
    expect(exp).toBeLessThanOrEqual(24 * 3600_000);
    // Post media cannot be used for a story (purpose-bound uploads).
    const postFile = await uploadImage(alum, 'post');
    expect((await as(alum).post('/stories').send({ kind: 'photo', fileId: postFile, alt: 'x' })).status).toBe(
      400,
    );
    const storyFile = await uploadImage(alum, 'story');
    const ph = await as(alum)
      .post('/stories')
      .send({ kind: 'photo', fileId: storyFile, alt: 'Campus at dusk', link: 'https://example.org/event' });
    expect(ph.status).toBe(201);
    const list = (await as(student).get('/stories')).body.data.map((s: { id: string }) => s.id);
    expect(list).toEqual(expect.arrayContaining([t.body.data.id, ph.body.data.id]));
    expect((await as(student).get(`/files/${storyFile}`)).status).toBe(200);
    expect((await as(student).delete(`/stories/${ph.body.data.id}`)).status).toBe(404);
    expect((await as(alum).delete(`/stories/${ph.body.data.id}`)).status).toBe(200);
    expect((await as(student).get(`/files/${storyFile}`)).status).toBe(404);
  });

  it('students need posting rights, and colleges can turn stories off', async () => {
    expect(
      (await as(student).post('/stories').send({ kind: 'text', text: 'Hi', background: 'brand' })).status,
    ).toBe(403);
    await setFeatures({ stories: false });
    expect(
      (await as(alum).post('/stories').send({ kind: 'text', text: 'Hi', background: 'brand' })).status,
    ).toBe(403);
    await setFeatures({ stories: true });
  });
});

describe('One Useful Thing', () => {
  it('is computed from engaged alumni posts and can be curated by staff', async () => {
    const tip = await textPost(alum, 'Practise one mock aptitude test every Sunday');
    await as(student).post(`/posts/${tip.id}/save`).send({});
    await as(student2).post(`/posts/${tip.id}/reactions`).send({ reaction: 'helpful' });
    const auto = (await as(student).get('/feed/one-useful-thing')).body.data;
    expect(auto).toMatchObject({ kind: 'post', curated: false });
    expect(auto.post).toBeTruthy();
    const pick = await textPost(staff, 'Today: update your resume headline');
    expect(
      (await as(alum).post('/feed/one-useful-thing').send({ targetType: 'post', targetId: pick.id })).status,
    ).toBe(403);
    const r = await as(staff).post('/feed/one-useful-thing').send({ targetType: 'post', targetId: pick.id });
    expect(r.status).toBe(200);
    expect((await as(student).get('/feed/one-useful-thing')).body.data).toMatchObject({
      curated: true,
      post: { id: pick.id },
    });
    expect(
      (
        await as(staff)
          .post('/feed/one-useful-thing')
          .send({ targetType: 'item', targetId: '0123456789abcdef01234567' })
      ).status,
    ).toBe(404);
  });
});

describe('search', () => {
  it('finds published posts', async () => {
    await textPost(alum, 'Kubernetes internship roundup for juniors');
    const r = await as(student).get('/search?q=kubernetes');
    expect(r.status).toBe(200);
    expect(r.body.data.posts.some((p: { body: string }) => p.body.includes('Kubernetes'))).toBe(true);
  });
});
