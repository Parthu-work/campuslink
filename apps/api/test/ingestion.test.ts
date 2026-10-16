import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { fakeFetcher, rss } from './feed-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { clearRobotsCache } from '../src/modules/content-sources/fetch.js';
import { ContentItemModel, ContentSourceModel } from '../src/modules/content-sources/source.model.js';
import { ContentSourcesService } from '../src/modules/content-sources/sources.service.js';
import { STARTER_SOURCES } from '../src/modules/content-sources/starter.js';

const FEED = 'https://news.example.org/feed.xml';
const hour = (h: number) => new Date(Date.now() - h * 3600_000).toUTCString();
const items = [
  {
    title: 'GATE 2027 registration opens next week',
    link: 'https://news.example.org/a?utm_source=rss',
    description: 'Dates for <b>GATE</b> exam forms.',
    pubDate: hour(2),
  },
  {
    title: 'New scholarship for women in engineering',
    link: 'https://news.example.org/b',
    description: 'A central scheme for B.Tech students.',
    pubDate: hour(3),
  },
  {
    title: 'Win a casino jackpot today',
    link: 'https://news.example.org/spam',
    description: 'Click now',
    pubDate: hour(1),
  },
  {
    title: 'YOU WON’T BELIEVE THIS ONE TRICK FOR EXAMS!!!',
    link: 'https://news.example.org/bait',
    description: 'Shocking',
    pubDate: hour(1),
  },
  // Same story syndicated under another URL: content-hash duplicate.
  {
    title: 'GATE 2027 registration opens next week',
    link: 'https://mirror.example.org/a',
    description: 'Dates for <b>GATE</b> exam forms.',
    pubDate: hour(2),
  },
];
let feedReply: () => {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  contentType?: string;
} = () => ({
  body: rss(items, 'Demo Education News'),
  headers: { etag: '"v1"', 'cache-control': 'max-age=600' },
});
const fake = fakeFetcher({
  'https://news.example.org/robots.txt': { status: 404 },
  [FEED]: () => feedReply(),
  'https://blocked.example.org/robots.txt': { body: 'User-agent: *\nDisallow: /', contentType: 'text/plain' },
  'https://blocked.example.org/feed': { body: rss([]) },
  'https://html.example.org/robots.txt': { status: 404 },
  'https://html.example.org/feed': { body: '<html></html>', contentType: 'text/html' },
});
const ctx = testApp({ fetcher: fake.fn });
let A: TestTenant, B: TestTenant;
let admin: TestUser, student: TestUser, adminB: TestUser;
const as = (u: TestUser, t: TestTenant = A) => api(ctx, t.host, u.token);
let sourceId: string;

async function source(id: string) {
  return runInTenant(A._id, () => ContentSourceModel.findById(id).lean());
}
async function fetchAgain(id: string) {
  expect((await as(admin).post(`/admin/sources/${id}/fetch`).send({})).status).toBe(200);
  await ctx.queue.drain();
}

beforeAll(async () => {
  A = await makeTenant('ingesta');
  B = await makeTenant('ingestb');
  admin = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  student = await makeUser(ctx, A, { roles: ['STUDENT'] });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
});
beforeEach(() => clearRobotsCache());

describe('adding sources', () => {
  it('tests a feed before adding: preview, robots and content type', async () => {
    const ok = await as(admin).post('/admin/sources/test').send({ url: FEED });
    expect(ok.body.data).toMatchObject({ ok: true, title: 'Demo Education News', format: 'rss' });
    expect(ok.body.data.items).toHaveLength(3);
    const robots = await as(admin)
      .post('/admin/sources/test')
      .send({ url: 'https://blocked.example.org/feed' });
    expect(robots.body.data).toMatchObject({ ok: false, error: expect.stringContaining('robots.txt') });
    const html = await as(admin).post('/admin/sources/test').send({ url: 'https://html.example.org/feed' });
    expect(html.body.data).toMatchObject({ ok: false, error: expect.stringContaining('content type') });
    const down = await as(admin).post('/admin/sources/test').send({ url: 'https://gone.example.org/feed' });
    expect(down.body.data.ok).toBe(false);
    expect((await as(student).post('/admin/sources/test').send({ url: FEED })).status).toBe(403);
    // The bot identifies itself.
    expect(fake.calls.find((c) => c.url === FEED)?.headers['user-agent']).toMatch(/Bot\/1\.0/);
  });

  it('adds a source and ingests at once: dedupe, filters, tags, snippet only', async () => {
    expect(
      (
        await as(admin)
          .post('/admin/sources')
          .send({ name: 'Blocked', url: 'https://blocked.example.org/feed' })
      ).status,
    ).toBe(400);
    const r = await as(admin)
      .post('/admin/sources')
      .send({ name: 'Demo Education News', url: FEED, topics: ['education-news'], intervalMin: 60 });
    expect(r.status).toBe(201);
    sourceId = r.body.data.id;
    await ctx.queue.drain();
    expect((await as(admin).post('/admin/sources').send({ name: 'Again', url: FEED })).status).toBe(409);
    const stored = await runInTenant(A._id, () => ContentItemModel.find({ sourceId }).lean());
    // Spam rejected outright, clickbait held, syndicated duplicate skipped.
    expect(stored.map((i) => i.status).sort()).toEqual(['held', 'published', 'published']);
    const gate = stored.find((i) => i.title.startsWith('GATE'));
    expect(gate).toMatchObject({ url: 'https://news.example.org/a', snippet: 'Dates for GATE exam forms.' });
    expect(gate?.topics).toEqual(expect.arrayContaining(['education-news', 'gate']));
    const scholarship = stored.find((i) => i.title.includes('scholarship'));
    expect(scholarship?.topics).toContain('scholarships');
    const list = (await as(admin).get('/admin/sources')).body.data;
    expect(list[0]).toMatchObject({
      id: sourceId,
      host: 'news.example.org',
      health: { state: 'ok', itemsLast7d: 2, heldLast7d: 1, consecutiveFailures: 0 },
    });
  });

  it('members follow sources and see items, with attribution, in Following', async () => {
    expect((await as(student).get('/sources')).body.data.map((s: { id: string }) => s.id)).toContain(
      sourceId,
    );
    expect((await as(student).get('/admin/sources')).status).toBe(403);
    await as(student).post('/follows').send({ targetType: 'source', targetId: sourceId });
    const f = (await as(student).get('/feed?tab=following')).body.data;
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f[0]).toMatchObject({
      type: 'item',
      item: { source: { id: sourceId, name: 'Demo Education News' }, host: 'news.example.org' },
    });
    expect(f.some((e: { item?: { title: string } }) => e.item?.title.includes('BELIEVE'))).toBe(false);
    const forYou = (await as(student).get('/feed')).body.data;
    expect(forYou.some((e: { type: string }) => e.type === 'item')).toBe(true);
    expect((await as(admin).get('/admin/sources')).body.data[0].followers).toBe(1);
  });

  it('held items wait for a moderator', async () => {
    const held = (await as(admin).get('/admin/moderation/items')).body.data;
    expect(held).toHaveLength(1);
    expect(held[0].quality).toEqual(expect.arrayContaining(['clickbait']));
    expect((await as(admin).get('/admin/moderation/summary')).body.data.heldItems).toBe(1);
    expect(
      (await as(admin).post(`/admin/moderation/items/${held[0].id}/decision`).send({ decision: 'reject' }))
        .status,
    ).toBe(200);
    expect(
      (await as(admin).post(`/admin/moderation/items/${held[0].id}/decision`).send({ decision: 'publish' }))
        .status,
    ).toBe(404);
    expect((await as(admin).get(`/admin/moderation/history/item/${held[0].id}`)).body.data[0]).toMatchObject({
      action: 'reject',
    });
  });
});

describe('polite fetching and health', () => {
  it('sends conditional requests and honours 304 and max-age', async () => {
    feedReply = () => ({ status: 304 });
    const before = fake.calls.length;
    await fetchAgain(sourceId);
    const seen = fake.calls.slice(before).find((c) => c.url === FEED)?.headers ?? {};
    expect(seen['if-none-match']).toBe('"v1"');
    const s = await source(sourceId);
    expect(s).toMatchObject({ lastOutcome: 'not_modified', consecutiveFailures: 0 });
    // Interval 60 min beats max-age 600 s.
    expect((s?.nextFetchAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(55 * 60_000);
  });

  it('backs off on errors and honours Retry-After', async () => {
    feedReply = () => ({ status: 500 });
    await fetchAgain(sourceId);
    let s = await source(sourceId);
    expect(s).toMatchObject({
      lastOutcome: 'error',
      consecutiveFailures: 1,
      lastError: 'The source returned 500',
    });
    expect((s?.nextFetchAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(115 * 60_000); // 60 min × 2
    expect((await as(admin).get('/admin/sources')).body.data[0].health.state).toBe('failing');
    feedReply = () => ({ status: 429, headers: { 'retry-after': '86400' } });
    await fetchAgain(sourceId);
    s = await source(sourceId);
    expect(s?.consecutiveFailures).toBe(2);
    expect((s?.nextFetchAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(23 * 3600_000);
    feedReply = () => ({ body: rss(items) });
    await fetchAgain(sourceId);
    expect(await source(sourceId)).toMatchObject({
      lastOutcome: 'ok',
      consecutiveFailures: 0,
      lastError: null,
    });
  });

  it('a robots.txt change blocks fetching', async () => {
    fake.routes['https://news.example.org/robots.txt'] = {
      body: 'User-agent: *\nDisallow: /feed.xml',
      contentType: 'text/plain',
    };
    await fetchAgain(sourceId);
    expect(await source(sourceId)).toMatchObject({ lastOutcome: 'blocked' });
    expect((await as(admin).get('/admin/sources')).body.data[0].health.state).toBe('blocked');
    fake.routes['https://news.example.org/robots.txt'] = { status: 404 };
  });

  it('paused sources are not fetched', async () => {
    await as(admin).patch(`/admin/sources/${sourceId}`).send({ status: 'paused' });
    expect((await as(admin).post(`/admin/sources/${sourceId}/fetch`).send({})).status).toBe(404);
    const r = await as(admin)
      .patch(`/admin/sources/${sourceId}`)
      .send({ status: 'active', intervalMin: 30, name: 'Renamed news' });
    expect(r.body.data).toMatchObject({ status: 'active', intervalMin: 30, name: 'Renamed news' });
    expect((await as(admin).patch(`/admin/sources/${sourceId}`).send({ intervalMin: 5 })).status).toBe(400);
  });
});

describe('scheduler', () => {
  it('queues due sources of every college, once per due time', async () => {
    fake.routes['https://news.example.org/robots.txt'] = { status: 404 };
    feedReply = () => ({
      body: rss([{ title: 'College B only headline today', link: 'https://news.example.org/bee' }]),
    });
    const b = await as(adminB, B).post('/admin/sources').send({ name: 'B news', url: FEED });
    expect(b.status).toBe(201);
    await ctx.queue.drain();
    const past = new Date(Date.now() - 60_000);
    await runInTenant(A._id, () => ContentSourceModel.updateMany({}, { $set: { nextFetchAt: past } }));
    await runInTenant(B._id, () => ContentSourceModel.updateMany({}, { $set: { nextFetchAt: past } }));
    expect(await ContentSourcesService.enqueueDue(ctx.queue)).toBe(2);
    await ctx.queue.drain();
    for (const t of [A, B]) {
      const s = await runInTenant(t._id, () => ContentSourceModel.findOne({}).lean());
      expect((s?.nextFetchAt?.getTime() ?? 0) > Date.now()).toBe(true);
    }
    expect(await ContentSourcesService.enqueueDue(ctx.queue)).toBe(0);
    // Items stay in their own college even when two colleges add the same feed.
    const bItems = (await as(adminB, B).get('/feed?tab=following')).body.data;
    expect(bItems).toEqual([]);
    const aTitles = await runInTenant(A._id, () => ContentItemModel.find({}).distinct('title'));
    expect(aTitles).toContain('College B only headline today');
    const bTitles = await runInTenant(B._id, () => ContentItemModel.find({}).distinct('title'));
    expect(bTitles).not.toContain('GATE 2027 registration opens next week');
  });
});

describe('starter list', () => {
  it('only verified starter feeds can be added', async () => {
    const list = (await as(admin).get('/admin/sources/starter')).body.data;
    expect(list).toHaveLength(STARTER_SOURCES.length);
    // A candidate that has not passed verification is listed but cannot be added.
    STARTER_SOURCES.push({
      key: 'test-unverified',
      name: 'Unverified candidate',
      publisher: 'Demo',
      url: FEED,
      topics: [],
      branches: [],
      intervalMin: 360,
      verifiedAt: null,
    });
    try {
      const listed = (await as(admin).get('/admin/sources/starter')).body.data;
      expect(listed.find((x: { key: string }) => x.key === 'test-unverified')).toMatchObject({
        verifiedAt: null,
      });
      expect((await as(admin).post('/admin/sources/starter/test-unverified').send({})).status).toBe(409);
    } finally {
      STARTER_SOURCES.pop();
    }
    expect((await as(admin).post('/admin/sources/starter/not-a-feed').send({})).status).toBe(404);
    const verified = STARTER_SOURCES.find((s) => s.verifiedAt);
    if (verified) {
      const origin = new URL(verified.url).origin;
      fake.routes[`${origin}/robots.txt`] = { status: 404 };
      fake.routes[verified.url] = {
        body: rss([{ title: 'Starter feed headline for the demo', link: `${origin}/x` }]),
      };
      const r = await as(admin).post(`/admin/sources/starter/${verified.key}`).send({});
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({ name: verified.name, url: verified.url });
      expect((await as(admin).post(`/admin/sources/starter/${verified.key}`).send({})).status).toBe(409);
      const again = (await as(admin).get('/admin/sources/starter')).body.data.find(
        (x: { key: string }) => x.key === verified.key,
      );
      expect(again.added).toBe(true);
    }
  });
});

describe('removing a source', () => {
  it('deletes its items and follows', async () => {
    expect((await as(admin).delete(`/admin/sources/${sourceId}`)).status).toBe(200);
    expect(await runInTenant(A._id, () => ContentItemModel.countDocuments({ sourceId }))).toBe(0);
    expect((await as(student).get('/me/follows')).body.data.sources).toEqual([]);
    expect((await as(admin).delete(`/admin/sources/${sourceId}`)).status).toBe(404);
  });
});
