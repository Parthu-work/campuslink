/**
 * MANDATORY tenant-isolation suite for build B7: companies, drives, registrations, academic
 * records and offers of college A are invisible and untouchable from college B.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import {
  AcademicRecordModel,
  DriveRegistrationModel,
  OfferModel,
  PlacementCompanyModel,
  PlacementDriveModel,
} from '../../src/modules/placements/placements.model.js';
import { WhitelistModel } from '../../src/modules/imports/whitelist.model.js';
import { ProfileModel } from '../../src/modules/profiles/profile.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let tpoA: TestUser, tpoB: TestUser, studentA: TestUser, studentB: TestUser;
let driveA = '';
let offerA = '';
let registrationA = '';
const DAY = 86_400_000;

beforeAll(async () => {
  A = await makeTenant('iso-place-a');
  B = await makeTenant('iso-place-b');
  tpoA = await makeUser(ctx, A, { roles: ['TPO'] });
  tpoB = await makeUser(ctx, B, { roles: ['TPO'] });
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  studentB = await makeUser(ctx, B, { roles: ['STUDENT'] });
  await runInTenant(A._id, async () => {
    await WhitelistModel.create({
      rollNumber: '23ISOPL001',
      name: 'Isolated Student',
      branch: 'CSE',
      gradYear: 2027,
      kind: 'student',
      source: 'import',
      status: 'claimed',
      claimedBy: studentA.id,
    });
    await ProfileModel.updateOne({ userId: studentA.id }, { $set: { branch: 'CSE', gradYear: 2027 } });
    await AcademicRecordModel.create({
      rollNumber: '23ISOPL001',
      cgpa: 8,
      source: 'import',
      verifiedAt: new Date(),
    });
  });
  const a = api(ctx, A.host, tpoA.token);
  const d = await a.post('/admin/placements/drives').send({
    companyName: 'Isolated Corp (demo)',
    title: 'Isolated drive',
    roles: [{ title: 'Engineer', ctcMinLpa: 5, ctcMaxLpa: 6, type: 'full_time' }],
    mode: 'on_campus',
    driveDate: new Date(Date.now() + 10 * DAY).toISOString(),
    registrationCloseAt: new Date(Date.now() + 5 * DAY).toISOString(),
    resumeRequired: false,
  });
  driveA = d.body.data.id;
  await a.post(`/admin/placements/drives/${driveA}/status`).send({ status: 'open' });
  await ctx.queue.drain();
  const r = await api(ctx, A.host, studentA.token).post(`/placements/drives/${driveA}/register`).send({});
  registrationA = r.body.data.id;
  await a
    .put(`/admin/placements/registrations/${registrationA}/final`)
    .send({ final: 'selected', ctcLpa: 6 });
  offerA = String((await runInTenant(A._id, () => OfferModel.findOne().lean()))?._id);
});

describe('tenant isolation: placements (B7)', () => {
  it("college B cannot read college A's drives, registrations or offers", async () => {
    const s = api(ctx, B.host, studentB.token);
    expect((await s.get(`/placements/drives/${driveA}`)).status).toBe(404);
    expect(JSON.stringify((await s.get('/placements/drives?scope=all')).body)).not.toContain(driveA);
    expect((await s.get('/placements/offers')).body.data).toEqual([]);
    const t = api(ctx, B.host, tpoB.token);
    expect((await t.get('/admin/placements/drives')).body.data).toEqual([]);
    expect((await t.get(`/admin/placements/drives/${driveA}/registrants`)).status).toBe(404);
    expect((await t.get(`/admin/placements/drives/${driveA}/export?columns=name`)).status).toBe(404);
    expect((await t.get('/admin/placements/companies')).body.data).toEqual([]);
    expect(JSON.stringify((await t.get('/admin/offers?status=verified')).body)).not.toContain(offerA);
  });

  it("college B cannot register for, change, override or decide college A's records", async () => {
    expect(
      (await api(ctx, B.host, studentB.token).post(`/placements/drives/${driveA}/register`).send({})).status,
    ).toBe(404);
    const t = api(ctx, B.host, tpoB.token);
    expect(
      (await t.post(`/admin/placements/drives/${driveA}/status`).send({ status: 'cancelled' })).status,
    ).toBe(404);
    expect(
      (
        await t
          .post(`/admin/placements/drives/${driveA}/override`)
          .send({ userId: studentA.id, reason: 'Cross-college' })
      ).status,
    ).toBe(404);
    expect(
      (
        await t
          .put(`/admin/placements/drives/${driveA}/rounds/0`)
          .send({ results: [{ registrationId: registrationA, result: 'cleared' }] })
      ).status,
    ).toBe(404);
    expect(
      (await t.put(`/admin/placements/registrations/${registrationA}/final`).send({ final: 'not_selected' }))
        .status,
    ).toBe(404);
    expect(
      (await t.post(`/admin/offers/${offerA}/decision`).send({ decision: 'reject', reason: 'Cross-college' }))
        .status,
    ).toBe(404);
    await runInTenant(A._id, async () => {
      expect((await PlacementDriveModel.findById(driveA).lean())?.status).toBe('open');
      expect((await DriveRegistrationModel.findById(registrationA).lean())?.final).toBe('selected');
      expect((await OfferModel.findById(offerA).lean())?.status).toBe('verified');
    });
  });

  it('companies and academic records are per college', async () => {
    await runInTenant(B._id, async () => {
      expect(await PlacementCompanyModel.countDocuments()).toBe(0);
      expect(await AcademicRecordModel.countDocuments()).toBe(0);
    });
    // The same company name at B is B's own company.
    const b = await api(ctx, B.host, tpoB.token)
      .put('/admin/placements/companies')
      .send({ name: 'Isolated Corp (demo)', notes: 'B only' });
    expect(b.status).toBe(200);
    const a = (await api(ctx, A.host, tpoA.token).get('/admin/placements/companies')).body.data;
    expect(a[0].notes).toBe('');
  });
});
