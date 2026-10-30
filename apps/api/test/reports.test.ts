/**
 * Build B8: every report definition against a fixture with known answers, small-count
 * suppression, the audited exports and the dashboard.
 */
import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { EventModel } from '../src/modules/events/event.model.js';
import { BookingModel } from '../src/modules/sessions/booking.model.js';
import { DriveRegistrationModel, OfferModel } from '../src/modules/placements/placements.model.js';
import {
  ExamQualificationModel,
  HigherStudyModel,
  VentureModel,
} from '../src/modules/placements/outcomes.model.js';
import { ctcBand } from '@campuslink/shared';

const ctx = testApp();
let T: TestTenant;
let tpo: TestUser, faculty: TestUser, alum: TestUser, named: TestUser;
const as = (u: TestUser) => api(ctx, T.host, u.token);
const id = () => new Types.ObjectId();

/** A verified offer for a (made-up) member of a batch. */
const offer = (
  userId: Types.ObjectId | null,
  branch: string,
  gradYear: number,
  company: string,
  ctc: number | null,
  extra: Record<string, unknown> = {},
) => ({
  userId,
  companyKey: company.toLowerCase(),
  companyName: company,
  role: 'Engineer',
  ctcLpa: ctc,
  ctcBand: ctcBand(ctc ?? 4),
  offerDate: new Date(`${gradYear - 1}-11-01`),
  type: 'full_time',
  source: 'drive',
  status: 'verified',
  branch,
  gradYear,
  ...extra,
});
const verified = { status: 'verified', source: 'tpo' };

beforeAll(async () => {
  T = await makeTenant('reports-b8');
  tpo = await makeUser(ctx, T, { roles: ['TPO'] });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  alum = await makeUser(ctx, T, { roles: ['ALUMNI'] });
  named = await makeUser(ctx, T, { roles: ['STUDENT'] });
  await runInTenant(T._id, async () => {
    // The college list: CSE 10 per batch for 2024 to 2026, ECE 6 in 2026.
    let n = 0;
    const roster = (branch: string, gradYear: number, count: number) =>
      Array.from({ length: count }, () => ({
        rollNumber: `RP${String(++n).padStart(6, '0')}`,
        name: `Roster ${n}`,
        branch,
        gradYear,
        kind: 'student',
        source: 'import',
      }));
    await WhitelistModel.create([
      ...roster('CSE', 2024, 10),
      ...roster('CSE', 2025, 10),
      ...roster('CSE', 2026, 10),
      ...roster('ECE', 2026, 6),
    ]);
    await WhitelistModel.updateOne(
      { rollNumber: 'RP000021' },
      { $set: { status: 'claimed', claimedBy: named.id, name: 'Named Student' } },
    );
    await ProfileModel.updateOne(
      { userId: named.id },
      { $set: { name: 'Named Student', branch: 'CSE', gradYear: 2026 } },
    );

    // 2024: six placed (one with two offers), one with an internship only.
    const c24 = Array.from({ length: 6 }, id);
    await OfferModel.create([
      ...c24.map((u) => offer(u, 'CSE', 2024, 'Acme (demo)', 5)),
      offer(c24[0] as Types.ObjectId, 'CSE', 2024, 'Birch (demo)', 7),
      offer(id(), 'CSE', 2024, 'Acme (demo)', 2, { type: 'internship' }),
    ]);
    // 2025: five placed.
    await OfferModel.create(Array.from({ length: 5 }, () => offer(id(), 'CSE', 2025, 'Acme (demo)', 6)));
    // 2026: seven placed: Named Student, five more, and one erased member with two offers.
    const c26 = [new Types.ObjectId(named.id), ...Array.from({ length: 5 }, id)];
    const ctcs = [4, 5, 6, 7, 8, 9];
    await OfferModel.create([
      ...c26.map((u, i) => offer(u, 'CSE', 2026, i < 4 ? 'Acme (demo)' : 'Birch (demo)', ctcs[i] as number)),
      offer(null, 'CSE', 2026, 'Birch (demo)', null, { anonKey: 'erased-1', ctcBand: '8_12' }),
      offer(null, 'CSE', 2026, 'Acme (demo)', null, { anonKey: 'erased-1', ctcBand: '5_8' }),
      // Not verified: never counted.
      offer(id(), 'CSE', 2026, 'Cedar (demo)', 30, { status: 'reported' }),
    ]);
    // Registrations: the seven placed in 2026 plus two more CSE, two ECE; none in 2025.
    await DriveRegistrationModel.create([
      ...c26.map((u) => ({ driveId: id(), userId: u, branch: 'CSE', gradYear: 2026 })),
      { driveId: id(), userId: null, anonKey: 'erased-1', branch: 'CSE', gradYear: 2026 },
      { driveId: id(), userId: id(), branch: 'CSE', gradYear: 2026 },
      { driveId: id(), userId: id(), branch: 'CSE', gradYear: 2026 },
      { driveId: id(), userId: id(), branch: 'ECE', gradYear: 2026 },
      { driveId: id(), userId: id(), branch: 'ECE', gradYear: 2026 },
      { driveId: id(), userId: id(), branch: 'ECE', gradYear: 2026, status: 'withdrawn' },
    ]);
    // Higher studies: 2024 one (with GATE), 2025 two at the same place, 2026 one reported only.
    await HigherStudyModel.create([
      {
        ...verified,
        userId: id(),
        branch: 'CSE',
        gradYear: 2024,
        institution: 'IIT Demo',
        program: 'M.Tech',
        country: 'India',
        admitYear: 2024,
        qualifyingExam: 'GATE',
      },
      ...[0, 1].map(() => ({
        ...verified,
        userId: id(),
        branch: 'CSE',
        gradYear: 2025,
        institution: 'Demo University',
        program: 'MS CS',
        country: 'Germany',
        admitYear: 2025,
      })),
      {
        status: 'reported',
        source: 'self',
        userId: id(),
        branch: 'CSE',
        gradYear: 2026,
        institution: 'X',
        program: 'Y',
        admitYear: 2026,
      },
    ]);
    await VentureModel.create({
      ...verified,
      userId: id(),
      branch: 'CSE',
      gradYear: 2026,
      name: 'Demo Startup',
      registered: true,
      year: 2026,
    });
    // Exams qualified in 2026: five GATE, one IELTS.
    await ExamQualificationModel.create([
      ...Array.from({ length: 5 }, () => ({
        ...verified,
        userId: id(),
        branch: 'CSE',
        gradYear: 2026,
        exam: 'GATE',
        year: 2026,
        level: 'national',
      })),
      {
        ...verified,
        userId: id(),
        branch: 'ECE',
        gradYear: 2026,
        exam: 'IELTS',
        year: 2026,
        level: 'international',
      },
    ]);
    // Alumni engagement in 2025-26: two events hosted by an alumna, one by faculty, three sessions.
    const event = (hostId: string, at: string) => ({
      title: `Demo talk ${at}`,
      description: 'Demo',
      kind: 'meetup',
      mode: 'online',
      startsAt: new Date(at),
      endsAt: new Date(new Date(at).getTime() + 3600_000),
      hostId: new Types.ObjectId(hostId),
    });
    await EventModel.create([
      event(alum.id, '2025-08-01'),
      event(alum.id, '2026-02-01'),
      event(faculty.id, '2026-01-10'),
      event(alum.id, '2024-12-01'),
    ]);
    await BookingModel.create(
      [0, 1, 2].map((i) => ({
        requestId: id(),
        mentorId: new Types.ObjectId(alum.id),
        menteeId: id(),
        participants: [new Types.ObjectId(alum.id)],
        sessionType: 'video_1on1',
        start: new Date(`2026-03-0${i + 1}T10:00:00Z`),
        end: new Date(`2026-03-0${i + 1}T10:30:00Z`),
        holds: [`b8-test-${i}`],
        room: `b8-room-${i}`,
        status: 'completed',
        completedAt: new Date(`2026-03-0${i + 1}T10:30:00Z`),
      })),
    );
  });
});

const run = async (rid: string, q = 'branch=CSE&gradYear=2026') => {
  const r = await as(tpo).get(`/admin/outcome-reports/${rid}?${q}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data;
};

describe('report definitions (B8)', () => {
  it('lists every definition with its framework, version and review flag', async () => {
    const list = (await as(tpo).get('/admin/outcome-reports')).body.data;
    expect(list.map((d: { id: string }) => d.id)).toEqual([
      'internal-placement',
      'nba-sar-placement',
      'naac-placement',
      'naac-higher-education',
      'naac-exams',
      'naac-alumni-engagement',
      'nirf-median-salary',
    ]);
    expect(list.find((d: { id: string }) => d.id === 'nba-sar-placement')).toMatchObject({
      framework: 'NBA',
      needsReview: true,
      threeYears: true,
    });
  });

  it('NBA SAR: x, y, z and N per year, the ratio, the average and the assessment line', async () => {
    const r = await run('nba-sar-placement');
    expect(r.params.gradYears).toEqual([2024, 2025, 2026]);
    expect(r.rows).toEqual([
      {
        year: '2023-24',
        finalYear: 10,
        placed: 6,
        higherStudies: '<5',
        withExam: '<5',
        entrepreneurs: 0,
        ratio: 0.7,
      },
      {
        year: '2024-25',
        finalYear: 10,
        placed: 5,
        higherStudies: '<5',
        withExam: 0,
        entrepreneurs: 0,
        ratio: 0.7,
      },
      // The erased member's two offers count once; the internship and the reported offer never.
      {
        year: '2025-26',
        finalYear: 10,
        placed: 7,
        higherStudies: 0,
        withExam: 0,
        entrepreneurs: '<5',
        ratio: 0.8,
      },
    ]);
    expect(r.totals).toEqual({ year: 'Average of the three years', ratio: 0.73 });
    expect(r.notes[0]).toContain('30 × 0.73 = 21.9');
  });

  it('NAAC placement: employers per programme with the median band, suppressed under 5', async () => {
    const r = await run('naac-placement');
    expect(r.rows).toEqual([
      { year: '2025-26', programme: 'CSE', company: 'Acme (demo)', students: 5, band: '5_8' },
      { year: '2025-26', programme: 'CSE', company: 'Birch (demo)', students: '<5', band: '8_12' },
    ]);
    expect(r.totals).toEqual({ year: 'Total', students: 7 });
  });

  it('NAAC higher education, exams and alumni engagement', async () => {
    const hs = await run('naac-higher-education', 'branch=CSE&gradYear=2025');
    expect(hs.rows).toEqual([
      {
        year: '2024-25',
        programme: 'CSE',
        institution: 'Demo University',
        admittedTo: 'MS CS',
        country: 'Germany',
        students: '<5',
      },
    ]);
    expect(hs.notes[0]).toBe('Of these, abroad: <5.');
    const ex = await run('naac-exams', 'gradYear=2026');
    expect(ex.rows).toEqual([
      { year: '2026', exam: 'GATE', level: 'national', students: 5 },
      { year: '2026', exam: 'IELTS', level: 'international', students: '<5' },
    ]);
    expect(ex.totals).toEqual({ year: 'Total', students: 6 });
    const al = await run('naac-alumni-engagement', 'gradYear=2026');
    expect(al.rows.map((x: { measure: string; value: unknown }) => [x.measure, x.value])).toEqual([
      ['Events hosted by alumni', '<5'],
      ['Alumni who hosted events', '<5'],
      ['Mentoring sessions held by alumni', '<5'],
      ['Alumni mentors', '<5'],
      ['Referrals given by alumni', 0],
      ['Alumni who gave referrals', 0],
    ]);
  });

  it('NIRF median salary: one salary per student, the median only from five exact figures', async () => {
    const r = await run('nirf-median-salary');
    expect(r.rows).toEqual([
      // 2024: best offers 7, 5, 5, 5, 5, 5 → median 5.
      { year: '2023-24', programme: 'CSE', placed: 6, median: 5 },
      { year: '2024-25', programme: 'CSE', placed: 5, median: 6 },
      // 2026: exact 4 to 9 (the erased member has only a band) → 6.5.
      { year: '2025-26', programme: 'CSE', placed: 7, median: 6.5 },
    ]);
  });

  it('internal: seeking against placed by branch, offers per student, last year', async () => {
    const r = await run('internal-placement', 'gradYear=2026');
    expect(r.rows).toEqual([
      {
        programme: 'CSE',
        finalYear: 10,
        seeking: 9,
        placed: 7,
        placementPct: 77.8,
        offersPerStudent: 1.14,
        band: '5_8',
        lastYearPct: 100,
      },
      // Two seeking in ECE: the percentage is left out rather than shown from a small count.
      {
        programme: 'ECE',
        finalYear: 6,
        seeking: '<5',
        placed: 0,
        placementPct: null,
        offersPerStudent: null,
        band: null,
        lastYearPct: null,
      },
    ]);
    expect(r.totals).toMatchObject({
      programme: 'All',
      finalYear: 16,
      seeking: 11,
      placed: 7,
      placementPct: 63.6,
    });
  });

  it('the dashboard: placement %, median band, top recruiters and five years of trend', async () => {
    const d = (await as(tpo).get('/admin/outcome-reports/dashboard?gradYear=2026')).body.data;
    expect(d).toMatchObject({
      gradYear: 2026,
      finalYear: 16,
      seeking: 11,
      placed: 7,
      placementPct: 63.6,
      medianBand: '5_8',
      higherStudies: 0,
      topRecruiters: [
        { company: 'Acme (demo)', students: 5 },
        { company: 'Birch (demo)', students: '<5' },
      ],
    });
    expect(d.trend.map((t: { gradYear: number }) => t.gradYear)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(d.trend.at(-2)).toEqual({ gradYear: 2025, placementPct: 100 });
  });
});

describe('report downloads (B8)', () => {
  it('the summary keeps suppression, names the framework and is audited', async () => {
    const r = await as(tpo).get(
      '/admin/outcome-reports/nba-sar-placement/export?branch=CSE&gradYear=2026&format=csv',
    );
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.text).toContain('Placement, higher studies and entrepreneurship (SAR)');
    expect(r.text).toContain('"<5"');
    expect(r.text).toMatch(/Generated by .+ on \d{4}-\d{2}-\d{2} from verified records\./);
    const x = await as(tpo).get('/admin/outcome-reports/naac-placement/export?gradYear=2026&format=xlsx');
    expect(x.headers['content-type']).toContain('spreadsheetml');
    await runInTenant(T._id, async () => {
      expect(await AuditModel.countDocuments({ action: 'reports.exported', actorId: tpo.id })).toBe(2);
    });
  });

  it('the evidence workbook has every student and is audited with the row count', async () => {
    const r = await as(tpo)
      .get('/admin/outcome-reports/naac-placement/evidence?branch=CSE&gradYear=2026')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect((r.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await runInTenant(T._id, async () => {
      const a = await AuditModel.findOne({ action: 'reports.evidence_exported' }).lean();
      expect(a).toMatchObject({ actorId: new Types.ObjectId(tpo.id), targetId: 'naac-placement' });
      expect((a?.meta as { rows: number }).rows).toBe(8);
    });
  });

  it('reports need analytics:tenant; downloads need reports:export', async () => {
    expect((await as(faculty).get('/admin/outcome-reports')).status).toBe(403);
    expect((await as(faculty).get('/admin/outcome-reports/internal-placement')).status).toBe(403);
    expect((await as(faculty).get('/admin/outcome-reports/internal-placement/evidence')).status).toBe(403);
    expect((await as(alum).get('/admin/outcome-reports/dashboard')).status).toBe(403);
    expect((await as(tpo).get('/admin/outcome-reports/not-a-report')).status).toBe(400);
  });
});
