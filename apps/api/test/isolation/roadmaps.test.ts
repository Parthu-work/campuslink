/**
 * MANDATORY tenant-isolation suite for Phase 6: roadmaps, versions, progress and comments.
 * Every cross-tenant read, write, update, delete and search must fail. Blocks CI.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Model } from 'mongoose';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { demoContent } from '../roadmaps-fixtures.js';
import { runInTenant } from '../../src/lib/context.js';
import {
  RoadmapCommentModel,
  RoadmapModel,
  RoadmapProgressModel,
  RoadmapVersionModel,
} from '../../src/modules/roadmaps/roadmap.model.js';
import { RoadmapsService } from '../../src/modules/roadmaps/roadmaps.service.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let alumA: TestUser, studentA: TestUser, facA: TestUser, fac2A: TestUser;
let alumB: TestUser, studentB: TestUser, facB: TestUser;
let roadmapA: string, slugA: string, draftA: string, commentA: string;
const a = (u: TestUser) => api(ctx, A.host, u.token);
const inB = (u: TestUser) => api(ctx, B.host, u.token);

beforeAll(async () => {
  A = await makeTenant('isoroada');
  B = await makeTenant('isoroadb');
  [alumA, studentA, facA, fac2A] = [
    await makeUser(ctx, A, { roles: ['ALUMNI'] }),
    await makeUser(ctx, A, { roles: ['STUDENT'] }),
    await makeUser(ctx, A, { roles: ['FACULTY'] }),
    await makeUser(ctx, A, { roles: ['FACULTY'] }),
  ];
  [alumB, studentB, facB] = [
    await makeUser(ctx, B, { roles: ['ALUMNI'] }),
    await makeUser(ctx, B, { roles: ['STUDENT'] }),
    await makeUser(ctx, B, { roles: ['FACULTY'] }),
  ];
  const r = await a(alumA)
    .post('/roadmaps')
    .send({ content: demoContent({ title: 'Alpha Zyxquark Roadmap' }) });
  ({ id: roadmapA, slug: slugA } = r.body.data);
  await a(alumA).post(`/roadmaps/${roadmapA}/submit`).send({});
  await a(facA).post(`/roadmaps/${roadmapA}/review`).send({ decision: 'approve' });
  await a(studentA).put(`/roadmaps/${roadmapA}/progress`).send({ nodeId: 'basics', done: true });
  await a(studentA).put(`/roadmaps/${roadmapA}/goal`).send({ nodesPerWeek: 3 });
  commentA = (
    await a(alumA)
      .post(`/roadmaps/${roadmapA}/comments`)
      .send({ nodeId: 'basics', body: 'Alpha-only comment' })
  ).body.data.id;
  draftA = (
    await a(fac2A)
      .post('/roadmaps')
      .send({ content: demoContent({ title: 'Alpha Private Draft' }) })
  ).body.data.id;
  // B has its own data so empty results are meaningful.
  await inB(facB).post('/roadmaps/library/backend').send({});
});

describe('HTTP: nothing of college A is reachable from college B', () => {
  it('roadmaps, versions and search', async () => {
    expect((await inB(studentB).get(`/roadmaps/${slugA}`)).status).toBe(404);
    for (const p of [`/roadmaps/${roadmapA}/versions`, `/roadmaps/${roadmapA}/versions/1`])
      expect((await inB(studentB).get(p)).status, p).toBe(404);
    const list = JSON.stringify((await inB(studentB).get('/roadmaps')).body.data);
    expect(list).not.toContain(roadmapA);
    expect(list).not.toContain('Alpha');
    expect((await inB(studentB).get('/roadmaps?q=Zyxquark')).body.data).toEqual([]);
    expect((await inB(studentB).get('/search?q=Zyxquark')).body.data.roadmaps).toEqual([]);
    expect(JSON.stringify((await inB(facB).get('/roadmaps?status=draft')).body.data)).not.toContain('Alpha');
    expect((await inB(facB).get('/roadmaps/review-queue')).body.data).toEqual([]);
    // Each college installs its own library copy.
    expect(
      (await inB(facB).get('/roadmaps/library')).body.data.find((l: { key: string }) => l.key === 'backend'),
    ).toMatchObject({ installed: true });
    expect(
      (await a(facA).get('/roadmaps/library')).body.data.find((l: { key: string }) => l.key === 'backend'),
    ).toMatchObject({ installed: false });
  });

  it('writes: drafts, reviews, flags, progress and comments', async () => {
    for (const [m, p, u, body] of [
      ['put', `/roadmaps/${roadmapA}/draft`, alumB, { content: demoContent() }],
      ['delete', `/roadmaps/${draftA}/draft`, facB, undefined],
      ['post', `/roadmaps/${draftA}/submit`, facB, {}],
      ['post', `/roadmaps/${roadmapA}/review`, facB, { decision: 'approve' }],
      ['patch', `/roadmaps/${roadmapA}`, facB, { archived: true }],
      ['put', `/roadmaps/${roadmapA}/progress`, studentB, { nodeId: 'basics', done: true }],
      ['put', `/roadmaps/${roadmapA}/goal`, studentB, { nodesPerWeek: 1 }],
      ['get', `/roadmaps/${roadmapA}/comments`, alumB, undefined],
      ['post', `/roadmaps/${roadmapA}/comments`, alumB, { nodeId: 'basics', body: 'Hello from B' }],
      ['delete', `/roadmap-comments/${commentA}`, facB, undefined],
    ] as const) {
      const c = inB(u);
      const res =
        m === 'get'
          ? await c.get(p)
          : m === 'delete'
            ? await c.delete(p)
            : m === 'put'
              ? await c.put(p).send(body)
              : m === 'patch'
                ? await c.patch(p).send(body)
                : await c.post(p).send(body ?? {});
      expect([404, 409], `${m} ${p}`).toContain(res.status);
    }
    expect((await inB(studentB).delete(`/roadmaps/${roadmapA}/progress`)).status).toBe(200);
    for (const targetType of ['roadmap', 'roadmap_comment'])
      expect(
        (
          await inB(alumB)
            .post('/reports')
            .send({ targetType, targetId: targetType === 'roadmap' ? roadmapA : commentA, reason: 'spam' })
        ).status,
      ).toBe(404);
    expect(
      (
        await inB(facB)
          .post('/admin/moderation/actions')
          .send({ targetType: 'roadmap', targetId: roadmapA, action: 'remove', reason: 'spam' })
      ).status,
    ).toBe(404);
    // A is untouched.
    const view = (await a(studentA).get(`/roadmaps/${slugA}`)).body.data;
    expect(view).toMatchObject({ status: 'published', myProgress: { done: ['basics'], nodesPerWeek: 3 } });
    expect((await a(alumA).get(`/roadmaps/${roadmapA}/comments`)).body.data).toHaveLength(1);
    expect((await a(fac2A).get(`/roadmaps/${draftA}/versions`)).body.data).toHaveLength(1);
  });

  it('nudges run in the right college', async () => {
    await runInTenant(A._id, () =>
      RoadmapProgressModel.updateOne({}, { $set: { nextNudgeAt: new Date(Date.now() - 1000) } }),
    );
    await RoadmapsService.enqueueDueNudges(ctx.queue);
    await ctx.queue.drain();
    const n = (await a(studentA).get('/notifications')).body.data.filter(
      (x: { type: string }) => x.type === 'roadmap_nudge',
    );
    expect(n).toHaveLength(1);
    expect((await inB(studentB).get('/notifications')).body.data).toEqual([]);
  });

  it('a token from A never works on B', async () => {
    const r = await api(ctx, B.host, studentA.token).get('/roadmaps');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });
});

describe('database layer: every Phase 6 collection is scoped', () => {
  const MODELS: [string, Model<unknown>][] = [
    ['Roadmap', RoadmapModel as Model<unknown>],
    ['RoadmapVersion', RoadmapVersionModel as Model<unknown>],
    ['RoadmapProgress', RoadmapProgressModel as Model<unknown>],
    ['RoadmapComment', RoadmapCommentModel as Model<unknown>],
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
