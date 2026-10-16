import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { graphProblems, publishProblems, roadmapContent, topoOrder } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { demoContent } from './roadmaps-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { LIBRARY, LIBRARY_FILES } from '../src/modules/roadmaps/library/index.js';
import { RoadmapsService, slugify } from '../src/modules/roadmaps/roadmaps.service.js';
import { RoadmapModel, RoadmapProgressModel } from '../src/modules/roadmaps/roadmap.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';

const ctx = testApp();
let T: TestTenant;
let alum: TestUser, alum2: TestUser, student: TestUser, fac1: TestUser, fac2: TestUser, certified: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const notes = async (u: TestUser, type: string) =>
  (await as(u).get('/notifications')).body.data.filter((n: { type: string }) => n.type === type);

beforeAll(async () => {
  T = await makeTenant('roadtest');
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  alum2 = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  fac1 = await makeUser(ctx, T, { roles: ['FACULTY'] });
  fac2 = await makeUser(ctx, T, { roles: ['FACULTY'] });
  certified = await makeUser(ctx, T, { roles: ['STUDENT'], capabilities: ['CERTIFIED_CONTRIBUTOR'] });
});

describe('roadmap content rules', () => {
  it('rejects broken graphs and lists what blocks publishing', () => {
    const c = demoContent();
    expect(roadmapContent.safeParse(c).success).toBe(true);
    expect(
      graphProblems([
        { id: 'a', prerequisites: ['b'] },
        { id: 'b', prerequisites: ['a'] },
      ]),
    ).toContain('The prerequisites form a loop');
    expect(graphProblems([{ id: 'a', prerequisites: ['a'] }])).toEqual(['“a” depends on itself']);
    expect(
      graphProblems([
        { id: 'a', prerequisites: ['zz'] },
        { id: 'a', prerequisites: [] },
      ]),
    ).toHaveLength(2);
    const bad = roadmapContent.safeParse({
      ...c,
      nodes: [...c.nodes, { ...c.nodes[0], id: 'loop', prerequisites: ['loop'] }],
    });
    expect(bad.success).toBe(false);
    expect(publishProblems(c)).toEqual([]);
    expect(
      publishProblems({
        ...c,
        sources: [],
        nodes: c.nodes.map((n) => ({ ...n, kind: 'skill' as const, sources: [], needsReview: false })),
      }),
    ).toHaveLength(5);
    expect(
      roadmapContent.safeParse({ ...c, sources: [{ title: 'Plain http', url: 'http://x.org' }] }).success,
    ).toBe(false);
    expect(topoOrder([...c.nodes].reverse()).map((n) => n.id)).toEqual(['basics', 'practice', 'project']);
    expect(slugify('Data Engineer (Cloud) — 2026!')).toBe('data-engineer-cloud-2026');
    expect(slugify('తెలుగు')).toBe('roadmap');
  });

  it('every library roadmap is cited, valid and publishable', () => {
    expect(LIBRARY.length).toBeGreaterThanOrEqual(10);
    const files = readdirSync(new URL('../src/modules/roadmaps/library/', import.meta.url))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
    expect(LIBRARY_FILES).toEqual(files);
    const keys = new Set<string>();
    for (const l of LIBRARY) {
      expect(keys.has(l.key), l.key).toBe(false);
      keys.add(l.key);
      expect(publishProblems(l.content), l.key).toEqual([]);
      expect(l.content.sources.length, l.key).toBeGreaterThanOrEqual(2);
      expect(
        l.content.nodes.some((n) => n.kind === 'milestone'),
        l.key,
      ).toBe(true);
      expect(Date.parse(l.lastReviewedAt)).toBeLessThanOrEqual(Date.now());
      for (const n of l.content.nodes) {
        expect(n.sources.length > 0 || n.needsReview, `${l.key}/${n.id}`).toBe(true);
        expect(n.estimateHours[1]).toBeGreaterThanOrEqual(n.estimateHours[0]);
      }
    }
  });
});

describe('library', () => {
  it('reviewers install library roadmaps; students cannot manage the library', async () => {
    expect((await as(student).get('/roadmaps/library')).status).toBe(403);
    expect((await as(alum).post('/roadmaps/library/backend').send({})).status).toBe(403);
    const before = (await as(fac1).get('/roadmaps/library')).body.data;
    expect(before.find((l: { key: string }) => l.key === 'backend')).toMatchObject({ installed: false });
    const r = await as(fac1).post('/roadmaps/library/backend').send({});
    expect(r.body.data).toEqual({ installed: true, proposed: false });
    expect((await as(fac1).post('/roadmaps/library/backend').send({})).body.data).toEqual({
      installed: false,
      proposed: false,
    });
    expect((await as(fac1).post('/roadmaps/library/not-a-roadmap').send({})).status).toBe(404);
    const view = (await as(student).get('/roadmaps/backend')).body.data;
    expect(view).toMatchObject({
      status: 'published',
      fromLibrary: true,
      author: null,
      version: 1,
      canEdit: false,
    });
    expect(view.content.nodes.length).toBe(view.nodeCount);
    expect(view.lastReviewedAt).toBeTruthy();
    const svc = (ctx.app.locals.services as { roadmaps: RoadmapsService }).roadmaps;
    const installed = await runInTenant(T._id, () => svc.installLibrary());
    expect(installed).toBe(LIBRARY.length - 1);
    const list = (await as(student).get('/roadmaps')).body.data;
    expect(list).toHaveLength(LIBRARY.length);
    expect(
      (await as(student).get('/roadmaps?category=core-engineering')).body.data.every(
        (r: { category: string }) => r.category === 'core-engineering',
      ),
    ).toBe(true);
    expect((await as(student).get('/roadmaps?branch=ECE')).body.data.length).toBeGreaterThan(0);
    expect((await as(student).get('/roadmaps?q=Backend')).body.data[0].slug).toBe('backend');
    expect((await as(student).get('/search?q=Backend')).body.data.roadmaps[0].slug).toBe('backend');
    expect(
      await runInTenant(T._id, () => AuditModel.countDocuments({ action: 'roadmap.library_installed' })),
    ).toBe(1);
  });

  it('a changed library roadmap is proposed as an update any reviewer can approve', async () => {
    await runInTenant(T._id, () =>
      RoadmapModel.updateOne({ libraryKey: 'sre' }, { $set: { libraryHash: 'old' } }),
    );
    expect(
      (await as(fac1).get('/roadmaps/library')).body.data.find((l: { key: string }) => l.key === 'sre'),
    ).toMatchObject({ installed: true, updateAvailable: true });
    expect((await as(fac1).post('/roadmaps/library/sre').send({})).body.data).toEqual({
      installed: false,
      proposed: true,
    });
    const queue = (await as(fac2).get('/roadmaps/review-queue')).body.data;
    const item = queue.find((q: { slug: string }) => q.slug === 'sre');
    expect(item).toMatchObject({ version: 2, author: null, isMine: false });
    const approved = await as(fac2).post(`/roadmaps/${item.roadmapId}/review`).send({ decision: 'approve' });
    expect(approved.body.data).toMatchObject({ version: 2, draft: null });
    const versions = (await as(student).get(`/roadmaps/${item.roadmapId}/versions`)).body.data;
    expect(versions.map((v: { status: string }) => v.status)).toEqual(['published', 'superseded']);
  });
});

describe('authoring and review', () => {
  let id: string;
  let slug: string;

  it('only writers start drafts, which stay private to editors and reviewers', async () => {
    expect((await as(student).post('/roadmaps').send({ content: demoContent() })).status).toBe(403);
    expect(
      (
        await as(alum)
          .post('/roadmaps')
          .send({ content: { ...demoContent(), extra: 1 } })
      ).status,
    ).toBe(400);
    const r = await as(alum)
      .post('/roadmaps')
      .send({ content: demoContent({ title: 'Zyxquark <b>Engineer</b>' }) });
    expect(r.status).toBe(201);
    ({ id, slug } = r.body.data);
    expect(r.body.data).toMatchObject({
      status: 'draft',
      canEdit: true,
      draft: { version: 1, status: 'draft' },
    });
    expect(r.body.data.content.title).not.toContain('<b>');
    expect((await as(student).get(`/roadmaps/${slug}`)).status).toBe(404);
    expect((await as(alum2).get(`/roadmaps/${slug}`)).status).toBe(404);
    expect((await as(fac1).get(`/roadmaps/${slug}`)).status).toBe(200);
    expect((await as(student).get('/roadmaps?q=Zyxquark')).body.data).toEqual([]);
    expect((await as(alum).get('/roadmaps?status=draft')).body.data.map((x: { id: string }) => x.id)).toEqual(
      [id],
    );
    expect((await as(alum2).get('/roadmaps?status=draft')).body.data).toEqual([]);
    expect((await as(alum).get('/roadmaps?status=in_review')).status).toBe(403);
    expect((await as(alum2).put(`/roadmaps/${id}/draft`).send({ content: demoContent() })).status).toBe(404);
    // Certified student contributors may write too.
    const c = await as(certified)
      .post('/roadmaps')
      .send({ content: demoContent({ title: 'Certified Draft Demo' }) });
    expect(c.status).toBe(201);
    expect((await as(certified).delete(`/roadmaps/${c.body.data.id}/draft`)).body.data).toEqual({
      discarded: true,
    });
    expect((await as(certified).get(`/roadmaps/${c.body.data.slug}`)).status).toBe(404);
  });

  it('submission needs the publish checklist to pass', async () => {
    const thin = demoContent({ sources: [] });
    await as(alum).put(`/roadmaps/${id}/draft`).send({ content: thin, changeNote: 'Thin' });
    const s = await as(alum).post(`/roadmaps/${id}/submit`).send({});
    expect(s.status).toBe(400);
    expect(s.body.error.details.problems).toContain('Add at least two sources for the roadmap as a whole');
    await as(alum).put(`/roadmaps/${id}/draft`).send({ content: demoContent(), changeNote: 'Added sources' });
    expect((await as(alum2).post(`/roadmaps/${id}/submit`).send({})).status).toBe(404);
    const ok = await as(alum).post(`/roadmaps/${id}/submit`).send({});
    expect(ok.body.data).toMatchObject({
      status: 'in_review',
      canEdit: false,
      draft: { status: 'submitted' },
    });
    expect((await as(alum).put(`/roadmaps/${id}/draft`).send({ content: demoContent() })).status).toBe(409);
  });

  it('a reviewer asks for changes with a note, then approves the resubmission', async () => {
    expect((await as(alum).post(`/roadmaps/${id}/review`).send({ decision: 'approve' })).status).toBe(403);
    expect(
      (await as(fac1).post(`/roadmaps/${id}/review`).send({ decision: 'request_changes', note: 'no' }))
        .status,
    ).toBe(400);
    const rc = await as(fac1)
      .post(`/roadmaps/${id}/review`)
      .send({ decision: 'request_changes', note: 'Please add a free resource to “Practise problems”.' });
    expect(rc.body.data).toMatchObject({ status: 'draft' });
    const [n] = await notes(alum, 'roadmap_changes_requested');
    expect(n.data).toMatchObject({ roadmap: 'Zyxquark Engineer', slug });
    expect(JSON.stringify(n.data)).not.toContain('free resource');
    const mine = (await as(alum).get(`/roadmaps/${slug}`)).body.data;
    expect(mine.draft.reviewNote).toContain('free resource');
    await as(alum).post(`/roadmaps/${id}/submit`).send({});
    expect(
      (await as(fac1).get('/roadmaps/review-queue')).body.data.some(
        (q: { roadmapId: string }) => q.roadmapId === id,
      ),
    ).toBe(true);
    const ap = await as(fac1).post(`/roadmaps/${id}/review`).send({ decision: 'approve', note: 'Thanks' });
    expect(ap.body.data).toMatchObject({ status: 'published', version: 1, draft: null });
    expect((await notes(alum, 'roadmap_approved')).length).toBe(1);
    expect((await as(fac2).post(`/roadmaps/${id}/review`).send({ decision: 'approve' })).status).toBe(409);
    const seen = (await as(student).get(`/roadmaps/${slug}`)).body.data;
    expect(seen).toMatchObject({
      status: 'published',
      author: { userId: alum.id },
      canEdit: false,
      draft: null,
    });
    const versions = (await as(student).get(`/roadmaps/${id}/versions`)).body.data;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      status: 'published',
      reviewer: { userId: fac1.id },
      reviewNote: 'Thanks',
    });
    expect(
      await runInTenant(T._id, () =>
        AuditModel.countDocuments({ action: { $regex: '^roadmap\\.' }, targetId: id }),
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  it('editing a published roadmap opens a new version while the old one stays live', async () => {
    const v2 = demoContent({
      summary: 'Version two of the demo roadmap, with an extra step about mock interviews added.',
      nodes: [
        ...demoContent().nodes,
        {
          id: 'interviews',
          title: 'Mock interviews',
          kind: 'milestone',
          summary: 'Do two mock interviews with alumni and write down what to improve.',
          prerequisites: ['project'],
          estimateHours: [4, 8],
          resources: [],
          proof: '',
          sources: [],
          needsReview: true,
        },
      ],
    });
    const r = await as(alum2)
      .put(`/roadmaps/${id}/draft`)
      .send({ content: v2, changeNote: 'Interviews step' });
    expect(r.body.data).toMatchObject({ version: 1, draft: { version: 2, status: 'draft' } });
    expect(r.body.data.content.nodes).toHaveLength(3);
    // One open version at a time: the original author can't fork a second one.
    expect((await as(alum).put(`/roadmaps/${id}/draft`).send({ content: demoContent() })).status).toBe(409);
    expect((await as(student).get(`/roadmaps/${slug}`)).body.data.content.nodes).toHaveLength(3);
    expect((await as(student).get(`/roadmaps/${id}/versions/2`)).status).toBe(404);
    expect((await as(student).get(`/roadmaps/${id}/versions`)).body.data).toHaveLength(1);
    const draft = (await as(alum2).get(`/roadmaps/${id}/versions/2`)).body.data;
    expect(draft).toMatchObject({ status: 'draft', changeNote: 'Interviews step', problems: [] });
    expect(draft.content.nodes).toHaveLength(4);
    expect((await as(student).get(`/roadmaps/${id}/versions/1`)).body.data.content.nodes).toHaveLength(3);
    expect((await as(student).get(`/roadmaps/${id}/versions/99`)).status).toBe(404);
    // A reviewer who edits becomes an editor and cannot approve.
    await as(fac2).put(`/roadmaps/${id}/draft`).send({ content: v2, changeNote: 'Copy edit' });
    await as(alum2).post(`/roadmaps/${id}/submit`).send({});
    const self = await as(fac2).post(`/roadmaps/${id}/review`).send({ decision: 'approve' });
    expect(self.status).toBe(403);
    expect(self.body.error.message).toContain('Someone else');
    expect((await as(fac2).get(`/roadmaps/${slug}`)).body.data.canReview).toBe(false);
    expect((await as(fac1).get(`/roadmaps/${slug}`)).body.data.canReview).toBe(true);
    await as(fac1).post(`/roadmaps/${id}/review`).send({ decision: 'approve' });
    const live = (await as(student).get(`/roadmaps/${slug}`)).body.data;
    expect(live).toMatchObject({ version: 2, nodeCount: 4, needsReviewCount: 2 });
    expect(
      (await as(student).get(`/roadmaps/${id}/versions`)).body.data.map((v: { status: string }) => v.status),
    ).toEqual(['published', 'superseded']);
    expect((await notes(alum2, 'roadmap_approved')).length).toBe(1);
    expect((await notes(fac2, 'roadmap_approved')).length).toBe(1);
  });

  it('discarding a draft of a published roadmap keeps the published version', async () => {
    await as(alum).put(`/roadmaps/${id}/draft`).send({ content: demoContent(), changeNote: 'Oops' });
    expect((await as(alum2).delete(`/roadmaps/${id}/draft`)).status).toBe(403);
    expect((await as(alum).delete(`/roadmaps/${id}/draft`)).body.data).toEqual({ discarded: true });
    const live = (await as(student).get(`/roadmaps/${slug}`)).body.data;
    expect(live).toMatchObject({ version: 2, hasPendingReview: false });
    expect((await as(alum).delete(`/roadmaps/${id}/draft`)).status).toBe(404);
    // The next version number is reused.
    const again = await as(alum).put(`/roadmaps/${id}/draft`).send({ content: demoContent() });
    expect(again.body.data.draft.version).toBe(3);
    await as(alum).delete(`/roadmaps/${id}/draft`);
  });

  it('reviewers feature and archive; archived roadmaps disappear for students', async () => {
    expect((await as(alum).patch(`/roadmaps/${id}`).send({ featured: true })).status).toBe(403);
    await as(fac1).patch(`/roadmaps/${id}`).send({ featured: true });
    expect((await as(student).get('/roadmaps')).body.data[0].id).toBe(id);
    await as(fac1).patch(`/roadmaps/${id}`).send({ archived: true });
    expect((await as(student).get(`/roadmaps/${slug}`)).status).toBe(404);
    expect(
      (await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'basics', done: true })).status,
    ).toBe(404);
    expect((await as(alum).put(`/roadmaps/${id}/draft`).send({ content: demoContent() })).status).toBe(409);
    expect(
      (await as(fac1).get('/roadmaps?status=archived')).body.data.map((x: { id: string }) => x.id),
    ).toContain(id);
    await as(fac1).patch(`/roadmaps/${id}`).send({ archived: false, featured: false });
    expect((await as(student).get(`/roadmaps/${slug}`)).status).toBe(200);
  });
});

describe('progress, goals and nudges', () => {
  let id: string;
  beforeAll(async () => {
    id = (await as(student).get('/roadmaps/backend')).body.data.id;
  });

  it('marks steps done, follows, and stops following', async () => {
    const r = await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'language', done: true });
    expect(r.body.data).toMatchObject({ done: ['language'], doneThisWeek: 1, nodesPerWeek: 0 });
    expect(
      (await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'nope', done: true })).status,
    ).toBe(400);
    expect(
      (await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'BAD ID', done: true })).status,
    ).toBe(400);
    await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'language', done: true });
    const view = (await as(student).get('/roadmaps/backend')).body.data;
    expect(view.myProgress.done).toEqual(['language']);
    expect(view.progress).toEqual({ done: 1, total: view.nodeCount });
    expect(
      (await as(student).get('/roadmaps?mine=following')).body.data.map((x: { id: string }) => x.id),
    ).toEqual([id]);
    expect((await as(alum).get('/roadmaps/backend')).body.data.myProgress).toBeNull();
    const off = await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'language', done: false });
    expect(off.body.data.done).toEqual([]);
    expect((await as(student).delete(`/roadmaps/${id}/progress`)).body.data).toEqual({ unfollowed: true });
    expect((await as(student).get('/roadmaps?mine=following')).body.data).toEqual([]);
  });

  it('nudges once a week only when behind the goal', async () => {
    expect((await as(student).put(`/roadmaps/${id}/goal`).send({ nodesPerWeek: 11 })).status).toBe(400);
    const g = await as(student).put(`/roadmaps/${id}/goal`).send({ nodesPerWeek: 2 });
    expect(g.body.data).toMatchObject({ nodesPerWeek: 2, done: [] });
    const due = () =>
      runInTenant(T._id, () =>
        RoadmapProgressModel.updateOne(
          { roadmapId: id },
          { $set: { nextNudgeAt: new Date(Date.now() - 1000) } },
        ),
      );
    await due();
    expect(await RoadmapsService.enqueueDueNudges(ctx.queue)).toBe(1);
    await ctx.queue.drain();
    const [n] = await notes(student, 'roadmap_nudge');
    expect(n.data).toEqual({ roadmap: 'Backend Developer', roadmapId: id, slug: 'backend' });
    expect(await RoadmapsService.enqueueDueNudges(ctx.queue)).toBe(0);
    // On track this week: no nudge.
    await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'language', done: true });
    await as(student).put(`/roadmaps/${id}/progress`).send({ nodeId: 'git-cli', done: true });
    await due();
    await RoadmapsService.enqueueDueNudges(ctx.queue);
    await ctx.queue.drain();
    expect(await notes(student, 'roadmap_nudge')).toHaveLength(1);
    // No goal, no nudges.
    await as(student).put(`/roadmaps/${id}/goal`).send({ nodesPerWeek: 0 });
    expect(await RoadmapsService.enqueueDueNudges(ctx.queue)).toBe(0);
  });
});

describe('comments', () => {
  let id: string;
  let commentId: string;
  beforeAll(async () => {
    id = (await as(student).get('/roadmaps/sde-dsa')).body.data.id;
  });

  it('authors and reviewers comment on steps; students cannot see them', async () => {
    const node = (await as(alum).get('/roadmaps/sde-dsa')).body.data.content.nodes[0].id;
    const c = await as(alum)
      .post(`/roadmaps/${id}/comments`)
      .send({ nodeId: node, body: 'Add a <i>Telugu</i> resource?' });
    expect(c.status).toBe(201);
    commentId = c.body.data.id;
    expect(c.body.data).toMatchObject({ nodeId: node, version: 1, isMine: true });
    expect(c.body.data.body).not.toContain('<i>');
    expect(
      (await as(alum).post(`/roadmaps/${id}/comments`).send({ nodeId: 'missing', body: 'Hello there' }))
        .status,
    ).toBe(400);
    expect((await as(student).get(`/roadmaps/${id}/comments`)).status).toBe(403);
    expect(
      (await as(student).post(`/roadmaps/${id}/comments`).send({ nodeId: node, body: 'Hi' })).status,
    ).toBe(403);
    expect((await as(fac1).get(`/roadmaps/${id}/comments`)).body.data).toHaveLength(1);
    expect((await as(alum2).delete(`/roadmap-comments/${commentId}`)).status).toBe(403);
  });

  it('can be reported and removed by a moderator, or deleted by a reviewer', async () => {
    expect(
      (
        await as(alum2)
          .post('/reports')
          .send({ targetType: 'roadmap_comment', targetId: commentId, reason: 'spam' })
      ).status,
    ).toBe(201);
    expect(
      (
        await as(student)
          .post('/reports')
          .send({ targetType: 'roadmap_comment', targetId: commentId, reason: 'spam' })
      ).status,
    ).toBe(404);
    const m = await as(fac1)
      .post('/admin/moderation/actions')
      .send({ targetType: 'roadmap_comment', targetId: commentId, action: 'remove', reason: 'spam' });
    expect(m.status).toBe(200);
    expect((await as(fac1).get(`/roadmaps/${id}/comments`)).body.data).toEqual([]);
    const node = (await as(alum).get('/roadmaps/sde-dsa')).body.data.content.nodes[1].id;
    const c3 = await as(alum2).post(`/roadmaps/${id}/comments`).send({ nodeId: node, body: 'Second note' });
    expect((await as(fac2).delete(`/roadmap-comments/${c3.body.data.id}`)).body.data).toEqual({
      deleted: true,
    });
    expect((await as(fac2).delete(`/roadmap-comments/${c3.body.data.id}`)).status).toBe(404);
  });
});

describe('moderation of roadmaps', () => {
  it('library roadmaps can be reported (no member subject) and removed with a reason', async () => {
    const id = (await as(student).get('/roadmaps/qa-sdet')).body.data.id;
    const r = await as(student)
      .post('/reports')
      .send({ targetType: 'roadmap', targetId: id, reason: 'other', note: 'Broken link' });
    expect(r.status).toBe(201);
    const reports = (await as(fac1).get('/admin/reports')).body.data;
    expect(reports.find((x: { targetId: string }) => x.targetId === id)).toBeTruthy();
    const m = await as(fac1).post('/admin/moderation/actions').send({
      targetType: 'roadmap',
      targetId: id,
      action: 'remove',
      reason: 'misinformation',
      note: 'Outdated',
    });
    expect(m.status).toBe(200);
    expect((await as(student).get('/roadmaps/qa-sdet')).status).toBe(404);
    expect((await as(student).get('/roadmaps')).body.data.map((x: { id: string }) => x.id)).not.toContain(id);
    expect((await as(fac2).patch(`/roadmaps/${id}`).send({ featured: true })).status).toBe(409);
    await as(fac2)
      .post('/admin/moderation/actions')
      .send({ targetType: 'roadmap', targetId: id, action: 'restore' });
    expect((await as(student).get('/roadmaps/qa-sdet')).status).toBe(200);
  });
});
