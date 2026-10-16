import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { ModerationActionModel } from '../src/modules/moderation/moderation.model.js';

const ctx = testApp();
let T: TestTenant;
let author: TestUser, reader: TestUser, mod1: TestUser, mod2: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const post = async (body: string) =>
  (await as(author).post('/posts').send({ kind: 'text', body })).body.data.id as string;

beforeAll(async () => {
  T = await makeTenant('modtest');
  author = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  reader = await makeUser(ctx, T, { roles: ['STUDENT'] });
  mod1 = await makeUser(ctx, T, { roles: ['FACULTY'] });
  mod2 = await makeUser(ctx, T, { roles: ['TPO'] });
});

describe('report → remove → appeal', () => {
  let postId: string;
  let reportId: string;

  it('members report posts with a snapshot; self-reports are refused', async () => {
    postId = await post('Join my paid group for leaked papers');
    expect(
      (await as(author).post('/reports').send({ targetType: 'post', targetId: postId, reason: 'spam' }))
        .status,
    ).toBe(404);
    const r = await as(reader)
      .post('/reports')
      .send({ targetType: 'post', targetId: postId, reason: 'spam' });
    expect(r.status).toBe(201);
    reportId = r.body.data.id;
    const list = (await as(mod1).get('/admin/reports')).body.data;
    const rep = list.find((x: { id: string }) => x.id === reportId);
    expect(rep).toMatchObject({ targetType: 'post', targetId: postId });
    expect(rep.snapshot).toContain('leaked papers');
    expect((await as(mod1).get('/admin/moderation/summary')).body.data.reports).toBeGreaterThan(0);
  });

  it('moderators remove with a reason; readers lose it, the author sees why', async () => {
    expect(
      (
        await as(reader)
          .post('/admin/moderation/actions')
          .send({ targetType: 'post', targetId: postId, action: 'remove', reason: 'spam' })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(mod1)
          .post('/admin/moderation/actions')
          .send({ targetType: 'post', targetId: postId, action: 'remove' })
      ).status,
    ).toBe(400);
    const r = await as(mod1).post('/admin/moderation/actions').send({
      targetType: 'post',
      targetId: postId,
      action: 'remove',
      reason: 'spam',
      note: 'Selling exam papers',
      reportId,
    });
    expect(r.status).toBe(200);
    expect(
      (
        await as(mod1)
          .post('/admin/moderation/actions')
          .send({ targetType: 'post', targetId: postId, action: 'remove', reason: 'spam' })
      ).status,
    ).toBe(409);
    expect((await as(reader).get(`/posts/${postId}`)).status).toBe(404);
    expect((await as(reader).post(`/posts/${postId}/reactions`).send({ reaction: 'helpful' })).status).toBe(
      404,
    );
    const mine = (await as(author).get(`/posts/${postId}`)).body.data;
    expect(mine).toMatchObject({
      status: 'removed',
      removal: { reason: 'spam', note: 'Selling exam papers', appeal: null },
    });
    expect((await as(author).post(`/posts/${postId}/comments`).send({ body: 'hello' })).status).toBe(409);
    const n = (await as(author).get('/notifications')).body.data.find(
      (x: { type: string }) => x.type === 'content_removed',
    );
    expect(n.data).toMatchObject({ contentType: 'post', contentId: postId, reason: 'spam', postId });
    expect(
      (await as(mod1).get('/admin/reports?status=resolved')).body.data.map((x: { id: string }) => x.id),
    ).toContain(reportId);
    const h = (await as(mod2).get(`/admin/moderation/history/post/${postId}`)).body.data;
    expect(h[0]).toMatchObject({ action: 'remove', reason: 'spam' });
  });

  it('the author appeals once; the removing moderator cannot uphold', async () => {
    expect(
      (
        await as(reader)
          .post('/appeals')
          .send({ targetType: 'post', targetId: postId, message: 'This is not my post at all' })
      ).status,
    ).toBe(404);
    const a = await as(author).post('/appeals').send({
      targetType: 'post',
      targetId: postId,
      message: 'These are free past papers from the university site.',
    });
    expect(a.status).toBe(201);
    expect(
      (
        await as(author)
          .post('/appeals')
          .send({ targetType: 'post', targetId: postId, message: 'Second appeal attempt here' })
      ).status,
    ).toBe(409);
    expect((await as(author).get(`/posts/${postId}`)).body.data.removal.appeal).toMatchObject({
      status: 'open',
    });
    const open = (await as(mod2).get('/admin/moderation/appeals')).body.data;
    expect(open[0]).toMatchObject({ id: a.body.data.id, removal: { reason: 'spam', by: mod1.id } });
    expect(
      (
        await as(mod1)
          .post(`/admin/moderation/appeals/${a.body.data.id}/decision`)
          .send({ decision: 'uphold' })
      ).status,
    ).toBe(409);
    const up = await as(mod2)
      .post(`/admin/moderation/appeals/${a.body.data.id}/decision`)
      .send({ decision: 'uphold', note: 'Links were to a paid group' });
    expect(up.body.data.status).toBe('upheld');
    expect(
      (
        await as(mod2)
          .post(`/admin/moderation/appeals/${a.body.data.id}/decision`)
          .send({ decision: 'reverse' })
      ).status,
    ).toBe(404);
    expect((await as(author).get(`/posts/${postId}`)).body.data.removal.appeal).toMatchObject({
      status: 'upheld',
      decisionNote: 'Links were to a paid group',
    });
    expect(
      (await as(author).get('/notifications')).body.data.some(
        (n: { type: string; data: { decision: string } }) =>
          n.type === 'appeal_decided' && n.data.decision === 'uphold',
      ),
    ).toBe(true);
  });

  it('a reversed appeal restores the content', async () => {
    const id = await post('Placement cell timings changed');
    await as(mod1)
      .post('/admin/moderation/actions')
      .send({ targetType: 'post', targetId: id, action: 'remove', reason: 'misinformation' });
    const a = await as(author)
      .post('/appeals')
      .send({ targetType: 'post', targetId: id, message: 'The notice board confirms the change.' });
    // The removing moderator may reverse their own decision.
    const r = await as(mod1)
      .post(`/admin/moderation/appeals/${a.body.data.id}/decision`)
      .send({ decision: 'reverse' });
    expect(r.body.data.status).toBe('reversed');
    expect((await as(reader).get(`/posts/${id}`)).body.data.status).toBe('published');
  });

  it('moderators restore directly; comments, questions and stories are moderated the same way', async () => {
    const id = await post('Restorable post');
    await as(mod1)
      .post('/admin/moderation/actions')
      .send({ targetType: 'post', targetId: id, action: 'remove', reason: 'other' });
    expect(
      (
        await as(mod1)
          .post('/admin/moderation/actions')
          .send({ targetType: 'post', targetId: id, action: 'restore' })
      ).status,
    ).toBe(200);
    expect(
      (
        await as(mod1)
          .post('/admin/moderation/actions')
          .send({ targetType: 'post', targetId: id, action: 'restore' })
      ).status,
    ).toBe(409);
    expect(
      (await as(author).get('/notifications')).body.data.some(
        (n: { type: string }) => n.type === 'content_restored',
      ),
    ).toBe(true);

    const c = (await as(reader).post(`/posts/${id}/comments`).send({ body: 'Rude comment here' })).body.data
      .id;
    await as(mod2)
      .post('/admin/moderation/actions')
      .send({ targetType: 'comment', targetId: c, action: 'remove', reason: 'harassment' });
    expect((await as(author).get(`/posts/${id}/comments`)).body.data).toEqual([]);
    expect((await as(reader).get(`/posts/${id}/comments`)).body.data[0]).toMatchObject({
      status: 'removed',
      removal: { reason: 'harassment' },
    });
    expect((await as(mod1).get(`/posts/${id}/comments`)).body.data).toHaveLength(1);

    const s = (
      await as(author).post('/stories').send({ kind: 'text', text: 'Rude story', background: 'brand' })
    ).body.data.id;
    expect(
      (await as(reader).post('/reports').send({ targetType: 'story', targetId: s, reason: 'harassment' }))
        .status,
    ).toBe(201);
    await as(mod2)
      .post('/admin/moderation/actions')
      .send({ targetType: 'story', targetId: s, action: 'remove', reason: 'harassment' });
    expect((await as(reader).get('/stories')).body.data.map((x: { id: string }) => x.id)).not.toContain(s);

    expect(
      (
        await as(mod1).post('/admin/moderation/actions').send({
          targetType: 'post',
          targetId: '0123456789abcdef01234567',
          action: 'remove',
          reason: 'spam',
        })
      ).status,
    ).toBe(404);
  });

  it('only removed content can be appealed', async () => {
    const id = await post('Fine post');
    expect(
      (
        await as(author)
          .post('/appeals')
          .send({ targetType: 'post', targetId: id, message: 'Please look again at this' })
      ).status,
    ).toBe(409);
  });

  it('the moderation log is append-only', async () => {
    await runInTenant(T._id, async () => {
      const row = await ModerationActionModel.findOne({});
      expect(row).toBeTruthy();
      await expect(
        ModerationActionModel.updateOne({ _id: row?._id }, { $set: { note: 'edited' } }),
      ).rejects.toThrow();
      await expect(ModerationActionModel.deleteOne({ _id: row?._id })).rejects.toThrow();
    });
  });
});
