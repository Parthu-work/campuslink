import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  EMPLOYER_LIMITS,
  gstinCheckDigit,
  type CandidateView,
  type CollegePostingView,
  type EmployerView,
  type PoolView,
  type PostingView,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { TenantModel } from '../src/modules/tenants/tenant.model.js';
import { clearTenantCache } from '../src/modules/tenants/tenant.cache.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import {
  DriveRegistrationModel,
  OfferModel,
  PlacementDriveModel,
} from '../src/modules/placements/placements.model.js';
import {
  BillableEventModel,
  EmployerUsageModel,
  PostingOfferModel,
} from '../src/modules/employers/employer.model.js';
import { NetworkCandidacyModel } from '../src/modules/network/network.model.js';
import type { EmployersDeps, EmployersService } from '../src/modules/employers/employers.service.js';
import type { CollegePostingsService } from '../src/modules/employers/college-postings.service.js';
import type { FilesService } from '../src/modules/files/files.service.js';
import type { PlatformService } from '../src/modules/platform/platform.service.js';

/** Prompt 2, G12 (ADR 0014 §9 to §11): employers, postings, pools, candidates and billing. N1 to N3, N23 to N31. */

const ctx = testApp();
const services = ctx.app.locals.services as {
  employers: EmployersService;
  collegePostings: CollegePostingsService;
  files: FilesService;
  platform: PlatformService;
};
const registry = () =>
  ctx.app.locals.registry as {
    module: string;
    spec: { method: string; path: string; scope?: string; access: { kind: string } };
  }[];
let A: TestTenant, B: TestTenant, C: TestTenant, P: TestTenant, E: TestTenant;
let adminA: TestUser,
  adminB: TestUser,
  adminC: TestUser,
  tpoA: TestUser,
  tpoB: TestUser,
  superAdmin: TestUser;
let boss: TestUser, recruiter: TestUser;
const students: TestUser[] = [];
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const inT = <R>(t: TestTenant, fn: () => Promise<R>) => runInTenant(t._id, fn);
const gstin = () => {
  const body = '36AABCA1234B1Z';
  return body + gstinCheckDigit(body);
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
let txt: string[][] = [];

async function switchOn(admin: TestUser) {
  await as(admin)
    .put('/admin/network/switches')
    .send({ alumniDiscovery: true, employerAccess: true, credentials: true, acceptTerms: true })
    .expect(200);
}
async function optIn(u: TestUser) {
  await as(u)
    .put('/network/me')
    .send({
      nameStyle: 'full',
      showCompany: false,
      showCity: false,
      showSkills: true,
      linkedinUrl: null,
      helpWith: [],
      acceptingIntros: false,
      introsPerWeek: 1,
      seeking: 'full_time',
    })
    .expect(200);
  await as(u).put('/network/consents').send({ purpose: 'employer_visibility', granted: true }).expect(200);
}
const posting = (over: Record<string, unknown> = {}) => ({
  title: 'Graduate Engineer Trainee',
  role: 'Software Engineer',
  type: 'full_time',
  location: 'Hyderabad',
  ctcRange: '6 to 8 LPA',
  description: 'Build and run services for our customers. Two rounds: coding and interview.',
  branches: ['CSE'],
  gradYears: [2027],
  closesAt: new Date(Date.now() + 30 * 864e5).toISOString(),
  ...over,
});

beforeAll(async () => {
  A = await makeTenant('empa');
  B = await makeTenant('empb');
  C = await makeTenant('empc');
  P = await makeTenant('empplatform', 'platform');
  adminA = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  adminC = await makeUser(ctx, C, { roles: ['COLLEGE_ADMIN'], mfa: true });
  tpoA = await makeUser(ctx, A, { roles: ['TPO'] });
  tpoB = await makeUser(ctx, B, { roles: ['TPO'] });
  superAdmin = await makeUser(ctx, P, { roles: ['SUPER_ADMIN'], mfa: true });
  for (let i = 0; i < 7; i++) {
    const s = await makeUser(ctx, A, { roles: ['STUDENT'], email: `student${i}@empa.example` });
    await inT(A, () =>
      ProfileModel.updateOne(
        { userId: s.id },
        { $set: { name: `Student ${i} Rao`, branch: 'CSE', gradYear: 2027, skills: ['Java'] } },
      ),
    );
    students.push(s);
  }
  await switchOn(adminA);
  await switchOn(adminB);
  await switchOn(adminC);
  // DNS answers come from a stub (no network in tests).
  Object.assign((services.employers as unknown as { d: EmployersDeps }).d, { resolveTxt: async () => txt });
});

describe('applying (N23, N24) and the employer kind (N1 to N3)', () => {
  const host = 'empplatform.localhost';
  const body = (over: Record<string, unknown> = {}) => ({
    companyName: 'Acme Analytics',
    legalName: 'Acme Analytics Private Limited',
    domain: 'acme.example',
    gstin: gstin(),
    slug: 'emp-acme',
    name: 'Priya Hiring',
    email: 'priya@acme.example',
    ...over,
  });

  it('refuses free mail, a bad GSTIN, a college-like address and an email outside the domain', async () => {
    const a = api(ctx, host);
    expect(
      (await a.post('/employers/apply').send(body({ domain: 'gmail.com', email: 'x@gmail.com' }))).status,
    ).toBe(400);
    expect((await a.post('/employers/apply').send(body({ gstin: '36AABCA1234B1ZZ' }))).status).toBe(400);
    expect((await a.post('/employers/apply').send(body({ slug: 'acme' }))).status).toBe(400);
    expect((await a.post('/employers/apply').send(body({ email: 'priya@other.example' }))).status).toBe(400);
  });

  it('creates a pending employer tenant and sends the set-password link to the work inbox', async () => {
    const r = await api(ctx, host).post('/employers/apply').send(body());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(ctx.mailer.lastTo('priya@acme.example')?.text).toContain('emp-acme.localhost');
    const t = await TenantModel.findOne({ slug: 'emp-acme' }).lean();
    expect(t).toMatchObject({ kind: 'employer', employer: { status: 'applied', domain: 'acme.example' } });
    E = { _id: t?._id as Types.ObjectId, slug: 'emp-acme', host: 'emp-acme.localhost' };
    expect(
      (
        await api(ctx, host)
          .post('/employers/apply')
          .send(body({ slug: 'emp-acme-two' }))
      ).status,
    ).toBe(409);
    boss = await makeUser(ctx, E, { roles: ['EMPLOYER_ADMIN'], mfa: true, email: 'boss@acme.example' });
  });

  it('a college can never take the employer prefix (N2)', async () => {
    await expect(
      services.platform.createTenant(
        superAdmin.id,
        {
          slug: 'emp-college',
          branding: {} as never,
          subscription: {} as never,
          firstAdmin: { name: 'X', email: 'x@y.example' },
        } as never,
        {},
      ),
    ).rejects.toThrow(/reserved for employers/);
  });

  it('every college route is a 404 on an employer host, and every employer route on a college host (N1)', async () => {
    const fake = '0123456789abcdef01234567';
    const failures: string[] = [];
    for (const { spec } of registry()) {
      if (spec.scope === 'any' || spec.scope === 'platform' || spec.path.startsWith('/:slug')) continue;
      const path = spec.path.replace(/:[A-Za-z]+/g, fake);
      const onEmployer = spec.scope === 'employer';
      const who = onEmployer ? adminA : boss;
      const r = await (
        api(ctx, who.tenant.host, who.token) as unknown as Record<
          string,
          (p: string) => {
            send: (b: unknown) => Promise<{ status: number; body: { error?: { code?: string } } }>;
          }
        >
      )[spec.method]!(path).send({});
      if (r.status !== 404 && r.status !== 401) failures.push(`${spec.method} ${spec.path} → ${r.status}`);
    }
    // Employer hosts serve no college route at all.
    const onEmployerHost = await api(ctx, E.host, boss.token).get('/feed');
    expect(onEmployerHost.body.error?.code).toBe('UNKNOWN_TENANT');
    expect(failures).toEqual([]);
  });

  it('employer roles need TOTP (N3)', async () => {
    const noTotp = await makeUser(ctx, E, { roles: ['RECRUITER'] });
    const r = await as(noTotp).get('/employer');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MFA_REQUIRED');
  });
});

describe('verification and approval (N25, N26)', () => {
  it('nothing is visible before approval', async () => {
    const r = await as(boss).get('/employer/pool');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NETWORK_NOT_ENABLED');
    const p = (await as(boss).post('/employer/postings').send(posting())).body.data as PostingView;
    expect(
      (
        await as(boss)
          .post(`/employer/postings/${p.id}/publish`)
          .send({ colleges: [String(A._id)] })
      ).status,
    ).toBe(403);
  });

  it('checks the DNS TXT record, then the platform approves (and reviews the applicant through P16)', async () => {
    const v = (await as(boss).get('/employer')).body.data as EmployerView;
    expect(
      (
        await api(ctx, P.host, superAdmin.token)
          .post(`/platform/employers/${v.id}/decision`)
          .send({ decision: 'approve' })
      ).status,
    ).toBe(409);
    txt = [['something-else']];
    expect((await as(boss).post('/employer/verify-domain')).status).toBe(400);
    txt = [[v.dnsToken]];
    const ok = (await as(boss).post('/employer/verify-domain')).body.data as EmployerView;
    expect(ok.status).toBe('verified');
    const review = await api(ctx, P.host, superAdmin.token).get(`/platform/employers/${v.id}`);
    expect(review.body.data.applicant).toMatchObject({ email: 'priya@acme.example' });
    expect(await inT(E, () => AuditModel.countDocuments({ action: 'network.employer-review' }))).toBe(1);
    expect(
      (
        await api(ctx, P.host, superAdmin.token)
          .post(`/platform/employers/${v.id}/decision`)
          .send({ decision: 'approve' })
      ).status,
    ).toBe(200);
    clearTenantCache();
    expect(((await as(boss).get('/employer')).body.data as EmployerView).status).toBe('approved');
    // A college cannot reach the registry.
    expect((await as(adminA).get('/platform/employers')).status).toBe(404);
  });

  it('recruiters only at the verified domain, at most ten seats', async () => {
    expect(
      (await as(boss).post('/employer/recruiters').send({ name: 'Out Sider', email: 'x@other.example' }))
        .status,
    ).toBe(400);
    expect(
      (
        await as(boss)
          .post('/employer/recruiters')
          .send({ name: 'Ravi Recruiter', email: 'ravi@acme.example' })
      ).status,
    ).toBe(200);
    recruiter = await makeUser(ctx, E, { roles: ['RECRUITER'], mfa: true, email: 'r2@acme.example' });
    expect(
      (await as(recruiter).post('/employer/recruiters').send({ name: 'No Rights', email: 'n@acme.example' }))
        .status,
    ).toBe(403);
    await inT(E, async () => {
      for (let i = 0; i < EMPLOYER_LIMITS.seats; i++)
        await UserModel.create({
          email: `seat${i}@acme.example`,
          name: 'Seat',
          passwordHash: 'x',
          roles: ['RECRUITER'],
          verified: true,
          ageCheckedAt: new Date(),
        });
    });
    expect(
      (await as(boss).post('/employer/recruiters').send({ name: 'One Too Many', email: 'many@acme.example' }))
        .status,
    ).toBe(409);
  });
});

describe('postings become drives through the college (N31)', () => {
  let p: PostingView;
  let offerA: CollegePostingView;

  it('offers a posting to chosen colleges; each sees only its own copy', async () => {
    p = (await as(recruiter).post('/employer/postings').send(posting())).body.data as PostingView;
    const r = await as(recruiter)
      .post(`/employer/postings/${p.id}/publish`)
      .send({ colleges: [String(A._id), String(B._id)] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const listA = (await as(tpoA).get('/admin/network')).body.data.postings as CollegePostingView[];
    expect(listA).toHaveLength(1);
    offerA = listA[0] as CollegePostingView;
    expect(offerA).toMatchObject({
      employer: { name: 'Acme Analytics' },
      decision: 'pending',
      ctcRange: '6 to 8 LPA',
    });
    expect(await inT(C, () => PostingOfferModel.countDocuments({}))).toBe(0);
  });

  it('approval creates the college’s drive; decline is told to the employer; billing is recorded once', async () => {
    const at = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
    const ok = await as(tpoA)
      .post(`/admin/network/postings/${offerA.id}/decision`)
      .send({ decision: 'approved', registrationCloseAt: at(10), driveDate: at(12) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const driveId = (ok.body.data as CollegePostingView).driveId as string;
    expect(await inT(A, () => PlacementDriveModel.countDocuments({ _id: driveId }))).toBe(1);
    expect(
      (
        await as(tpoA)
          .post(`/admin/network/postings/${offerA.id}/decision`)
          .send({ decision: 'declined', reason: 'timing' })
      ).status,
    ).toBe(409);
    const offerB = ((await as(tpoB).get('/admin/network')).body.data.postings as CollegePostingView[])[0];
    expect(
      (
        await as(tpoB)
          .post(`/admin/network/postings/${offerB?.id}/decision`)
          .send({ decision: 'declined', reason: 'timing' })
      ).status,
    ).toBe(200);
    const view = ((await as(recruiter).get('/employer/postings')).body.data as PostingView[]).find(
      (x) => x.id === p.id,
    );
    expect(view?.colleges.map((c) => c.decision).sort()).toEqual(['approved', 'declined']);
    expect((await inT(E, () => BillableEventModel.find({}).lean())).map((b) => b.kind).sort()).toEqual([
      'drive',
      'posting',
    ]);
  });

  it('pool sizes are counts only, below five as "<5", rounded down to five (N29)', async () => {
    for (const s of students.slice(0, 6)) await optIn(s);
    const pool = (await as(recruiter).get('/employer/pool?branch=CSE&gradYear=2027&skills=java')).body
      .data as PoolView;
    expect(pool.total).toBe(5);
    expect(pool.byCollege.find((c) => c.id === String(A._id))?.count).toBe(5);
    expect(JSON.stringify(pool)).not.toMatch(/Rao|@/);
    const small = (await as(recruiter).get('/employer/pool?branch=ECE')).body.data as PoolView;
    expect(small.total).toBe(0);
    await inT(A, () => ProfileModel.updateOne({ userId: students[6]?.id }, { $set: { branch: 'ECE' } }));
    await optIn(students[6] as TestUser);
    expect(((await as(recruiter).get('/employer/pool?branch=ECE')).body.data as PoolView).total).toBe('<5');
  });

  describe('candidates who applied and shared (P11 to P14; N10, N14, N16, N30)', () => {
    let cand: CandidateView;
    const student = () => students[0] as TestUser;

    beforeAll(async () => {
      const driveId = (await inT(A, () => PostingOfferModel.findOne({}).lean()))?.driveId;
      const file = await inT(A, () => services.files.storeResumePdf(student().id, PDF));
      await inT(A, () =>
        DriveRegistrationModel.create({
          driveId,
          userId: student().id,
          resumeFileId: new Types.ObjectId(String(file.id ?? (file as unknown as { _id: string })._id)),
          status: 'registered',
          branch: 'CSE',
          gradYear: 2027,
        }),
      );
      await inT(A, () =>
        OfferModel.create({
          userId: student().id,
          companyKey: 'other co',
          companyName: 'Other Co',
          role: 'Analyst',
          type: 'full_time',
          status: 'verified',
          source: 'off_campus',
          ctcBand: '5_8',
          ctcLpa: 7.75,
          offerDate: new Date(),
        }),
      );
      await inT(A, () => UserModel.updateOne({ _id: student().id }, { $set: { phoneEnc: null } }));
      const r = await as(student())
        .post('/network/candidacies')
        .send({ driveId: String(driveId) });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    });

    it('the employer sees the name, college, branch, batch and stage: never contact, CTC or other offers', async () => {
      const r = await as(recruiter).get(`/employer/postings/${p.id}/candidates`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const items = r.body.data.items as CandidateView[];
      expect(items).toHaveLength(1);
      cand = items[0] as CandidateView;
      expect(cand).toMatchObject({
        name: 'Student 0 Rao',
        college: 'EMPA College of Engineering',
        branch: 'CSE',
        gradYear: 2027,
        stage: 'shared',
        hasResume: true,
      });
      expect(Object.keys(cand).sort()).toEqual([
        'branch',
        'college',
        'gradYear',
        'hasResume',
        'name',
        'ref',
        'sharedAt',
        'stage',
      ]);
      const text = JSON.stringify(r.body);
      for (const forbidden of [student().email, '7.75', 'Other Co', 'userId', 'tenantId', 'resumeFileId'])
        expect(text).not.toContain(forbidden);
    });

    it('a five-minute résumé link, checked again per request and audited in the college (N16)', async () => {
      const link = (await as(recruiter).post(`/employer/candidates/${cand.ref}/resume-link`)).body.data as {
        url: string;
      };
      const token = link.url.split('/').pop() as string;
      const pdf = await as(recruiter).get(`/employer/resume/${token}`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      // Another recruiter cannot use the link.
      expect((await as(boss).get(`/employer/resume/${token}`)).status).toBe(404);
      const row = await inT(A, () => AuditModel.findOne({ action: 'network.candidate-resume' }).lean());
      expect(row).toMatchObject({
        targetType: 'network_candidacy',
        targetId: cand.ref,
        meta: { by: String(E._id) },
      });
      const me = (await as(student()).get('/network/me')).body.data as {
        viewedBy: { employer: string; what: string }[];
      };
      expect(me.viewedBy[0]).toMatchObject({ employer: 'Acme Analytics', what: 'resume' });
    });

    it('readiness is computed on read by the college; a shortlist is a proposal', async () => {
      const r = await as(recruiter).get(`/employer/candidates/${cand.ref}/readiness`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(typeof r.body.data.score).toBe('number');
      expect(
        (await as(recruiter).put(`/employer/candidates/${cand.ref}/stage`).send({ stage: 'shortlisted' }))
          .status,
      ).toBe(200);
      expect((await inT(A, () => NetworkCandidacyModel.findOne({ ref: cand.ref }).lean()))?.stage).toBe(
        'shortlisted',
      );
    });

    it('a student who did not share has no readiness or résumé for the employer (N30)', async () => {
      expect((await as(recruiter).get(`/employer/candidates/${'x'.repeat(22)}/readiness`)).status).toBe(404);
    });

    it('withdrawing consent removes the candidate on the next read, and the link stops working (N17)', async () => {
      const link = (await as(recruiter).post(`/employer/candidates/${cand.ref}/resume-link`)).body.data as {
        url: string;
      };
      await as(student())
        .put('/network/consents')
        .send({ purpose: 'employer_visibility', granted: false })
        .expect(200);
      const r = (await as(recruiter).get(`/employer/postings/${p.id}/candidates`)).body.data;
      expect(r.items).toEqual([]);
      expect(r.withdrawn).toBe(1);
      expect((await as(recruiter).get(`/employer/resume/${link.url.split('/').pop()}`)).status).toBe(404);
      expect((await as(recruiter).get(`/employer/candidates/${cand.ref}/readiness`)).status).toBe(404);
    });
  });

  it('hires are billed once per verified offer on the drive (P15)', async () => {
    const o = await inT(A, () => PostingOfferModel.findOne({}).lean());
    await inT(A, () =>
      OfferModel.create({
        userId: students[1]?.id,
        companyKey: 'acme analytics',
        companyName: 'Acme Analytics',
        role: 'Software Engineer',
        type: 'full_time',
        status: 'verified',
        source: 'drive',
        driveId: o?.driveId,
        ctcBand: '5_8',
        ctcLpa: 7,
        offerDate: new Date(),
      }),
    );
    expect((await inT(A, () => services.collegePostings.reconcile())).hires).toBe(1);
    expect((await inT(A, () => services.collegePostings.reconcile())).hires).toBe(0);
    expect(await inT(E, () => BillableEventModel.countDocuments({ kind: 'hire' }))).toBe(1);
    const hire = await inT(E, () => BillableEventModel.findOne({ kind: 'hire' }).lean());
    expect(JSON.stringify(hire)).not.toContain(String(o?.driveId));
    const month = new Date().toISOString().slice(0, 7);
    const rev = await api(ctx, P.host, superAdmin.token).get(`/platform/network/revenue?month=${month}`);
    expect(rev.status).toBe(200);
    expect(rev.body.data.colleges.find((c: { id: string }) => c.id === String(A._id))).toMatchObject({
      postings: 0,
      drives: 1,
      hires: 1,
    });
  });
});

describe('abuse controls (N26 to N28)', () => {
  it('limits pool queries per hour and résumé links per day', async () => {
    await inT(E, () =>
      EmployerUsageModel.updateOne(
        { kind: 'pool', window: new Date().toISOString().slice(0, 13) },
        { $set: { count: EMPLOYER_LIMITS.poolQueriesPerHour, expiresAt: new Date(Date.now() + 864e5) } },
        { upsert: true },
      ),
    );
    expect((await as(recruiter).get('/employer/pool')).status).toBe(429);
  });

  it('at most ten open postings and twenty a month', async () => {
    for (let i = 0; i < EMPLOYER_LIMITS.openPostings - 1; i++) {
      const x = (
        await as(boss)
          .post('/employer/postings')
          .send(posting({ title: `Role ${i}` }))
      ).body.data as PostingView;
      expect(
        (
          await as(boss)
            .post(`/employer/postings/${x.id}/publish`)
            .send({ colleges: [String(C._id)] })
        ).status,
      ).toBe(200);
    }
    const extra = (
      await as(boss)
        .post('/employer/postings')
        .send(posting({ title: 'Eleventh' }))
    ).body.data as PostingView;
    const r = await as(boss)
      .post(`/employer/postings/${extra.id}/publish`)
      .send({ colleges: [String(C._id)] });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/10 postings/);
  });

  it('three reports from different members hide a posting until a moderator decides', async () => {
    const o = await inT(A, () => PostingOfferModel.findOne({ decision: 'approved' }).lean());
    for (const s of students.slice(2, 5))
      expect((await as(s).post(`/network/postings/${String(o?._id)}/report`)).status).toBe(200);
    expect((await inT(A, () => PostingOfferModel.findById(o?._id).lean()))?.hiddenAt).not.toBeNull();
    expect(
      ((await as(tpoA).get('/admin/network')).body.data.postings as CollegePostingView[])[0]?.decision,
    ).toBe('hidden');
    expect(
      (
        await as(tpoA)
          .post(`/admin/network/postings/${String(o?._id)}/moderate`)
          .send({ keep: true })
      ).status,
    ).toBe(200);
  });

  it('a block hides the college at once; three blocks within 90 days suspend the employer', async () => {
    expect(
      (
        await as(tpoA)
          .post('/admin/network/blocks')
          .send({ employerId: String(E._id) })
      ).status,
    ).toBe(200);
    const pool = (await as(recruiter).get('/employer/colleges')).body.data;
    expect(pool.colleges.map((c: { id: string }) => c.id)).not.toContain(String(A._id));
    await as(adminB)
      .post('/admin/network/blocks')
      .send({ employerId: String(E._id) })
      .expect(200);
    await as(adminC)
      .post('/admin/network/blocks')
      .send({ employerId: String(E._id) })
      .expect(200);
    clearTenantCache();
    expect(((await as(boss).get('/employer')).body.data as EmployerView).status).toBe('suspended');
    expect((await as(recruiter).get('/employer/pool')).body.error.code).toBe('NETWORK_NOT_ENABLED');
  });
});
