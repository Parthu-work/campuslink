import { beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  jpegWithExif,
  makeTenant,
  makeUser,
  testApp,
  type TestTenant,
  type TestUser,
} from './helpers.js';
import { tinyPdf } from './jobs-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { EventModel } from '../src/modules/events/event.model.js';
import { FileModel } from '../src/modules/files/file.model.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { invalidateTenant } from '../src/modules/tenants/tenant.cache.js';
import { AcademicRecordModel, DriveRegistrationModel } from '../src/modules/placements/placements.model.js';
import { DRIVE_REMINDER_JOB } from '../src/modules/placements/placements.service.js';

const ctx = testApp();
let T: TestTenant;
type Student = TestUser & { roll: string };
let tpo: TestUser, alum: TestUser, strong: Student, low: Student, ece: Student;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const DAY = 86_400_000;
let seq = 0;

/** A verified student with a claimed roll number, a profile cohort and (optionally) an imported record. */
async function student(branch: string, gradYear: number, record?: { cgpa: number; activeBacklogs?: number }) {
  const u = await makeUser(ctx, T, { roles: ['STUDENT'] });
  const roll = `23PL1A${String(++seq).padStart(4, '0')}`;
  await runInTenant(T._id, async () => {
    await WhitelistModel.create({
      rollNumber: roll,
      name: `Placement Student ${seq}`,
      branch,
      gradYear,
      kind: 'student',
      source: 'import',
      status: 'claimed',
      claimedBy: u.id,
      claimedAt: new Date(),
    });
    await ProfileModel.updateOne({ userId: u.id }, { $set: { branch, gradYear } });
    if (record)
      await AcademicRecordModel.create({
        rollNumber: roll,
        cgpa: record.cgpa,
        activeBacklogs: record.activeBacklogs ?? 0,
        historyBacklogs: 0,
        source: 'import',
        verifiedAt: new Date(),
      });
  });
  return Object.assign(u, { roll });
}

const driveBody = (over: Record<string, unknown> = {}) => ({
  companyName: 'Nimbus Labs (demo)',
  title: 'SDE trainee',
  roles: [
    { title: 'Software engineer', ctcMinLpa: 6, ctcMaxLpa: 8, location: 'Hyderabad', type: 'full_time' },
  ],
  mode: 'on_campus',
  venue: 'Block A seminar hall',
  driveDate: new Date(Date.now() + 10 * DAY).toISOString(),
  registrationCloseAt: new Date(Date.now() + 5 * DAY).toISOString(),
  eligibility: { branches: ['CSE'], gradYears: [2027], minCgpa: 6.5, maxActiveBacklogs: 0 },
  questions: [{ label: 'Preferred location', kind: 'choice', options: ['Hyderabad', 'Bengaluru'] }],
  rounds: [
    { name: 'Aptitude', kind: 'aptitude' },
    { name: 'HR', kind: 'hr' },
  ],
  resumeRequired: true,
  ...over,
});
async function openDrive(over: Record<string, unknown> = {}) {
  const c = await as(tpo).post('/admin/placements/drives').send(driveBody(over));
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const o = await as(tpo).post(`/admin/placements/drives/${c.body.data.id}/status`).send({ status: 'open' });
  expect(o.status, JSON.stringify(o.body)).toBe(200);
  await ctx.queue.drain();
  return c.body.data.id as string;
}
async function resume(u: TestUser) {
  const r = await as(u)
    .post('/placements/resume')
    .attach('file', await tinyPdf(), 'cv.pdf');
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.id as string;
}
const register = async (u: TestUser, id: string) =>
  as(u)
    .post(`/placements/drives/${id}/register`)
    .send({ answers: [{ question: 0, value: 'Hyderabad' }], resumeFileId: await resume(u) });
const notified = (u: TestUser, type: string) =>
  runInTenant(T._id, () => NotificationModel.countDocuments({ userId: u.id, type }));

beforeAll(async () => {
  T = await makeTenant('placetest');
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  strong = await student('CSE', 2027, { cgpa: 8.1 });
  low = await student('CSE', 2027, { cgpa: 6.2 });
  ece = await student('ECE', 2027, { cgpa: 9 });
});

describe('placements access (B7)', () => {
  it('students and alumni cannot run drives; alumni do not see them; the switch turns it all off', async () => {
    expect((await as(strong).post('/admin/placements/drives').send(driveBody())).status).toBe(403);
    expect((await as(strong).get('/admin/offers')).status).toBe(403);
    expect((await as(alum).get('/placements/drives')).status).toBe(403);
    expect((await as(tpo).post('/placements/drives/x/register').send({})).status).toBe(403);
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'features.placements': false } });
    invalidateTenant(T.slug);
    const off = await as(strong).get('/placements/drives');
    await TenantModel.updateOne({ _id: T._id }, { $set: { 'features.placements': true } });
    invalidateTenant(T.slug);
    expect([off.status, off.body.error?.code]).toEqual([403, 'FEATURE_DISABLED']);
  });
});

describe('drives (B7)', () => {
  it('a draft is hidden; opening notifies only eligible students and links a calendar event', async () => {
    const c = await as(tpo)
      .post('/admin/placements/drives')
      .send(driveBody({ createEvent: true }));
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const id = c.body.data.id as string;
    expect(c.body.data.status).toBe('draft');
    const event = await runInTenant(T._id, () => EventModel.findById(c.body.data.linkedEventId).lean());
    expect(event?.kind).toBe('drive');
    expect((await as(strong).get(`/placements/drives/${id}`)).status).toBe(404);
    await as(tpo).post(`/admin/placements/drives/${id}/status`).send({ status: 'open' });
    await ctx.queue.drain();
    expect(await notified(strong, 'drive_open')).toBeGreaterThanOrEqual(1);
    expect(await notified(low, 'drive_open')).toBe(0);
    expect(await notified(ece, 'drive_open')).toBe(0);
    // Open a second time (closed → open) does not notify again.
    const before = await notified(strong, 'drive_open');
    await as(tpo).post(`/admin/placements/drives/${id}/status`).send({ status: 'closed' });
    await as(tpo).post(`/admin/placements/drives/${id}/status`).send({ status: 'open' });
    await ctx.queue.drain();
    expect(await notified(strong, 'drive_open')).toBe(before);
    expect(
      (await as(tpo).post(`/admin/placements/drives/${id}/status`).send({ status: 'completed' })).status,
    ).toBe(409);
  });

  it('an ineligible student sees why, and an override (audited) lets them register', async () => {
    const id = await openDrive();
    const view = (await as(low).get(`/placements/drives/${id}`)).body.data;
    expect(view).toMatchObject({ eligible: false, registrationOpen: true });
    expect(view.reasons).toEqual([{ kind: 'cgpa', have: 6.2, need: 6.5 }]);
    expect((await register(low, id)).status).toBe(403);
    expect(
      (await as(strong).get('/placements/drives?scope=eligible')).body.data.map((d: { id: string }) => d.id),
    ).toContain(id);
    expect(
      (await as(low).get('/placements/drives?scope=eligible')).body.data.map((d: { id: string }) => d.id),
    ).not.toContain(id);
    const o = await as(tpo)
      .post(`/admin/placements/drives/${id}/override`)
      .send({ rollNumber: low.roll, reason: 'Revaluation result pending' });
    expect(o.status).toBe(200);
    const audit = await runInTenant(T._id, () =>
      AuditModel.findOne({ action: 'placements.override', targetId: low.id }).lean(),
    );
    expect(audit?.actorId?.toString()).toBe(tpo.id);
    const r = await register(low, id);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe('tpo_override');
  });

  it('registration needs the answers and the résumé, and a race leaves exactly one registration', async () => {
    const id = await openDrive();
    expect(
      (
        await as(strong)
          .post(`/placements/drives/${id}/register`)
          .send({ answers: [], resumeFileId: await resume(strong) })
      ).status,
    ).toBe(400);
    expect(
      (
        await as(strong)
          .post(`/placements/drives/${id}/register`)
          .send({ answers: [{ question: 0, value: 'Mumbai' }], resumeFileId: await resume(strong) })
      ).status,
    ).toBe(400);
    const [a, b] = await Promise.all([register(strong, id), register(strong, id)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const n = await runInTenant(T._id, () =>
      DriveRegistrationModel.countDocuments({ driveId: id, userId: strong.id }),
    );
    expect(n).toBe(1);
    // Withdraw, then register again: still one row.
    expect((await as(strong).post(`/placements/drives/${id}/withdraw`)).body.data.status).toBe('withdrawn');
    expect((await register(strong, id)).status).toBe(201);
    expect(
      await runInTenant(T._id, () =>
        DriveRegistrationModel.countDocuments({ driveId: id, userId: strong.id }),
      ),
    ).toBe(1);
  });

  it('the reminder carries the drive version: a moved close time cancels the old one', async () => {
    const id = await openDrive();
    const job = () => ctx.queue.delayed.find((j) => j.name === DRIVE_REMINDER_JOB && j.data.driveId === id);
    const first = job();
    expect(first).toBeTruthy();
    const firstVersion = first?.data.version;
    const view = (await as(tpo).get(`/placements/drives/${id}`)).body.data;
    const moved = await as(tpo)
      .put(`/admin/placements/drives/${id}`)
      .send({
        ...driveBody(),
        companyId: view.company.id,
        companyName: undefined,
        registrationCloseAt: new Date(Date.now() + 6 * DAY).toISOString(),
      });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(job()?.data.version).toBe((firstVersion as number) + 1);
    // A job carrying the old version does nothing.
    await ctx.queue.enqueue(DRIVE_REMINDER_JOB, {
      tenantId: String(T._id),
      driveId: id,
      version: firstVersion,
    });
    await ctx.queue.drain();
    const before = await notified(strong, 'drive_reminder');
    expect(before).toBe(0);
    await ctx.queue.runDelayed({ name: DRIVE_REMINDER_JOB });
    expect(await notified(strong, 'drive_reminder')).toBeGreaterThanOrEqual(1);
    expect(await notified(ece, 'drive_reminder')).toBe(0);
  });
});

describe('the placement cell’s workflow (B7)', () => {
  let id = '';
  beforeAll(async () => {
    id = await openDrive({ title: 'Workflow drive' });
    expect((await register(strong, id)).status).toBe(201);
  });

  it('exports only the ticked columns, as CSV or Excel, and audits it', async () => {
    const csv = await as(tpo).get(`/admin/placements/drives/${id}/export?columns=rollNumber,name,cgpa`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('Roll number,Name,CGPA');
    expect(lines[1]).toBe(`${strong.roll},Test Person,8.1`);
    expect(csv.text).not.toContain('@');
    const audit = await runInTenant(T._id, () =>
      AuditModel.findOne({ action: 'placements.exported', targetId: id }).sort({ _id: -1 }).lean(),
    );
    expect(audit?.meta).toMatchObject({ columns: ['rollNumber', 'name', 'cgpa'], format: 'csv', rows: 1 });
    const xlsx = await as(tpo)
      .get(`/admin/placements/drives/${id}/export?columns=rollNumber,email&format=xlsx`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect((await as(tpo).get(`/admin/placements/drives/${id}/export?columns=gender`)).status).toBe(400);
    expect((await as(strong).get(`/admin/placements/drives/${id}/export?columns=name`)).status).toBe(403);
  });

  it('round results notify the student; a CSV lists unknown roll numbers instead of guessing', async () => {
    const regs = (await as(tpo).get(`/admin/placements/drives/${id}/registrants`)).body.data;
    const reg = regs.find((r: { userId: string }) => r.userId === strong.id);
    expect(reg).toMatchObject({ rollNumber: strong.roll, cgpa: 8.1 });
    expect(reg.resumeFileId).toMatch(/^[a-f0-9]{24}$/);
    const r = await as(tpo)
      .put(`/admin/placements/drives/${id}/rounds/0`)
      .send({ results: [{ registrationId: reg.id, result: 'cleared' }] });
    expect(r.body.data).toEqual({ updated: 1, unchanged: 0 });
    expect(await notified(strong, 'drive_round_result')).toBe(1);
    const sheet = [
      'Roll No,Result',
      `${strong.roll},Selected`,
      '99ZZ1A9999,cleared',
      `${low.roll},maybe`,
    ].join('\n');
    const imp = await as(tpo)
      .post(`/admin/placements/drives/${id}/rounds/1/import`)
      .attach('file', Buffer.from(sheet), 'hr.csv');
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    expect(imp.body.data).toMatchObject({ updated: 1, unknown: ['99ZZ1A9999'] });
    expect(imp.body.data.errors).toEqual([{ row: 4, message: expect.stringMatching(/not recognised/) }]);
    const mine = (await as(strong).get(`/placements/drives/${id}`)).body.data.myRegistration;
    expect(mine.roundResults).toEqual(
      expect.arrayContaining([
        { round: 0, result: 'cleared' },
        { round: 1, result: 'cleared' },
      ]),
    );
  });

  it('a selection records a verified offer the member sees with the exact CTC', async () => {
    const regs = (await as(tpo).get(`/admin/placements/drives/${id}/registrants`)).body.data;
    const reg = regs.find((r: { userId: string }) => r.userId === strong.id);
    const f = await as(tpo)
      .put(`/admin/placements/registrations/${reg.id}/final`)
      .send({ final: 'selected', ctcLpa: 7.5 });
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    // Twice does not make two offers.
    await as(tpo)
      .put(`/admin/placements/registrations/${reg.id}/final`)
      .send({ final: 'selected', ctcLpa: 7.5 });
    const offers = (await as(strong).get('/placements/offers')).body.data;
    expect(offers).toEqual([
      expect.objectContaining({
        companyName: 'Nimbus Labs (demo)',
        ctcLpa: 7.5,
        ctcBand: '5_8',
        status: 'verified',
        source: 'drive',
      }),
    ]);
    expect(await notified(strong, 'drive_selected')).toBe(1);
    expect((await as(low).get('/placements/offers')).body.data).toEqual([]);
  });
});

describe('offers reported by members (B7)', () => {
  it('needs proof, waits for the cell, and verification keeps the proof 30 days', async () => {
    const proof = await as(alum)
      .post('/placements/offers/proof')
      .attach('file', await jpegWithExif(), 'offer.jpg');
    expect(proof.status, JSON.stringify(proof.body)).toBe(201);
    const body = {
      companyName: 'Orbit Analytics (demo)',
      role: 'Data analyst',
      ctcLpa: 12.5,
      offerDate: new Date(Date.now() - DAY).toISOString(),
      type: 'full_time',
      source: 'off_campus',
      proofFileId: proof.body.data.id,
    };
    const r = await as(alum).post('/placements/offers').send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'reported', ctcBand: '12_20', hasProof: true });
    // The same proof cannot be used twice.
    expect((await as(alum).post('/placements/offers').send(body)).status).toBe(400);
    const queue = (await as(tpo).get('/admin/offers?status=reported')).body.data;
    expect(queue.find((o: { id: string }) => o.id === r.body.data.id)?.member.userId).toBe(alum.id);
    // The verifier can read the proof; another member cannot.
    expect((await as(tpo).get(`/files/${proof.body.data.id}`)).status).toBe(200);
    expect((await as(strong).get(`/files/${proof.body.data.id}`)).status).toBe(404);
    expect(
      (await as(tpo).post(`/admin/offers/${r.body.data.id}/decision`).send({ decision: 'reject' })).status,
    ).toBe(400);
    const v = await as(tpo).post(`/admin/offers/${r.body.data.id}/decision`).send({ decision: 'verify' });
    expect(v.body.data.status).toBe('verified');
    expect(await notified(alum, 'offer_verified')).toBe(1);
    const file = await runInTenant(T._id, () => FileModel.findById(proof.body.data.id).lean());
    const keepDays = ((file?.deleteAfter?.getTime() ?? 0) - Date.now()) / DAY;
    expect(keepDays).toBeGreaterThan(29);
    expect(keepDays).toBeLessThanOrEqual(30);
    expect(
      (await as(tpo).post(`/admin/offers/${r.body.data.id}/decision`).send({ decision: 'verify' })).status,
    ).toBe(409);
  });
});

describe('academic records (B7)', () => {
  it('a self-report counts only after the placement cell verifies it', async () => {
    const s = await student('CSE', 2027);
    const id = await openDrive({ title: 'Self-report drive' });
    expect((await as(s).get(`/placements/drives/${id}`)).body.data.reasons).toEqual([{ kind: 'noRecord' }]);
    const rep = await as(s).put('/me/academics').send({ cgpa: 7.2, activeBacklogs: 0, historyBacklogs: 1 });
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    expect(rep.body.data).toMatchObject({ source: 'self', verified: false });
    expect((await as(s).get(`/placements/drives/${id}`)).body.data.reasons).toEqual([
      { kind: 'unverifiedRecord' },
    ]);
    const pending = (await as(tpo).get('/admin/placements/academics/pending')).body.data;
    const row = pending.find((p: { rollNumber: string }) => p.rollNumber === s.roll);
    await as(tpo).post(`/admin/placements/academics/${row.id}/decision`).send({ decision: 'verify' });
    expect((await as(s).get(`/placements/drives/${id}`)).body.data.eligible).toBe(true);
    // A student with an imported record cannot overwrite it.
    expect(
      (await as(strong).put('/me/academics').send({ cgpa: 9.9, activeBacklogs: 0, historyBacklogs: 0 }))
        .status,
    ).toBe(409);
  });

  it('the imports wizard takes academic records keyed by roll number', async () => {
    const admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
    const s = await student('IT', 2027);
    const csv = ['Roll No,CGPA,Active Backlogs,10th %', `${s.roll},7.9,0,88%`, 'BAD!,x,1,50'].join('\n');
    const pre = await api(ctx, T.host, admin.token)
      .post('/admin/imports/preview/upload')
      .attach('file', Buffer.from(csv), 'marks.csv');
    expect(pre.body.data.suggestedAcademicMapping).toMatchObject({
      rollNumber: 'Roll No',
      cgpa: 'CGPA',
      activeBacklogs: 'Active Backlogs',
      tenthPct: '10th %',
    });
    const start = await api(ctx, T.host, admin.token)
      .post('/admin/imports')
      .send({
        previewId: pre.body.data.previewId,
        mapping: { type: 'academics', academicColumns: pre.body.data.suggestedAcademicMapping },
      });
    expect(start.status, JSON.stringify(start.body)).toBe(202);
    await ctx.queue.drain();
    const job = (await api(ctx, T.host, admin.token).get(`/admin/imports/${start.body.data.id}`)).body.data;
    // The bad row has an invalid roll number and an unreadable CGPA.
    expect(job.counts).toMatchObject({ created: 1, errors: 2 });
    const rec = await runInTenant(T._id, () => AcademicRecordModel.findOne({ rollNumber: s.roll }).lean());
    expect(rec).toMatchObject({ cgpa: 7.9, activeBacklogs: 0, tenthPct: 88, source: 'import' });
    expect((await as(s).get('/me/academics')).body.data).toMatchObject({ cgpa: 7.9, verified: true });
    // Figures are overwritten in place with no undo log: there is nothing to roll back.
    expect(
      (await api(ctx, T.host, admin.token).post(`/admin/imports/${start.body.data.id}/rollback`)).status,
    ).toBe(409);
  });
});

describe('overview (B7)', () => {
  it('counts drives closing within 48 hours and offers waiting for verification', async () => {
    await openDrive({
      title: 'Closing soon',
      registrationCloseAt: new Date(Date.now() + DAY).toISOString(),
    });
    const ov = (await as(tpo).get('/admin/overview')).body.data;
    expect(ov.placements.closingSoon).toBeGreaterThanOrEqual(1);
    expect(ov.offers).toMatchObject({ pending: expect.any(Number) });
  });
});
