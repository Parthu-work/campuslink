/**
 * MANDATORY tenant-isolation suite for prompt 2, G6: micro-asks, office-hour subscriptions,
 * certificates (and their public check), the alumnus of the month, funds and pledges, batch pages.
 * Every cross-college read, write, update, delete and search must fail.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import { companyKey } from '../../src/lib/company.js';
import { ProfileModel } from '../../src/modules/profiles/profile.model.js';
import { EventModel, OfficeHoursSubscriptionModel } from '../../src/modules/events/event.model.js';
import {
  AlumniOfMonthModel,
  FundModel,
  MentorCertificateModel,
  MicroAskModel,
  PledgeModel,
} from '../../src/modules/alumni/alumni.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let studentA: TestUser, alumA: TestUser, tpoA: TestUser, studentB: TestUser, alumB: TestUser, tpoB: TestUser;
const asA = (u: TestUser) => api(ctx, A.host, u.token);
const asB = (u: TestUser) => api(ctx, B.host, u.token);
let askA = '',
  certCodeA = '',
  certIdA = '',
  fundA = '',
  pledgeA = '',
  eventA = '',
  nomA = '';

beforeAll(async () => {
  A = await makeTenant('iso-alumni-a');
  B = await makeTenant('iso-alumni-b');
  [studentA, alumA, tpoA] = await Promise.all([
    makeUser(ctx, A, { roles: ['STUDENT'] }),
    makeUser(ctx, A, { roles: ['ALUMNI'] }),
    makeUser(ctx, A, { roles: ['TPO'] }),
  ]);
  [studentB, alumB, tpoB] = await Promise.all([
    makeUser(ctx, B, { roles: ['STUDENT'] }),
    makeUser(ctx, B, { roles: ['ALUMNI'] }),
    makeUser(ctx, B, { roles: ['TPO'] }),
  ]);
  for (const [t, u] of [
    [A, alumA],
    [B, alumB],
  ] as const)
    await runInTenant(t._id, () =>
      ProfileModel.updateOne(
        { userId: u.id },
        {
          $set: {
            company: 'Shared Demo Co',
            companyKey: companyKey('Shared Demo Co'),
            branch: 'CSE',
            gradYear: 2018,
          },
        },
      ),
    );
  const ask = await asA(studentA)
    .post('/micro-asks')
    .send({ kind: 'quick_intro', audience: { company: 'Shared Demo Co' }, note: 'An introduction, please.' });
  askA = ask.body.data.id;
  await runInTenant(A._id, async () => {
    const c = await MentorCertificateModel.create({
      userId: alumA.id,
      academicYear: '2025-26',
      name: 'Alum A',
      sessions: 1,
      code: 'a'.repeat(32),
      status: 'issued',
    });
    certIdA = String(c._id);
    certCodeA = c.code;
    const e = await EventModel.create({
      title: 'Office hours A (demo)',
      description: 'College A office hours.',
      kind: 'office_hours',
      mode: 'online',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      onlineUrl: 'https://meet.example.com/a',
      hostId: alumA.id,
    });
    eventA = String(e._id);
  });
  fundA = (
    await asA(tpoA).post('/admin/giving/funds').send({
      title: 'Fund A (demo)',
      purpose: 'lab',
      description: 'College A lab fund.',
    })
  ).body.data.id;
  pledgeA = (await asA(alumA).post('/giving/pledges').send({ fundId: fundA, amountPaise: 10_000 })).body.data
    .id;
  nomA = (
    await asA(tpoA)
      .post('/admin/recognition/of-the-month')
      .send({ userId: alumA.id, month: '2026-09', citation: 'College A alumnus of the month.' })
  ).body.data.id;
});

describe('tenant isolation: alumni engagement (prompt 2, G6)', () => {
  it('micro-asks route only inside the college and stay unreadable from another', async () => {
    const a = await runInTenant(A._id, () => MicroAskModel.findById(askA).lean());
    expect(String(a?.toUserId)).toBe(alumA.id);
    expect((await asB(alumB).get(`/micro-asks/${askA}`)).status).toBe(404);
    expect((await asB(alumB).post(`/micro-asks/${askA}/reply`).send({ action: 'done' })).status).toBe(404);
    expect((await asB(studentB).post(`/micro-asks/${askA}/cancel`)).status).toBe(404);
    expect((await asB(alumB).get('/micro-asks/received')).body.data.asks).toEqual([]);
    expect((await api(ctx, B.host, alumA.token).get('/micro-asks/received')).status).toBe(401);
  });

  it('certificates are checked only at their own college; another college cannot revoke them', async () => {
    expect((await api(ctx, A.host).get(`/verify/certificates/${certCodeA}`)).status).toBe(200);
    expect((await api(ctx, B.host).get(`/verify/certificates/${certCodeA}`)).status).toBe(404);
    expect((await asB(tpoB).post(`/admin/recognition/certificates/${certIdA}/revoke`)).status).toBe(404);
    expect((await asB(tpoB).get('/admin/recognition/certificates')).body.data).toEqual([]);
    expect((await asB(alumB).get(`/me/certificates/${certIdA}/pdf`)).status).toBe(404);
    expect((await runInTenant(A._id, () => MentorCertificateModel.findById(certIdA).lean()))?.status).toBe(
      'issued',
    );
  });

  it('nominations, the Wall and announcements stay in their college', async () => {
    expect((await asB(alumB).post(`/me/alumni-of-the-month/${nomA}`).send({ accept: true })).status).toBe(
      404,
    );
    expect(
      (
        await asB(tpoB)
          .post(`/admin/recognition/of-the-month/${nomA}/announce`)
          .send({ body: 'Announcing college A' })
      ).status,
    ).toBe(404);
    expect(
      (
        await asB(tpoB)
          .post('/admin/recognition/of-the-month')
          .send({ userId: alumA.id, month: '2026-09', citation: 'Not ours to nominate.' })
      ).status,
    ).toBe(400);
    expect((await asB(studentB).get('/alumni/of-the-month')).body.data).toEqual([]);
    expect(await runInTenant(B._id, () => AlumniOfMonthModel.countDocuments({}))).toBe(0);
  });

  it('funds and pledges: no read, pledge, receipt, change or download across colleges', async () => {
    expect((await asB(alumB).get('/giving/funds')).body.data).toEqual([]);
    expect(
      (await asB(alumB).post('/giving/pledges').send({ fundId: fundA, amountPaise: 10_000 })).status,
    ).toBe(404);
    expect(
      (
        await asB(tpoB)
          .put(`/admin/giving/funds/${fundA}`)
          .send({ title: 'Taken', purpose: 'lab', description: 'Changed from B.' })
      ).status,
    ).toBe(404);
    expect(
      (
        await asB(tpoB)
          .post(`/admin/giving/pledges/${pledgeA}/receive`)
          .send({ amountPaise: 10_000, receivedOn: '2026-11-01' })
      ).status,
    ).toBe(404);
    expect((await asB(alumB).post(`/me/pledges/${pledgeA}/cancel`)).status).toBe(404);
    expect((await asB(tpoB).get(`/admin/giving/pledges/${pledgeA}/acknowledgement`)).status).toBe(404);
    expect((await asB(tpoB).get('/admin/giving/pledges')).body.data).toEqual([]);
    expect((await runInTenant(A._id, () => PledgeModel.findById(pledgeA).lean()))?.status).toBe('pledged');
    expect((await runInTenant(A._id, () => FundModel.findById(fundA).lean()))?.title).toBe('Fund A (demo)');
  });

  it('office-hour subscriptions and batch pages never cross colleges', async () => {
    expect(
      (await asB(studentB).put(`/members/${alumA.id}/office-hours/subscription`).send({ on: true })).status,
    ).toBe(404);
    expect(await runInTenant(B._id, () => OfficeHoursSubscriptionModel.countDocuments({}))).toBe(0);
    expect((await asB(studentB).get(`/events/${eventA}`)).status).toBe(404);
    const batch = await asB(studentB).get('/batches/2018/CSE');
    expect(batch.body.data.members.map((m: { userId: string }) => m.userId)).toEqual([alumB.id]);
  });
});
