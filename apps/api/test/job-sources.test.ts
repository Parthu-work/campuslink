import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { fakeFetcher, rss } from './feed-fixtures.js';
import { adzunaResults, greenhouseBoard, leverBoard } from './jobs-fixtures.js';
import { loadEnv } from '../src/config/env.js';
import { runInTenant } from '../src/lib/context.js';
import { clearRobotsCache } from '../src/modules/content-sources/fetch.js';
import { JobModel } from '../src/modules/jobs/job.model.js';
import { JobSourceModel } from '../src/modules/job-sources/job-source.model.js';
import { JobSourcesService } from '../src/modules/job-sources/job-sources.service.js';
import { STARTER_BOARDS } from '../src/modules/job-sources/starter.js';

const GH = 'https://boards-api.greenhouse.io/v1/boards/acmedemo/jobs?content=true';
let board = greenhouseBoard([
  { id: 1, title: 'Java Developer', location: 'Hyderabad, India' },
  { id: 2, title: 'Product Designer', location: 'London, UK' },
  { id: 3, title: 'Software Engineer Intern', location: 'Bengaluru' },
]);
let ghStatus = 200;
const fake = fakeFetcher({
  [GH]: () => ({ status: ghStatus, body: board, contentType: 'application/json' }),
  'https://api.lever.co/v0/postings/betademo?mode=json': {
    body: leverBoard,
    contentType: 'application/json',
  },
  'https://boards-api.greenhouse.io/v1/boards/nope/jobs?content=true': { status: 404 },
  'https://notices.example.org/robots.txt': { status: 404 },
  'https://notices.example.org/jobs.xml': {
    body: rss([
      {
        title: 'Recruitment of Junior Engineers 2026 (demo notice)',
        link: 'https://notices.example.org/n/1',
      },
    ]),
  },
});
const ctx = testApp({ fetcher: fake.fn });
let A: TestTenant, B: TestTenant;
let tpo: TestUser, student: TestUser, tpoB: TestUser;
const as = (u: TestUser, t: TestTenant = A) => api(ctx, t.host, u.token);
let ghId: string;

beforeAll(async () => {
  A = await makeTenant('jsrca');
  B = await makeTenant('jsrcb');
  tpo = await makeUser(ctx, A, { roles: ['TPO'] });
  student = await makeUser(ctx, A, { roles: ['STUDENT'] });
  tpoB = await makeUser(ctx, B, { roles: ['TPO'] });
});
beforeEach(() => clearRobotsCache());

describe('adding job sources', () => {
  it('tests a board first and reports how many openings are in India', async () => {
    const t = await as(tpo)
      .post('/admin/job-sources/test')
      .send({ kind: 'greenhouse', board: 'acmedemo', name: 'Acme Demo' });
    expect(t.body.data).toMatchObject({ ok: true, total: 3, kept: 2 });
    const all = await as(tpo)
      .post('/admin/job-sources/test')
      .send({ kind: 'greenhouse', board: 'acmedemo', name: 'Acme Demo', indiaOnly: false });
    expect(all.body.data.kept).toBe(3);
    expect(
      (
        await as(tpo)
          .post('/admin/job-sources/test')
          .send({ kind: 'greenhouse', board: 'nope', name: 'Nope' })
      ).body.data,
    ).toMatchObject({
      ok: false,
      error: 'Board not found (check the name)',
    });
    expect(
      (await as(tpo).post('/admin/job-sources/test').send({ kind: 'greenhouse', board: '../etc', name: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (
        await as(student)
          .post('/admin/job-sources/test')
          .send({ kind: 'greenhouse', board: 'acmedemo', name: 'x' })
      ).status,
    ).toBe(403);
  });

  it('adds a board and imports normalised Indian openings at once', async () => {
    expect(
      (await as(tpo).post('/admin/job-sources').send({ kind: 'greenhouse', board: 'nope', name: 'Nope' }))
        .status,
    ).toBe(400);
    const r = await as(tpo)
      .post('/admin/job-sources')
      .send({ kind: 'greenhouse', board: 'acmedemo', name: 'Acme Demo', branches: ['CSE'] });
    expect(r.status).toBe(201);
    ghId = r.body.data.id;
    await ctx.queue.drain();
    expect(
      (
        await as(tpo)
          .post('/admin/job-sources')
          .send({ kind: 'greenhouse', board: 'acmedemo', name: 'Again' })
      ).status,
    ).toBe(409);
    const jobs = (await as(student).get('/jobs?limit=30')).body.data as {
      title: string;
      [k: string]: unknown;
    }[];
    const java = jobs.find((j) => j.title === 'Java Developer');
    expect(java).toMatchObject({
      origin: 'greenhouse',
      company: 'Acme Demo',
      location: 'Hyderabad, India',
      level: 'fresher',
      freshersOk: true,
      source: { name: 'Acme Demo', attribution: null },
      applyUrl: 'https://boards.greenhouse.io/acmedemo/jobs/1',
    });
    expect(java?.skills).toEqual(expect.arrayContaining(['Java', 'AWS']));
    expect(jobs.find((j) => j.title === 'Software Engineer Intern')).toMatchObject({ type: 'internship' });
    expect(jobs.some((j) => j.title === 'Product Designer')).toBe(false);
    const list = (await as(tpo).get('/admin/job-sources')).body.data;
    expect(list[0]).toMatchObject({
      id: ghId,
      target: 'boards.greenhouse.io/acmedemo',
      health: { state: 'ok', openJobs: 2 },
    });
  });

  it('a job listed by two sources appears once', async () => {
    // The Greenhouse board now lists the intern role in Hyderabad, as the Lever board does.
    board = greenhouseBoard([
      { id: 1, title: 'Java Developer', location: 'Hyderabad, India' },
      { id: 4, title: 'Software Engineer Intern', location: 'Hyderabad' },
    ]);
    await as(tpo).post(`/admin/job-sources/${ghId}/fetch`).send({});
    await ctx.queue.drain();
    const r = await as(tpo)
      .post('/admin/job-sources')
      .send({ kind: 'lever', board: 'betademo', name: 'Acme Demo', company: 'Acme Demo' });
    expect(r.status).toBe(201);
    await ctx.queue.drain();
    const n = await runInTenant(A._id, () =>
      JobModel.countDocuments({ title: 'Software Engineer Intern', status: 'open' }),
    );
    // Same company, title and city: one listing (the first source keeps it).
    expect(n).toBe(1);
    // The Lever board's Berlin job is dropped (India only).
    expect((await as(student).get('/jobs?q=Senior Data')).body.data).toEqual([]);
  });
});

describe('refreshing and health', () => {
  const refetch = async () => {
    expect((await as(tpo).post(`/admin/job-sources/${ghId}/fetch`).send({})).status).toBe(200);
    await ctx.queue.drain();
  };
  const source = () => runInTenant(A._id, () => JobSourceModel.findById(ghId).lean());

  const javaOpen = async () =>
    ((await as(student).get('/jobs?limit=30')).body.data as { title: string }[]).filter(
      (j) => j.title === 'Java Developer',
    ).length;

  it('closes jobs the board no longer lists and reopens them if they return', async () => {
    board = greenhouseBoard([{ id: 4, title: 'Software Engineer Intern', location: 'Hyderabad' }]);
    await refetch();
    expect(await javaOpen()).toBe(0);
    board = greenhouseBoard([
      { id: 1, title: 'Java Developer', location: 'Hyderabad, India' },
      { id: 4, title: 'Software Engineer Intern', location: 'Hyderabad' },
    ]);
    await refetch();
    expect(await javaOpen()).toBe(1);
  });

  it('backs off on errors and honours rate limits', async () => {
    ghStatus = 500;
    await refetch();
    let s = await source();
    expect(s).toMatchObject({
      lastOutcome: 'error',
      consecutiveFailures: 1,
      lastError: 'The source returned 500',
    });
    expect(
      (await as(tpo).get('/admin/job-sources')).body.data.find((x: { id: string }) => x.id === ghId).health
        .state,
    ).toBe('failing');
    expect((s?.nextFetchAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(23 * 3600_000); // 12 h × 2
    // A failed fetch keeps the open jobs.
    expect(await javaOpen()).toBe(1);
    ghStatus = 200;
    await refetch();
    s = await source();
    expect(s).toMatchObject({ lastOutcome: 'ok', consecutiveFailures: 0, lastError: null });
  });

  it('pausing stops fetching; removing closes its jobs', async () => {
    await as(tpo).patch(`/admin/job-sources/${ghId}`).send({ status: 'paused' });
    expect((await as(tpo).post(`/admin/job-sources/${ghId}/fetch`).send({})).status).toBe(404);
    await as(tpo).patch(`/admin/job-sources/${ghId}`).send({ status: 'active' });
    expect((await as(tpo).delete(`/admin/job-sources/${ghId}`)).status).toBe(200);
    expect(await javaOpen()).toBe(0);
  });
});

describe('other source kinds', () => {
  it('RSS notices go through robots.txt and become openings', async () => {
    const r = await as(tpo).post('/admin/job-sources').send({
      kind: 'rss',
      url: 'https://notices.example.org/jobs.xml',
      name: 'Demo notices',
      company: 'Demo Board',
    });
    expect(r.status).toBe(201);
    await ctx.queue.drain();
    const j = (await as(student).get('/jobs?q=Recruitment')).body.data[0];
    expect(j).toMatchObject({
      origin: 'rss',
      company: 'Demo Board',
      applyUrl: 'https://notices.example.org/n/1',
    });
  });

  it('Adzuna needs the deployment’s keys', async () => {
    const t = await as(tpo)
      .post('/admin/job-sources/test')
      .send({ kind: 'adzuna', query: 'qa engineer', name: 'Adzuna QA' });
    expect(t.body.data).toMatchObject({ ok: false, error: expect.stringContaining('not configured') });
    const url =
      'https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=demo-id&app_key=demo-key&results_per_page=50&what=qa+engineer&max_days_old=21&content-type=application%2Fjson';
    const f2 = fakeFetcher({ [url]: { body: adzunaResults, contentType: 'application/json' } });
    const env = loadEnv({
      NODE_ENV: 'test',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://*.localhost:5173',
      HIBP_ENABLED: 'false',
      ADZUNA_APP_ID: 'demo-id',
      ADZUNA_APP_KEY: 'demo-key',
    });
    const ctx2 = testApp({ fetcher: f2.fn, env });
    const r = await api(ctx2, A.host, tpo.token)
      .post('/admin/job-sources')
      .send({ kind: 'adzuna', query: 'qa engineer', name: 'Adzuna QA' });
    expect(r.status).toBe(201);
    await ctx2.queue.drain();
    const j = (await as(student).get('/jobs?q=QA Engineer')).body.data[0];
    expect(j).toMatchObject({
      origin: 'adzuna',
      company: 'Epsilon Demo',
      source: { attribution: 'Jobs by Adzuna' },
    });
  });
});

describe('starter boards and the scheduler', () => {
  it('only verified starter boards can be added', async () => {
    const list = (await as(tpo).get('/admin/job-sources/starter')).body.data;
    expect(list).toHaveLength(STARTER_BOARDS.length);
    STARTER_BOARDS.push({
      key: 'test-unverified',
      kind: 'greenhouse',
      board: 'acmedemo',
      company: 'Acme',
      branches: [],
      verifiedAt: null,
    });
    STARTER_BOARDS.push({
      key: 'test-verified',
      kind: 'greenhouse',
      board: 'acmedemo',
      company: 'Acme Demo',
      branches: [],
      verifiedAt: '2026-10-16',
    });
    try {
      expect((await as(tpo).post('/admin/job-sources/starter/test-unverified').send({})).status).toBe(409);
      const ok = await as(tpo).post('/admin/job-sources/starter/test-verified').send({});
      expect(ok.status).toBe(201);
      expect(ok.body.data.starterKey).toBe('test-verified');
      expect(
        (await as(tpo).get('/admin/job-sources/starter')).body.data.find(
          (x: { key: string }) => x.key === 'test-verified',
        ).added,
      ).toBe(true);
    } finally {
      STARTER_BOARDS.splice(-2, 2);
    }
    expect((await as(tpo).post('/admin/job-sources/starter/nope').send({})).status).toBe(404);
  });

  it('queues due sources in every college once per due time', async () => {
    board = greenhouseBoard([{ id: 9, title: 'College B Java Developer', location: 'Pune' }]);
    expect(
      (
        await as(tpoB, B)
          .post('/admin/job-sources')
          .send({ kind: 'greenhouse', board: 'acmedemo', name: 'Acme Demo' })
      ).status,
    ).toBe(201);
    await ctx.queue.drain();
    const past = new Date(Date.now() - 60_000);
    for (const t of [A, B])
      await runInTenant(t._id, () => JobSourceModel.updateMany({}, { $set: { nextFetchAt: past } }));
    const n = await JobSourcesService.enqueueDue(ctx.queue);
    expect(n).toBeGreaterThanOrEqual(2);
    await ctx.queue.drain();
    expect(await JobSourcesService.enqueueDue(ctx.queue)).toBe(0);
    // Each college has its own copy of the board's jobs.
    expect((await as(tpoB, B).get('/jobs?q=College B')).body.data).toHaveLength(1);
    expect((await as(tpoB, B).get('/jobs?q=Recruitment')).body.data).toEqual([]);
  });
});
