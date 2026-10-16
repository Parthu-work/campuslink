import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeReferrer, postJob, tinyPdf } from './jobs-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { ReferralRequestModel } from '../src/modules/referrals/referral.model.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { invalidateTenant } from '../src/modules/tenants/tenant.cache.js';

const ctx = testApp();
let T: TestTenant;
let ref1: TestUser, ref2: TestUser, other: TestUser, student: TestUser, student2: TestUser;
let jobId: string;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const WHY =
  'I built two Java REST services and an internship project on payments; I meet the fresher criteria.';

async function uploadResume(u: TestUser) {
  const r = await as(u)
    .post('/referrals/resume')
    .attach('file', await tinyPdf(), 'cv.pdf');
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.data.id as string;
}

beforeAll(async () => {
  T = await makeTenant('reftest');
  ref1 = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  ref2 = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  other = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  student2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  await makeReferrer(ctx, T, ref1, 'Nimbus Labs', 20);
  await makeReferrer(ctx, T, ref2, 'Nimbus Labs Pvt Ltd', 1);
  // An alumnus at the company who has not opted in.
  await api(ctx, T.host, other.token).put('/me/profile').send({ company: 'Nimbus Labs' });
  jobId = (await postJob(ctx, T, other)).id;
});

describe('referral settings', () => {
  it('are off by default and need a company on the profile', async () => {
    const fresh = await makeUser(ctx, T, { roles: ['ALUMNI'] });
    const a = api(ctx, T.host, fresh.token);
    expect((await a.get('/me/referral-settings')).body.data).toMatchObject({
      accepting: false,
      weeklyCap: 3,
      company: '',
    });
    expect((await a.put('/me/referral-settings').send({ accepting: true, weeklyCap: 2 })).status).toBe(400);
    expect((await a.put('/me/referral-settings').send({ accepting: true, weeklyCap: 50 })).status).toBe(400);
    expect((await as(student).get('/me/referral-settings')).status).toBe(403);
  });
});

describe('requesting a referral', () => {
  it('lists only opted-in alumni at the job’s company', async () => {
    const r = (await as(student).get(`/jobs/${jobId}/referrers`)).body.data;
    expect(r.map((x: { userId: string }) => x.userId).sort()).toEqual([ref1.id, ref2.id].sort());
    expect(r[0]).toMatchObject({ available: true, jobTitle: 'SDE 2' });
    expect((await as(student).get(`/jobs/${jobId}`)).body.data).toMatchObject({
      alumniCount: 3,
      referrers: 2,
    });
  });

  it('sends a request with a rebuilt résumé only the two people can open', async () => {
    const resumeFileId = await uploadResume(student);
    expect(
      (await as(student).post('/referrals/resume').attach('file', Buffer.from('not a pdf'), 'x.pdf')).status,
    ).toBe(415);
    const r = await as(student)
      .post('/referrals')
      .send({ jobId, referrerId: ref1.id, why: WHY, resumeFileId });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      status: 'pending',
      job: { id: jobId, title: 'Backend Developer', company: 'Nimbus Labs' },
      requester: { userId: student.id },
      referrer: { userId: ref1.id },
      resumeFileId,
    });
    // Single use.
    expect(
      (await as(student).post('/referrals').send({ jobId, referrerId: ref2.id, why: WHY, resumeFileId }))
        .status,
    ).toBe(400);
    const pdf = await as(ref1).get(`/files/${resumeFileId}`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-disposition']).toMatch(/^attachment/);
    expect((pdf.body as Buffer).toString('latin1')).not.toContain('SECRET-AUTHOR-NAME');
    expect((await as(ref2).get(`/files/${resumeFileId}`)).status).toBe(404);
    expect((await as(student2).get(`/files/${resumeFileId}`)).status).toBe(404);
    const n = (await as(ref1).get('/notifications')).body.data.find(
      (x: { type: string }) => x.type === 'referral_received',
    );
    expect(n.data).toMatchObject({ company: 'Nimbus Labs' });
    expect(JSON.stringify(n)).not.toContain('payments');
    // One open request per job and alumnus.
    expect((await as(student).post('/referrals').send({ jobId, referrerId: ref1.id, why: WHY })).status).toBe(
      409,
    );
  });

  it('refuses people who did not opt in, themselves, short messages and closed jobs', async () => {
    expect(
      (await as(student).post('/referrals').send({ jobId, referrerId: other.id, why: WHY })).status,
    ).toBe(404);
    expect((await as(ref1).post('/referrals').send({ jobId, referrerId: ref1.id, why: WHY })).status).toBe(
      400,
    );
    expect(
      (await as(student2).post('/referrals').send({ jobId, referrerId: ref1.id, why: 'pls' })).status,
    ).toBe(400);
    const closed = (await postJob(ctx, T, other, { title: 'Closed Referral Demo' })).id;
    await as(other).post(`/jobs/${closed}/close`).send({});
    expect(
      (await as(student2).post('/referrals').send({ jobId: closed, referrerId: ref1.id, why: WHY })).status,
    ).toBe(404);
  });

  it('respects the alumnus’s weekly cap', async () => {
    expect(
      (await as(student2).post('/referrals').send({ jobId, referrerId: ref2.id, why: WHY })).status,
    ).toBe(201);
    const list = (await as(student).get(`/jobs/${jobId}/referrers`)).body.data;
    expect(list.find((x: { userId: string }) => x.userId === ref2.id).available).toBe(false);
    const third = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const r = await api(ctx, T.host, third.token)
      .post('/referrals')
      .send({ jobId, referrerId: ref2.id, why: WHY });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/limit/);
    expect((await as(ref2).get('/me/referral-settings')).body.data).toMatchObject({
      usedThisWeek: 1,
      weeklyCap: 1,
    });
  });

  it('limits a student’s open and weekly requests', async () => {
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const a = api(ctx, T.host, s.token);
    const jobs: string[] = [];
    for (let i = 0; i < 4; i++) jobs.push((await postJob(ctx, T, other, { title: `Open limit ${i}` })).id);
    for (let i = 0; i < 3; i++)
      expect(
        (await a.post('/referrals').send({ jobId: jobs[i], referrerId: ref1.id, why: WHY })).status,
      ).toBe(201);
    const r = await a.post('/referrals').send({ jobId: jobs[3], referrerId: ref1.id, why: WHY });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/3 open/);
    // The college's weekly limit.
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'limits.referralRequestsPerWeek': 3 } });
    invalidateTenant(T.slug);
    const withdrawn = (await a.get('/referrals?box=sent')).body.data[0].id;
    await a.post(`/referrals/${withdrawn}/withdraw`).send({});
    const w = await a.post('/referrals').send({ jobId: jobs[3], referrerId: ref1.id, why: WHY });
    expect(w.status).toBe(409);
    expect(w.body.error.message).toMatch(/a week/);
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'limits.referralRequestsPerWeek': 5 } });
    invalidateTenant(T.slug);
  });
});

describe('responding', () => {
  it('the alumnus refers or declines; the student is told, without message text', async () => {
    const received = (await as(ref1).get('/referrals?box=received&status=pending')).body.data;
    const mine = received.find((x: { requester: { userId: string } }) => x.requester.userId === student.id);
    expect(mine.why).toBe(WHY);
    expect((await as(student).post(`/referrals/${mine.id}/respond`).send({ action: 'refer' })).status).toBe(
      403,
    );
    expect((await as(ref2).post(`/referrals/${mine.id}/respond`).send({ action: 'refer' })).status).toBe(404);
    const r = await as(ref1)
      .post(`/referrals/${mine.id}/respond`)
      .send({ action: 'refer', note: 'Submitted. Watch your email.' });
    expect(r.body.data).toMatchObject({ status: 'referred', responseNote: 'Submitted. Watch your email.' });
    expect((await as(ref1).post(`/referrals/${mine.id}/respond`).send({ action: 'refer' })).status).toBe(409);
    const n = (await as(student).get('/notifications')).body.data.find(
      (x: { type: string }) => x.type === 'referral_referred',
    );
    expect(n.data).toMatchObject({ company: 'Nimbus Labs', referralId: mine.id });
    const sent = (await as(student).get('/referrals?box=sent')).body.data;
    expect(sent.find((x: { id: string }) => x.id === mine.id).status).toBe('referred');

    const other2 = (await as(ref2).get('/referrals?box=received')).body.data[0];
    expect((await as(ref2).post(`/referrals/${other2.id}/respond`).send({ action: 'decline' })).status).toBe(
      400,
    );
    const d = await as(ref2)
      .post(`/referrals/${other2.id}/respond`)
      .send({ action: 'decline', template: 'no_openings' });
    expect(d.body.data).toMatchObject({ status: 'declined', declineTemplate: 'no_openings' });
  });

  it('requests expire after 14 days (delayed job and lazily)', async () => {
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const a = api(ctx, T.host, s.token);
    const j = (await postJob(ctx, T, other, { title: 'Expiry Demo Role' })).id;
    const r = (await a.post('/referrals').send({ jobId: j, referrerId: ref1.id, why: WHY })).body.data;
    await runInTenant(T._id, () =>
      ReferralRequestModel.updateOne({ _id: r.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } }),
    );
    await ctx.queue.runDelayed({ name: 'referrals.expire' });
    expect((await a.get(`/referrals/${r.id}`)).body.data.status).toBe('expired');
    expect(
      (await a.get('/notifications')).body.data.some((x: { type: string }) => x.type === 'referral_expired'),
    ).toBe(true);
  });

  it('the alumnus can report a request; blocking withdraws open requests', async () => {
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    const a = api(ctx, T.host, s.token);
    const j = (await postJob(ctx, T, other, { title: 'Report Demo Role' })).id;
    const r = (await a.post('/referrals').send({ jobId: j, referrerId: ref1.id, why: WHY })).body.data;
    expect(
      (await as(student).post('/reports').send({ targetType: 'referral', targetId: r.id, reason: 'spam' }))
        .status,
    ).toBe(404);
    expect(
      (await as(ref1).post('/reports').send({ targetType: 'referral', targetId: r.id, reason: 'spam' }))
        .status,
    ).toBe(201);
    await as(ref1).post('/me/blocks').send({ userId: s.id });
    expect((await a.get(`/referrals/${r.id}`)).body.data.status).toBe('withdrawn');
    expect(
      (await a.get(`/jobs/${j}/referrers`)).body.data.map((x: { userId: string }) => x.userId),
    ).not.toContain(ref1.id);
  });

  it('only the two people see a request', async () => {
    const any = (await as(ref1).get('/referrals?box=received')).body.data[0].id;
    expect((await as(student2).get(`/referrals/${any}`)).status).toBe(404);
    expect((await as(other).get(`/referrals/${any}`)).status).toBe(404);
  });
});
