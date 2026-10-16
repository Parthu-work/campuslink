/**
 * MANDATORY tenant-isolation suite for Phase 5: jobs, saved jobs, alerts, job sources, referral
 * settings and requests, and résumé files. Every cross-tenant read, write, update, delete and
 * search must fail. Blocks CI.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Model } from 'mongoose';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { fakeFetcher } from '../feed-fixtures.js';
import { greenhouseBoard, makeReferrer, postJob, tinyPdf } from '../jobs-fixtures.js';
import { runInTenant } from '../../src/lib/context.js';
import { JobAlertModel, JobModel, SavedJobModel } from '../../src/modules/jobs/job.model.js';
import { JobSourceModel } from '../../src/modules/job-sources/job-source.model.js';
import { ReferralPrefsModel, ReferralRequestModel } from '../../src/modules/referrals/referral.model.js';

const fake = fakeFetcher({
  'https://boards-api.greenhouse.io/v1/boards/alphaboard/jobs?content=true': {
    body: greenhouseBoard([{ id: 1, title: 'Alpha Zyxquark Engineer', location: 'Hyderabad' }]),
    contentType: 'application/json',
  },
});
const ctx = testApp({ fetcher: fake.fn });
let A: TestTenant, B: TestTenant;
let alumA: TestUser, studentA: TestUser, tpoA: TestUser, modA: TestUser;
let alumB: TestUser, studentB: TestUser, tpoB: TestUser, modB: TestUser;
let jobA: string, sourceA: string, alertA: string, referralA: string, resumeA: string;
const a = (u: TestUser) => api(ctx, A.host, u.token);
const inB = (u: TestUser) => api(ctx, B.host, u.token);
const WHY = 'Alpha-only reason: I built payment services and meet every requirement listed here.';

beforeAll(async () => {
  A = await makeTenant('isojoba');
  B = await makeTenant('isojobb');
  [alumA, studentA, tpoA, modA] = [
    await makeUser(ctx, A, { roles: ['ALUMNI'] }),
    await makeUser(ctx, A, { roles: ['STUDENT'] }),
    await makeUser(ctx, A, { roles: ['TPO'] }),
    await makeUser(ctx, A, { roles: ['FACULTY'] }),
  ];
  [alumB, studentB, tpoB, modB] = [
    await makeUser(ctx, B, { roles: ['ALUMNI'] }),
    await makeUser(ctx, B, { roles: ['STUDENT'] }),
    await makeUser(ctx, B, { roles: ['TPO'] }),
    await makeUser(ctx, B, { roles: ['FACULTY'] }),
  ];
  await makeReferrer(ctx, A, alumA, 'Shared Corp');
  await makeReferrer(ctx, B, alumB, 'Shared Corp');
  jobA = (await postJob(ctx, A, tpoA, { title: 'Alpha Zyxquark Developer', company: 'Shared Corp' })).id;
  await a(studentA).put(`/jobs/${jobA}/track`).send({ status: 'applied', note: 'Alpha private note' });
  alertA = (
    await a(studentA)
      .post('/me/job-alerts')
      .send({ name: 'Alpha alert', filters: { q: 'Zyxquark' } })
  ).body.data.id;
  const src = await a(tpoA)
    .post('/admin/job-sources')
    .send({ kind: 'greenhouse', board: 'alphaboard', name: 'Alpha board' });
  sourceA = src.body.data.id;
  await ctx.queue.drain();
  resumeA = (
    await a(studentA)
      .post('/referrals/resume')
      .attach('file', await tinyPdf(), 'cv.pdf')
  ).body.data.id;
  const ref = await a(studentA)
    .post('/referrals')
    .send({ jobId: jobA, referrerId: alumA.id, why: WHY, resumeFileId: resumeA });
  if (ref.status !== 201) throw new Error(JSON.stringify(ref.body));
  referralA = ref.body.data.id;
  // B has its own data so empty results are meaningful.
  await postJob(ctx, B, tpoB, { title: 'Beta Developer', company: 'Shared Corp' });
});

describe('HTTP: nothing of college A is reachable from college B', () => {
  it('jobs, tracker, alerts and search', async () => {
    for (const [m, p, body] of [
      ['get', `/jobs/${jobA}`, undefined],
      ['get', `/jobs/${jobA}/referrers`, undefined],
      ['put', `/jobs/${jobA}/track`, { status: 'saved' }],
      ['post', `/jobs/${jobA}/close`, {}],
      ['delete', `/me/job-alerts/${alertA}`, undefined],
    ] as const) {
      const c = inB(m === 'post' ? tpoB : studentB);
      const res =
        m === 'get'
          ? await c.get(p)
          : m === 'delete'
            ? await c.delete(p)
            : m === 'put'
              ? await c.put(p).send(body)
              : await c.post(p).send(body ?? {});
      expect(res.status, `${m} ${p}`).toBe(404);
    }
    const list = JSON.stringify((await inB(studentB).get('/jobs?limit=30')).body.data);
    expect(list).not.toContain(jobA);
    expect(list).not.toContain('Alpha');
    expect((await inB(studentB).get('/jobs?q=Zyxquark')).body.data).toEqual([]);
    expect((await inB(studentB).get('/search?q=Zyxquark')).body.data.jobs).toEqual([]);
    expect(JSON.stringify((await inB(studentB).get('/jobs/radar')).body.data)).not.toContain('Alpha');
    expect((await inB(studentB).get('/me/job-tracker')).body.data).toEqual([]);
    expect((await inB(studentB).get('/me/job-alerts')).body.data).toEqual([]);
    expect((await inB(tpoB).get('/jobs?mine=true')).body.data.map((j: { id: string }) => j.id)).not.toContain(
      jobA,
    );
  });

  it('alumni-at-company counts never cross colleges', async () => {
    const beta = (await inB(studentB).get('/jobs?q=Beta')).body.data[0];
    expect(beta).toMatchObject({ alumniCount: 1, referrers: 1 });
    expect(
      (await inB(studentB).get(`/jobs/${beta.id}/referrers`)).body.data.map(
        (r: { userId: string }) => r.userId,
      ),
    ).toEqual([alumB.id]);
  });

  it('referrals and résumés', async () => {
    expect(
      (await inB(studentB).post('/referrals').send({ jobId: jobA, referrerId: alumA.id, why: WHY })).status,
    ).toBe(404);
    const beta = (await inB(studentB).get('/jobs?q=Beta')).body.data[0].id;
    expect(
      (await inB(studentB).post('/referrals').send({ jobId: beta, referrerId: alumA.id, why: WHY })).status,
    ).toBe(404);
    expect(
      (
        await inB(studentB)
          .post('/referrals')
          .send({ jobId: beta, referrerId: alumB.id, why: WHY, resumeFileId: resumeA })
      ).status,
    ).toBe(400);
    expect((await inB(alumB).get(`/referrals/${referralA}`)).status).toBe(404);
    expect((await inB(alumB).post(`/referrals/${referralA}/respond`).send({ action: 'refer' })).status).toBe(
      404,
    );
    expect((await inB(studentB).post(`/referrals/${referralA}/withdraw`).send({})).status).toBe(404);
    expect(
      (await inB(alumB).get('/referrals?box=received')).body.data.map((r: { id: string }) => r.id),
    ).not.toContain(referralA);
    expect((await inB(alumB).get(`/files/${resumeA}`)).status).toBe(404);
    expect(
      (
        await inB(alumB)
          .post('/reports')
          .send({ targetType: 'referral', targetId: referralA, reason: 'spam' })
      ).status,
    ).toBe(404);
    expect((await inB(alumB).get('/me/referral-settings')).body.data.usedThisWeek).toBe(0);
  });

  it('job sources and moderation', async () => {
    expect((await inB(tpoB).get('/admin/job-sources')).body.data).toEqual([]);
    expect((await inB(tpoB).patch(`/admin/job-sources/${sourceA}`).send({ status: 'paused' })).status).toBe(
      404,
    );
    expect((await inB(tpoB).post(`/admin/job-sources/${sourceA}/fetch`).send({})).status).toBe(404);
    expect((await inB(tpoB).delete(`/admin/job-sources/${sourceA}`)).status).toBe(404);
    expect(
      (await inB(studentB).post('/reports').send({ targetType: 'job', targetId: jobA, reason: 'spam' }))
        .status,
    ).toBe(404);
    expect(
      (
        await inB(modB)
          .post('/admin/moderation/actions')
          .send({ targetType: 'job', targetId: jobA, action: 'remove', reason: 'spam' })
      ).status,
    ).toBe(404);
    expect((await a(studentA).get(`/jobs/${jobA}`)).body.data.status).toBe('open');
    expect(modA.id).toBeTruthy();
  });

  it('a token from A never works on B', async () => {
    const r = await api(ctx, B.host, studentA.token).get('/jobs');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });
});

describe('database layer: every Phase 5 collection is scoped', () => {
  const MODELS: [string, Model<unknown>][] = [
    ['Job', JobModel as Model<unknown>],
    ['SavedJob', SavedJobModel as Model<unknown>],
    ['JobAlert', JobAlertModel as Model<unknown>],
    ['JobSource', JobSourceModel as Model<unknown>],
    ['ReferralPrefs', ReferralPrefsModel as Model<unknown>],
    ['ReferralRequest', ReferralRequestModel as Model<unknown>],
  ];

  it.each(MODELS)('%s: B cannot read, search, update or delete A’s documents', async (_name, model) => {
    const docA = await runInTenant(A._id, () => model.findOne({}).select('_id').lean<{ _id: unknown }>());
    expect(docA, 'fixture created a document in A').toBeTruthy();
    const id = docA?._id;
    await runInTenant(B._id, async () => {
      expect(await model.findById(id).lean()).toBeNull();
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

  it.each(MODELS)('%s: no tenant context, no access', async (_name, model) => {
    await expect(model.findOne({})).rejects.toThrow(/tenant context/i);
  });
});
