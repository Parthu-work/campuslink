/**
 * MANDATORY tenant-isolation suite for Phase 2 surfaces: files, imports, the verification list,
 * verification requests, invites, profiles, directory and search. Blocks CI.
 * (Realtime isolation lives in test/realtime.test.ts; mentorship surfaces in isolation/mentorship.test.ts.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  codeFrom,
  jpegWithExif,
  makeTenant,
  makeUser,
  testApp,
  SAMPLE_CSV,
  type TestTenant,
  type TestUser,
} from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import { WhitelistModel } from '../../src/modules/imports/whitelist.model.js';
import { UserModel } from '../../src/modules/auth/user.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let adminA: TestUser, adminB: TestUser, alumA: TestUser, alumB: TestUser, studentA: TestUser;
let avatarB: string, idCardB: string, importB: string, recordB: string;

beforeAll(async () => {
  A = await makeTenant('pplalpha');
  B = await makeTenant('pplbravo');
  adminA = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  alumA = await makeUser(ctx, A, { roles: ['ALUMNI'] });
  alumB = await makeUser(ctx, B, { roles: ['ALUMNI'] });
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  await api(ctx, B.host, alumB.token)
    .put('/me/profile')
    .send({ headline: 'Bravo-only secret headline', company: 'BravoCorp' });
  const av = await api(ctx, B.host, alumB.token)
    .post('/me/avatar')
    .attach('photo', await jpegWithExif(), 'a.jpg');
  if (av.status !== 200) throw new Error(JSON.stringify(av.body));
  avatarB = av.body.data.avatarFileId;
  const pendingB = await makeUser(ctx, B, { roles: ['STUDENT'], verified: false });
  await api(ctx, B.host, pendingB.token)
    .post('/verification/id-card')
    .field('rollNumber', '23PB1A0001')
    .attach('photo', await jpegWithExif(), 'id.jpg');
  idCardB = (await api(ctx, B.host, adminB.token).get('/admin/verification')).body.data[0].fileId;
  const pre = await api(ctx, B.host, adminB.token)
    .post('/admin/imports/preview/upload')
    .attach('file', Buffer.from(SAMPLE_CSV), 's.csv');
  importB = (
    await api(ctx, B.host, adminB.token)
      .post('/admin/imports')
      .send({
        previewId: pre.body.data.previewId,
        mapping: {
          columns: { rollNumber: 'Roll No', name: 'Student Name', email: 'Email', gradYear: 'Batch' },
        },
      })
  ).body.data.id;
  await ctx.queue.drain();
  recordB = String(
    (await runInTenant(B._id, () => WhitelistModel.findOne({ rollNumber: '21DP1A0501' }).lean()))!._id,
  );
});

describe('files', () => {
  it('a file from B is not served on A’s host, even to A’s admin', async () => {
    expect((await api(ctx, A.host, adminA.token).get(`/files/${avatarB}`)).status).toBe(404);
    expect((await api(ctx, A.host, adminA.token).get(`/files/${idCardB}`)).status).toBe(404);
    expect((await api(ctx, A.host, alumA.token).get(`/files/${avatarB}`)).status).toBe(404);
  });
  it('an A token cannot fetch B’s file on B’s host', async () => {
    expect((await api(ctx, B.host, adminA.token).get(`/files/${idCardB}`)).body.error.code).toBe(
      'TENANT_MISMATCH',
    );
  });
});

describe('imports and the verification list', () => {
  it('A’s admin cannot see, read, download or roll back B’s import', async () => {
    expect((await api(ctx, A.host, adminA.token).get('/admin/imports')).body.data).toEqual([]);
    expect((await api(ctx, A.host, adminA.token).get(`/admin/imports/${importB}`)).status).toBe(404);
    expect((await api(ctx, A.host, adminA.token).get(`/admin/imports/${importB}/errors.csv`)).status).toBe(
      404,
    );
    expect((await api(ctx, A.host, adminA.token).post(`/admin/imports/${importB}/rollback`)).status).toBe(
      409,
    );
  });
  it('A’s list never shows B’s records; A cannot delete them', async () => {
    expect((await api(ctx, A.host, adminA.token).get('/admin/whitelist?q=21DP1A0501')).body.data).toEqual([]);
    expect((await api(ctx, A.host, adminA.token).delete(`/admin/whitelist/${recordB}`)).status).toBe(404);
  });
  it('a preview created in B cannot be started in A', async () => {
    const pre = await api(ctx, B.host, adminB.token)
      .post('/admin/imports/preview/upload')
      .attach('file', Buffer.from(SAMPLE_CSV), 's.csv');
    const r = await api(ctx, A.host, adminA.token)
      .post('/admin/imports')
      .send({
        previewId: pre.body.data.previewId,
        mapping: { columns: { rollNumber: 'Roll No', name: 'Student Name' } },
      });
    expect(r.status).toBe(404);
  });
  it('a roll number on B’s list cannot verify someone in A', async () => {
    const u = await makeUser(ctx, A, { roles: ['STUDENT'], verified: false });
    const r = await api(ctx, A.host, u.token).post('/verification/roll').send({ rollNumber: '21DP1A0501' });
    expect(r.body.data.status).toBe('no_match');
    expect(codeFrom(ctx, 'ananya.k@dpit.ac.in')).toBe('');
  });
  it('the same roll number may exist independently in both colleges', async () => {
    const r = await api(ctx, A.host, adminA.token)
      .post('/admin/whitelist')
      .send({ rollNumber: '21DP1A0501', name: 'Different Person', kind: 'student' });
    expect(r.status).toBe(201);
  });
});

describe('verification requests and invites', () => {
  it('A’s reviewer sees none of B’s requests and cannot decide them', async () => {
    expect((await api(ctx, A.host, adminA.token).get('/admin/verification')).body.data).toEqual([]);
    const idB = (await api(ctx, B.host, adminB.token).get('/admin/verification')).body.data[0].id;
    expect(
      (
        await api(ctx, A.host, adminA.token)
          .post(`/admin/verification/${idB}/decision`)
          .send({ decision: 'approve' })
      ).status,
    ).toBe(404);
  });
  it('A cannot un-verify a member of B', async () => {
    expect((await api(ctx, A.host, adminA.token).post(`/admin/users/${alumB.id}/unverify`)).status).toBe(404);
    expect((await runInTenant(B._id, () => UserModel.findById(alumB.id).lean()))?.verified).toBe(true);
  });
  it('an invite sent by A does not verify a sign-up at B', async () => {
    await api(ctx, A.host, adminA.token)
      .post('/admin/invites')
      .send({ emails: ['crossinvite@example.org'] });
    await api(ctx, B.host)
      .post('/auth/signup')
      .send({
        name: 'Cross Invite',
        email: 'crossinvite@example.org',
        password: 'quiet-river-lantern-91',
        intent: 'STUDENT',
        birthMonth: '2000-01',
        consents: ['account'],
      });
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.mailer.lastTo('crossinvite@example.org')!.text)![1];
    await api(ctx, B.host).post('/auth/verify-email').send({ token });
    expect(
      (await runInTenant(B._id, () => UserModel.findOne({ email: 'crossinvite@example.org' }).lean()))
        ?.verified,
    ).toBe(false);
  });
});

describe('profiles, directory and search', () => {
  it('B’s members never appear in A’s directory or search', async () => {
    const dir = await api(ctx, A.host, studentA.token).get('/directory?limit=30');
    expect(dir.body.data.map((p: { userId: string }) => p.userId)).not.toContain(alumB.id);
    expect((await api(ctx, A.host, studentA.token).get('/search?q=BravoCorp')).body.data.people).toEqual([]);
    expect((await api(ctx, A.host, studentA.token).get('/directory?q=Bravo-only')).body.data).toEqual([]);
  });
  it('B’s profile is not readable from A', async () => {
    expect((await api(ctx, A.host, studentA.token).get(`/profiles/${alumB.id}`)).status).toBe(404);
  });
});
