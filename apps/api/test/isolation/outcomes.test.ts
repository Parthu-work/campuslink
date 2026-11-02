/**
 * MANDATORY tenant-isolation suite for build B8: higher studies, exams and ventures of college A
 * are invisible and untouchable from college B, and B's reports never count A's records.
 */
import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import { WhitelistModel } from '../../src/modules/imports/whitelist.model.js';
import { OfferModel } from '../../src/modules/placements/placements.model.js';
import {
  ExamQualificationModel,
  HigherStudyModel,
  VentureModel,
} from '../../src/modules/placements/outcomes.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let tpoA: TestUser, tpoB: TestUser, studentA: TestUser, studentB: TestUser;
const ids: Record<string, string> = {};

beforeAll(async () => {
  A = await makeTenant('iso-outcomes-a');
  B = await makeTenant('iso-outcomes-b');
  tpoA = await makeUser(ctx, A, { roles: ['TPO'] });
  tpoB = await makeUser(ctx, B, { roles: ['TPO'] });
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  studentB = await makeUser(ctx, B, { roles: ['STUDENT'] });
  await runInTenant(A._id, async () => {
    await WhitelistModel.create({
      rollNumber: '22ISOOC001',
      name: 'Iso Outcome',
      branch: 'CSE',
      gradYear: 2026,
      kind: 'student',
      source: 'import',
      status: 'claimed',
      claimedBy: studentA.id,
    });
    await OfferModel.create(
      Array.from({ length: 6 }, () => ({
        userId: new Types.ObjectId(),
        companyKey: 'iso co',
        companyName: 'Iso Co (demo)',
        role: 'Engineer',
        ctcLpa: 6,
        ctcBand: '5_8',
        offerDate: new Date(),
        type: 'full_time',
        source: 'drive',
        status: 'verified',
        branch: 'CSE',
        gradYear: 2026,
      })),
    );
  });
  const a = api(ctx, A.host, studentA.token);
  ids.higher_study = (
    await a
      .post('/me/outcomes/higher_study')
      .send({ institution: 'Iso Univ', program: 'MS', admitYear: 2026 })
  ).body.data.id;
  ids.exam = (await a.post('/me/outcomes/exam').send({ exam: 'GATE', year: 2026 })).body.data.id;
  ids.venture = (
    await a.post('/me/outcomes/venture').send({ name: 'Iso Labs', registered: true, year: 2026 })
  ).body.data.id;
});

describe('tenant isolation: outcomes and reports (B8)', () => {
  it("college B cannot read college A's outcomes", async () => {
    expect((await api(ctx, B.host, studentB.token).get('/me/outcomes')).body.data).toEqual([]);
    const t = api(ctx, B.host, tpoB.token);
    for (const kind of ['higher_study', 'exam', 'venture'])
      expect((await t.get(`/admin/outcomes/${kind}`)).body.data).toEqual([]);
  });

  it("college B cannot decide, delete or import over college A's outcomes", async () => {
    const t = api(ctx, B.host, tpoB.token);
    for (const kind of ['higher_study', 'exam', 'venture']) {
      expect(
        (await t.post(`/admin/outcomes/${kind}/${ids[kind]}/decision`).send({ decision: 'verify' })).status,
      ).toBe(404);
      expect(
        (await api(ctx, B.host, studentB.token).delete(`/me/outcomes/${kind}/${ids[kind]}`)).status,
      ).toBe(404);
    }
    // A's roll number means nothing at B.
    const r = await t
      .post('/admin/outcomes/exam/import')
      .attach('file', Buffer.from('Roll No,Exam,Year\n22ISOOC001,CAT,2026'), 'x.csv');
    expect(r.body.data).toMatchObject({ created: 0, unknown: ['22ISOOC001'] });
    await runInTenant(A._id, async () => {
      expect((await HigherStudyModel.findById(ids.higher_study).lean())?.status).toBe('reported');
      expect((await ExamQualificationModel.findById(ids.exam).lean())?.status).toBe('reported');
      expect((await VentureModel.findById(ids.venture).lean())?.status).toBe('reported');
      expect(await ExamQualificationModel.countDocuments({ exam: 'CAT' })).toBe(0);
    });
  });

  it("college B's reports and dashboard never count college A's records", async () => {
    const t = api(ctx, B.host, tpoB.token);
    const d = (await t.get('/admin/outcome-reports/dashboard?gradYear=2026')).body.data;
    expect(d).toMatchObject({ placed: 0, finalYear: 0, topRecruiters: [] });
    const r = (await t.get('/admin/outcome-reports/naac-placement?gradYear=2026')).body.data;
    expect(r.rows).toEqual([]);
    expect(JSON.stringify(r)).not.toContain('Iso Co');
    const a = (await api(ctx, A.host, tpoA.token).get('/admin/outcome-reports/naac-placement?gradYear=2026'))
      .body.data;
    expect(a.rows[0]).toMatchObject({ company: 'Iso Co (demo)', students: 6 });
  });
});
