/** Build B8: higher studies, exams and ventures reported by members and verified or imported by the cell. */
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { ExamQualificationModel, HigherStudyModel } from '../src/modules/placements/outcomes.model.js';

const ctx = testApp();
let T: TestTenant;
let tpo: TestUser, faculty: TestUser, alum: TestUser, s1: TestUser, s2: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);

async function onList(u: TestUser, roll: string, branch: string, gradYear: number) {
  await runInTenant(T._id, async () => {
    await WhitelistModel.create({
      rollNumber: roll,
      name: `Outcome ${roll}`,
      branch,
      gradYear,
      kind: 'student',
      source: 'import',
      status: 'claimed',
      claimedBy: u.id,
      claimedAt: new Date(),
    });
    await ProfileModel.updateOne({ userId: u.id }, { $set: { branch, gradYear } });
  });
}

beforeAll(async () => {
  T = await makeTenant('outcomes-b8');
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  s1 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  s2 = await makeUser(ctx, T, { roles: ['STUDENT'] });
  await onList(s1, '22OC1A0001', 'CSE', 2026);
  await onList(s2, '22OC1A0002', 'ECE', 2026);
  await onList(alum, '18OC1A0003', 'MECH', 2022);
});

describe('outcomes a member reports (B8)', () => {
  it('students and alumni report higher studies, exams and ventures; they count once verified', async () => {
    const hs = await as(s1).post('/me/outcomes/higher_study').send({
      institution: 'IIT Demo',
      program: 'M.Tech CSE',
      admitYear: 2026,
      qualifyingExam: 'GATE',
    });
    expect(hs.status, JSON.stringify(hs.body)).toBe(201);
    expect(hs.body.data).toMatchObject({ kind: 'higher_study', status: 'reported', country: 'India' });
    const ex = await as(s1)
      .post('/me/outcomes/exam')
      .send({ exam: 'GATE', year: 2026, scoreBand: 'AIR under 2,000' });
    expect(ex.body.data).toMatchObject({ kind: 'exam', level: 'national' });
    // OTHER needs its name and level.
    expect((await as(s1).post('/me/outcomes/exam').send({ exam: 'OTHER', year: 2026 })).status).toBe(400);
    const other = await as(s1)
      .post('/me/outcomes/exam')
      .send({ exam: 'OTHER', examName: 'Demo State Eligibility Test', level: 'state', year: 2026 });
    expect(other.body.data).toMatchObject({ examName: 'Demo State Eligibility Test', level: 'state' });
    const v = await as(alum)
      .post('/me/outcomes/venture')
      .send({ name: 'Demo Robotics', registered: true, year: 2023 });
    expect(v.status).toBe(201);
    const mine = (await as(s1).get('/me/outcomes')).body.data;
    expect(mine.map((o: { kind: string }) => o.kind).sort()).toEqual(['exam', 'exam', 'higher_study']);
    // The branch and batch come from the profile, not the request.
    await runInTenant(T._id, async () => {
      expect(await HigherStudyModel.findOne({ institution: 'IIT Demo' }).lean()).toMatchObject({
        branch: 'CSE',
        gradYear: 2026,
        source: 'self',
      });
    });
  });

  it('staff cannot report outcomes; members cannot use the cell’s queue', async () => {
    expect((await as(faculty).get('/me/outcomes')).status).toBe(403);
    expect(
      (
        await as(faculty)
          .post('/me/outcomes/venture')
          .send({ name: 'Staff Co', registered: false, year: 2026 })
      ).status,
    ).toBe(403);
    expect((await as(s1).get('/admin/outcomes/exam')).status).toBe(403);
    expect((await as(faculty).get('/admin/outcomes/exam')).status).toBe(403);
  });

  it('the cell verifies or rejects with a reason; the member is told; decided once', async () => {
    const queue = (await as(tpo).get('/admin/outcomes/higher_study')).body.data;
    const row = queue.find((o: { institution: string }) => o.institution === 'IIT Demo');
    expect(row.member).toMatchObject({ rollNumber: '22OC1A0001', branch: 'CSE', gradYear: 2026 });
    const ok = await as(tpo)
      .post(`/admin/outcomes/higher_study/${row.id}/decision`)
      .send({ decision: 'verify' });
    expect(ok.body.data.status).toBe('verified');
    expect(
      (await as(tpo).post(`/admin/outcomes/higher_study/${row.id}/decision`).send({ decision: 'verify' }))
        .status,
    ).toBe(409);
    const exams = (await as(tpo).get('/admin/outcomes/exam')).body.data;
    const other = exams.find((o: { exam: string }) => o.exam === 'OTHER');
    expect(
      (await as(tpo).post(`/admin/outcomes/exam/${other.id}/decision`).send({ decision: 'reject' })).status,
    ).toBe(400);
    const no = await as(tpo)
      .post(`/admin/outcomes/exam/${other.id}/decision`)
      .send({ decision: 'reject', reason: 'Not a state-level exam' });
    expect(no.body.data).toMatchObject({ status: 'rejected', reason: 'Not a state-level exam' });
    expect(
      (
        await as(tpo)
          .post('/admin/outcomes/exam/0123456789abcdef01234567/decision')
          .send({ decision: 'verify' })
      ).status,
    ).toBe(404);
    await runInTenant(T._id, async () => {
      const notes = await NotificationModel.find({
        userId: s1.id,
        type: { $in: ['outcome_verified', 'outcome_rejected'] },
      }).lean();
      expect(notes.map((n) => n.type).sort()).toEqual(['outcome_rejected', 'outcome_verified']);
      // Ids, names and titles only: never the reason text.
      expect(JSON.stringify(notes)).not.toContain('state-level');
      expect(
        await AuditModel.countDocuments({ action: 'placements.outcome_verified', actorId: tpo.id }),
      ).toBe(1);
    });
    expect(
      (await as(s1).get('/me/outcomes')).body.data.find((o: { id: string }) => o.id === other.id).reason,
    ).toBe('Not a state-level exam');
  });

  it('a member takes back an unverified outcome, never a verified one', async () => {
    const mine = (await as(s1).get('/me/outcomes')).body.data;
    const gate = mine.find((o: { kind: string; exam?: string }) => o.kind === 'exam' && o.exam === 'GATE');
    const hs = mine.find((o: { kind: string }) => o.kind === 'higher_study');
    expect((await as(s2).delete(`/me/outcomes/exam/${gate.id}`)).status).toBe(404);
    expect((await as(s1).delete(`/me/outcomes/higher_study/${hs.id}`)).status).toBe(404);
    expect((await as(s1).delete(`/me/outcomes/exam/${gate.id}`)).status).toBe(200);
  });

  it('the college’s sheet imports verified outcomes by roll number; unknown rolls come back', async () => {
    const csv = [
      'Roll No,Exam,Year,Rank',
      '22OC1A0001,GATE,2026,AIR 1500',
      '22OC1A0002,ielts,2026,7.5',
      '99XX0000,CAT,2026,99',
      '22OC1A0002,Unknown test,2026,',
    ].join('\n');
    const r = await as(tpo).post('/admin/outcomes/exam/import').attach('file', Buffer.from(csv), 'exams.csv');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ created: 2, updated: 0, unknown: ['99XX0000'] });
    expect(r.body.data.errors).toEqual([{ row: 5, message: expect.stringContaining('Exam not recognised') }]);
    // Again: the same exam and year update instead of adding.
    const again = await as(tpo)
      .post('/admin/outcomes/exam/import')
      .attach('file', Buffer.from(csv), 'exams.csv');
    expect(again.body.data).toMatchObject({ created: 0, updated: 2 });
    await runInTenant(T._id, async () => {
      expect(await ExamQualificationModel.findOne({ userId: s2.id, exam: 'IELTS' }).lean()).toMatchObject({
        status: 'verified',
        source: 'import',
        level: 'international',
        branch: 'ECE',
        scoreBand: '7.5',
      });
    });
    expect(
      (
        await as(tpo)
          .post('/admin/outcomes/exam/import')
          .attach('file', Buffer.from('Name,Exam\nA,GATE'), 'x.csv')
      ).status,
    ).toBe(400);
  });

  it('waiting outcomes count on the admin overview with offers', async () => {
    await as(s2).post('/me/outcomes/venture').send({ name: 'Demo Labs', registered: false, year: 2026 });
    const ov = (await as(tpo).get('/admin/overview')).body.data;
    expect(ov.offers.pending).toBeGreaterThanOrEqual(2);
  });
});
