import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  NETWORK_PATHS,
  type IntrosView,
  type NetworkCard,
  type NetworkSettingsView,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant, withPlatformScope } from '../src/lib/context.js';
import { networkScope } from '../src/lib/network-scope.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { ConsentModel } from '../src/modules/consent/consent.model.js';
import {
  NetworkIntroModel,
  NetworkIntroOutModel,
  NetworkPrefsModel,
  NetworkProfileModel,
} from '../src/modules/network/network.model.js';
import type { NetworkService } from '../src/modules/network/network.service.js';
import type { ProfilesService } from '../src/modules/profiles/profiles.service.js';

/** Prompt 2, G12 (ADR 0014): the network for members and colleges. Claims N4 to N22. */

const ctx = testApp();
const services = ctx.app.locals.services as { network: NetworkService; profiles: ProfilesService };
let A: TestTenant, B: TestTenant, C: TestTenant;
let adminA: TestUser, adminB: TestUser, tpoA: TestUser, facultyA: TestUser;
let student: TestUser, student2: TestUser, minor: TestUser;
let alum: TestUser, alum2: TestUser, alumC: TestUser, quietAlum: TestUser;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const inT = <R>(t: TestTenant, fn: () => Promise<R>) => runInTenant(t._id, fn);

async function profile(u: TestUser, set: Record<string, unknown>) {
  await inT(u.tenant, () => ProfileModel.updateOne({ userId: u.id }, { $set: set }));
}
async function joinNetwork(u: TestUser, settings: Record<string, unknown> = {}) {
  await as(u)
    .put('/network/me')
    .send({
      nameStyle: 'full',
      showCompany: true,
      showCity: true,
      showSkills: true,
      linkedinUrl: null,
      helpWith: ['quick_chat', 'resume_review'],
      acceptingIntros: true,
      introsPerWeek: 2,
      seeking: null,
      ...settings,
    })
    .expect(200);
  const r = await as(u).put('/network/consents').send({ purpose: 'network_discovery', granted: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
const switchOn = (admin: TestUser, extra: Record<string, boolean> = {}) =>
  as(admin)
    .put('/admin/network/switches')
    .send({ alumniDiscovery: true, employerAccess: true, credentials: true, acceptTerms: true, ...extra });
const search = (u: TestUser, qs = '') => as(u).get(`/network/alumni${qs}`);

beforeAll(async () => {
  A = await makeTenant('neta');
  B = await makeTenant('netb');
  C = await makeTenant('netc');
  adminA = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  tpoA = await makeUser(ctx, A, { roles: ['TPO'] });
  facultyA = await makeUser(ctx, A, { roles: ['FACULTY'] });
  student = await makeUser(ctx, A, { roles: ['STUDENT'] });
  student2 = await makeUser(ctx, A, { roles: ['STUDENT'] });
  minor = await makeUser(ctx, A, { roles: ['STUDENT'] });
  alum = await makeUser(ctx, B, { roles: ['ALUMNI'] });
  alum2 = await makeUser(ctx, B, { roles: ['ALUMNI'] });
  quietAlum = await makeUser(ctx, B, { roles: ['ALUMNI'] });
  alumC = await makeUser(ctx, C, { roles: ['ALUMNI'] });
  await profile(student, { name: 'Ravi Teja Konda', branch: 'CSE', gradYear: 2027, skills: ['react'] });
  await profile(student2, { name: 'Sowmya Reddy', branch: 'ECE', gradYear: 2027 });
  await profile(alum, {
    name: 'Kiran Kumar Varma',
    branch: 'CSE',
    gradYear: 2019,
    company: 'Nimbus Labs',
    jobTitle: 'Staff Engineer',
    location: 'Hyderabad, Telangana',
    skills: ['go', 'kubernetes'],
  });
  await profile(alum2, { name: 'Lakshmi Prasanna', company: 'Nimbus Labs', jobTitle: 'Product Manager' });
  await profile(quietAlum, { name: 'Quiet Person', company: 'Nimbus Labs' });
  await profile(alumC, { name: 'Other College Alum', company: 'Nimbus Labs' });
  // A first-year under 18 (B2): adultOn in the future.
  await inT(A, () =>
    UserModel.updateOne({ _id: minor.id }, { $set: { adultOn: new Date(Date.now() + 200 * 864e5) } }),
  );
  await inT(A, () => services.profiles.sync(minor.id));
});

describe('the college’s consent (N4, N5)', () => {
  it('every switch is off for a new college, and members cannot join while it is off', async () => {
    const v = (await as(student).get('/network/me')).body.data as NetworkSettingsView;
    expect(v.college).toEqual({ alumniDiscovery: false, employerAccess: false, credentials: false });
    await joinNetwork(student);
    expect((await search(student)).body.error.code).toBe('NETWORK_NOT_ENABLED');
    expect(await inT(A, () => NetworkProfileModel.countDocuments({}))).toBe(0);
  });

  it('only an admin with TOTP switches it on, accepting the terms; it is audited with the version', async () => {
    expect(
      (await as(tpoA).put('/admin/network/switches').send({ alumniDiscovery: true, acceptTerms: true }))
        .status,
    ).toBe(403);
    expect((await as(adminA).put('/admin/network/switches').send({ alumniDiscovery: true })).status).toBe(
      400,
    );
    expect((await switchOn(adminA)).status).toBe(200);
    const row = await inT(A, () => AuditModel.findOne({ action: 'network.switched' }).lean());
    expect(row?.meta).toMatchObject({ alumniDiscovery: true, termsVersion: 1 });
    expect((await switchOn(adminB)).status).toBe(200);
  });
});

describe('the member’s consent (N6 to N8)', () => {
  it('opt-in only: nothing at sign-up, and one purpose does not grant the other', async () => {
    const before = await inT(B, () =>
      ConsentModel.countDocuments({ userId: alum.id, purpose: 'network_discovery' }),
    );
    expect(before).toBe(0);
    await joinNetwork(alum, { linkedinUrl: 'https://www.linkedin.com/in/kiran-varma' });
    const v = (await as(alum).get('/network/me')).body.data as NetworkSettingsView;
    expect(v.consents).toEqual({ network_discovery: true, employer_visibility: false });
    expect(v.visible).toEqual({ discovery: true, employers: false });
  });

  it('is never for minors, and staff are not projected', async () => {
    const r = await as(minor).put('/network/consents').send({ purpose: 'network_discovery', granted: true });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_FOR_MINORS');
    expect((await as(facultyA).get('/network/me')).status).toBe(403);
  });
});

describe('the projection (N9)', () => {
  it('holds exactly the opt-in fields: no contact, age, marks, readiness, offers or CTC', () => {
    const fields = [
      ...new Set(Object.keys(NetworkProfileModel.schema.paths).map((p) => p.split('.')[0] ?? '')),
    ].filter((p) => !p.startsWith('_'));
    expect(fields.sort()).toEqual(
      [
        'acceptingIntros',
        'branch',
        'company',
        'companyKey',
        'consentVersions',
        'createdAt',
        'discoverable',
        'employerVisible',
        'gradYear',
        'helpWith',
        'introsPerWeek',
        'kind',
        'linkedinUrl',
        'name',
        'ref',
        'refreshedAt',
        'roleTitle',
        'seeking',
        'skills',
        'tenantId',
        'updatedAt',
        'userId',
        'city',
      ].sort(),
    );
  });
});

describe('cross-college discovery (P1, P2; N14, N15, N20)', () => {
  let card: NetworkCard;
  beforeAll(async () => {
    await joinNetwork(alum2, { nameStyle: 'first' });
    await joinNetwork(quietAlum, { nameStyle: 'first', acceptingIntros: false });
    await joinNetwork(student2);
  });

  it('finds alumni of other opted-in colleges only, with the public fields only', async () => {
    const r = await search(student, '?company=Nimbus%20Labs');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const items = r.body.data.items as NetworkCard[];
    expect(items.map((i) => i.name).sort()).toEqual(['Kiran Kumar Varma', 'Lakshmi P.', 'Quiet P.'].sort());
    card = items.find((i) => i.name === 'Kiran Kumar Varma') as NetworkCard;
    expect(card).toMatchObject({
      company: 'Nimbus Labs',
      roleTitle: 'Staff Engineer',
      city: 'Hyderabad',
      college: { name: 'NETB College of Engineering' },
    });
    const allowed = [
      'ref',
      'name',
      'college',
      'branch',
      'gradYear',
      'company',
      'roleTitle',
      'city',
      'skills',
      'helpWith',
      'linkedinUrl',
    ];
    for (const i of items) expect(Object.keys(i).every((k) => allowed.includes(k))).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/userId|tenantId|@|"_id"/);
    // College C never opted in: its alumnus is not there.
    expect(items.some((i) => i.name.startsWith('Other'))).toBe(false);
  });

  it('opens one card, and the same ref is a 404 from a college that is not in the network', async () => {
    expect((await as(student).get(`/network/alumni/${card.ref}`)).body.data.name).toBe('Kiran Kumar Varma');
    const outsider = await makeUser(ctx, C, { roles: ['STUDENT'] });
    expect((await as(outsider).get(`/network/alumni/${card.ref}`)).body.error.code).toBe(
      'NETWORK_NOT_ENABLED',
    );
  });

  it('writes an audit row on both sides, never naming members to the other college', async () => {
    const mine = await inT(A, () => AuditModel.find({ action: 'network.alumni-search' }).lean());
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]?.actorId && String(mine[0].actorId)).toBe(student.id);
    const theirs = await inT(B, () => AuditModel.find({ action: 'network.alumni-search' }).lean());
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs[0]?.actorId).toBeNull();
    expect(theirs[0]?.meta).toMatchObject({ by: String(A._id), byKind: 'college' });
    expect(JSON.stringify(theirs)).not.toContain(student.id);
  });

  it('needs both colleges and the member opted in (N20)', async () => {
    const lurker = await makeUser(ctx, A, { roles: ['STUDENT'] });
    expect((await search(lurker)).body.error.code).toBe('NETWORK_NOT_ENABLED');
    // A college that switches off disappears on the next request, without a reconcile (N5).
    await as(adminB).put('/admin/network/switches').send({ alumniDiscovery: false }).expect(200);
    expect((await search(student, '?company=Nimbus%20Labs')).body.data.items).toEqual([]);
    expect((await switchOn(adminB)).status).toBe(200);
    expect((await search(student, '?company=Nimbus%20Labs')).body.data.items.length).toBe(3);
  });
});

describe('intros (P3 to P6; N21, N22)', () => {
  let kiran: NetworkCard, lakshmi: NetworkCard, quiet: NetworkCard;
  beforeAll(async () => {
    const items = (await search(student, '?company=Nimbus%20Labs')).body.data.items as NetworkCard[];
    kiran = items.find((i) => i.name.startsWith('Kiran')) as NetworkCard;
    lakshmi = items.find((i) => i.name.startsWith('Lakshmi')) as NetworkCard;
    quiet = items.find((i) => i.name.startsWith('Quiet')) as NetworkCard;
  });

  it('an intro reaches the alumnus in their own college; the note never travels in the notification', async () => {
    const r = await as(student).post('/network/intros').send({
      ref: kiran.ref,
      helpWith: 'resume_review',
      goal: 'resume_feedback',
      note: 'Could you look at my résumé?',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const received = (await as(alum).get('/network/intros')).body.data as IntrosView;
    expect(received.received[0]).toMatchObject({
      from: { name: 'Ravi Teja Konda', college: 'NETA College of Engineering' },
      note: 'Could you look at my résumé?',
    });
    const n = (await as(alum).get('/notifications')).body.data;
    expect(JSON.stringify(n)).not.toContain('look at my résumé');
  });

  it('follows the mentorship rules: one pending per pair, types the alumnus helps with, and accepting', async () => {
    const again = await as(student)
      .post('/network/intros')
      .send({ ref: kiran.ref, helpWith: 'quick_chat', goal: 'career_advice' });
    expect(again.status).toBe(409);
    const wrongType = await as(student)
      .post('/network/intros')
      .send({ ref: lakshmi.ref, helpWith: 'mock_interview', goal: 'career_advice' });
    expect(wrongType.status).toBe(409);
    const closed = await as(student)
      .post('/network/intros')
      .send({ ref: quiet.ref, helpWith: 'quick_chat', goal: 'career_advice' });
    expect(closed.status).toBe(409);
  });

  it('accepting shares only the chosen contact with that one student (encrypted at rest)', async () => {
    const id = ((await as(alum).get('/network/intros')).body.data as IntrosView).received[0]?.id as string;
    const r = await as(alum)
      .post(`/network/intros/${id}/accept`)
      .send({ share: ['linkedin', 'email'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sent = ((await as(student).get('/network/intros')).body.data as IntrosView).sent[0];
    expect(sent?.status).toBe('accepted');
    expect(sent?.shared).toEqual({ linkedin: 'https://www.linkedin.com/in/kiran-varma', email: alum.email });
    const raw = await inT(A, () => NetworkIntroOutModel.findById(id).lean());
    expect(raw?.sharedContactEnc).toMatch(/^v2\./);
    expect(JSON.stringify(raw)).not.toContain(alum.email);
  });

  it('caps a student at three a week (N21)', async () => {
    const third = await makeUser(ctx, B, { roles: ['ALUMNI'] });
    const fourth = await makeUser(ctx, B, { roles: ['ALUMNI'] });
    await profile(third, { name: 'Third Alum', company: 'Nimbus Labs' });
    await profile(fourth, { name: 'Fourth Alum', company: 'Nimbus Labs' });
    await joinNetwork(third);
    await joinNetwork(fourth);
    const items = (await search(student, '?q=Alum')).body.data.items as NetworkCard[];
    const t3 = items.find((i) => i.name.startsWith('Third')) as NetworkCard;
    const t4 = items.find((i) => i.name.startsWith('Fourth')) as NetworkCard;
    expect(
      (
        await as(student)
          .post('/network/intros')
          .send({ ref: lakshmi.ref, helpWith: 'quick_chat', goal: 'career_advice' })
      ).status,
    ).toBe(201);
    expect(
      (
        await as(student)
          .post('/network/intros')
          .send({ ref: t3.ref, helpWith: 'quick_chat', goal: 'career_advice' })
      ).status,
    ).toBe(201);
    const capped = await as(student)
      .post('/network/intros')
      .send({ ref: t4.ref, helpWith: 'quick_chat', goal: 'career_advice' });
    expect(capped.status).toBe(409);
    expect(capped.body.error.message).toMatch(/3 intros a week/);
  });

  it('a decline blocks the pair for 30 days; an alumnus’s own weekly cap holds', async () => {
    const list = ((await as(alum2).get('/network/intros')).body.data as IntrosView).received;
    const id = list[0]?.id as string;
    expect((await as(alum2).post(`/network/intros/${id}/decline`).send({ reason: 'busy' })).status).toBe(200);
    // Lakshmi takes 2 a week by default: a second student fills it, a third is refused.
    const s3 = await makeUser(ctx, A, { roles: ['STUDENT'] });
    const s4 = await makeUser(ctx, A, { roles: ['STUDENT'] });
    await joinNetwork(s3);
    await joinNetwork(s4);
    expect(
      (
        await as(s3)
          .post('/network/intros')
          .send({ ref: lakshmi.ref, helpWith: 'quick_chat', goal: 'career_advice' })
      ).status,
    ).toBe(201);
    const full = await as(s4)
      .post('/network/intros')
      .send({ ref: lakshmi.ref, helpWith: 'quick_chat', goal: 'career_advice' });
    expect(full.status).toBe(409);
    await inT(A, () => NetworkIntroOutModel.deleteMany({ userId: student.id, status: 'pending' }));
    await inT(A, () =>
      NetworkIntroOutModel.updateMany(
        { userId: student.id },
        { $set: { createdAt: new Date(Date.now() - 8 * 864e5) } },
        { timestamps: false },
      ),
    );
    const declined = await as(student)
      .post('/network/intros')
      .send({ ref: lakshmi.ref, helpWith: 'quick_chat', goal: 'career_advice' });
    expect(declined.status).toBe(409);
    expect(declined.body.error.message).toMatch(/30 days/);
  });

  it('two reports from different alumni pause the sender until the college reviews it (N22)', async () => {
    const sender = await makeUser(ctx, A, { roles: ['STUDENT'] });
    await joinNetwork(sender);
    for (const target of [kiran, quiet]) {
      if (target === quiet)
        await as(quietAlum)
          .put('/network/me')
          .send({
            nameStyle: 'first',
            showCompany: true,
            showCity: false,
            showSkills: true,
            linkedinUrl: null,
            helpWith: ['quick_chat'],
            acceptingIntros: true,
            introsPerWeek: 5,
            seeking: null,
          });
      const r = await as(sender)
        .post('/network/intros')
        .send({ ref: target.ref, helpWith: 'quick_chat', goal: 'career_advice' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    for (const who of [alum, quietAlum]) {
      const intro = ((await as(who).get('/network/intros')).body.data as IntrosView).received.find(
        (i) => i.status === 'pending',
      );
      expect((await as(who).post(`/network/intros/${intro?.id}/report`)).status).toBe(200);
    }
    expect((await as(sender).get('/network/me')).body.data.paused).toBe(true);
    expect((await search(sender)).body.error.code).toBe('NETWORK_NOT_ENABLED');
    const reported = await inT(A, () => AuditModel.findOne({ action: 'network.intro-report' }).lean());
    expect(reported?.meta).toMatchObject({ by: String(B._id) });
    const admin = (await as(tpoA).get('/admin/network')).body.data as { paused: { userId: string }[] };
    expect(admin.paused.map((p) => p.userId)).toContain(sender.id);
    expect((await as(tpoA).post(`/admin/network/paused/${sender.id}/resume`)).status).toBe(200);
    expect((await search(sender)).status).toBe(200);
  });
});

describe('the closed list of paths (N11 to N13)', () => {
  it('refuses any model outside the path’s list, and joins', async () => {
    await expect(
      networkScope(
        'network:alumni-search',
        { tenantId: String(A._id), kind: 'job', userId: null },
        () => UserModel.find({}).lean(),
        () => [],
      ),
    ).rejects.toThrow(/not allowed in network:alumni-search/);
    await expect(
      networkScope(
        'network:alumni-search',
        { tenantId: String(A._id), kind: 'job', userId: null },
        () => ProfileModel.find({}).lean(),
        () => [],
      ),
    ).rejects.toThrow(/not allowed/);
    await expect(
      networkScope(
        'network:alumni-search',
        { tenantId: String(A._id), kind: 'job', userId: null },
        () =>
          NetworkProfileModel.aggregate([
            { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' } },
          ]),
        () => [],
      ),
    ).rejects.toThrow(/Cross-collection/);
    await expect(
      networkScope(
        'network:made-up' as never,
        { tenantId: String(A._id), kind: 'job', userId: null },
        async () => 1,
        () => [],
      ),
    ).rejects.toThrow(/Unknown network path/);
    // Ordinary platform scopes are unchanged.
    expect(await withPlatformScope('test:plain', () => UserModel.countDocuments({}))).toBeGreaterThan(0);
  });

  it('every call site uses a listed reason, and every listed reason is used', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '../src'));
    const used = new Set<string>();
    for (const f of files) {
      if (f.endsWith('network-scope.ts')) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(/network(?:Scope|InTenant)\(\s*'(network:[a-z-]+)'/g))
        used.add(m[1] ?? '');
      for (const m of readFileSync(f, 'utf8').matchAll(/withPlatformScope\(\s*'(network:[a-z-]+)'/g))
        throw new Error(`${f} opens ${m[1]} without networkScope`);
    }
    expect([...used].sort()).toEqual([...NETWORK_PATHS].sort());
  });
});

describe('revocation (N17 to N19)', () => {
  it('withdrawing consent removes the member from every other college’s next read', async () => {
    const r1 = (await search(student, '?q=Kiran')).body.data.items as NetworkCard[];
    expect(r1).toHaveLength(1);
    await as(alum)
      .put('/network/consents')
      .send({ purpose: 'network_discovery', granted: false })
      .expect(200);
    expect((await search(student, '?q=Kiran')).body.data.items).toEqual([]);
    expect(await inT(B, () => NetworkProfileModel.countDocuments({ userId: alum.id }))).toBe(0);
    // Granting again makes a new ref: the old card does not come back.
    await as(alum).put('/network/consents').send({ purpose: 'network_discovery', granted: true }).expect(200);
    const back = (await search(student, '?q=Kiran')).body.data.items as NetworkCard[];
    expect(back[0]?.ref).not.toBe(r1[0]?.ref);
    expect((await as(student).get(`/network/alumni/${r1[0]?.ref}`)).status).toBe(404);
  });

  it('a suspension or a corrected birth month is reflected in the same call (ProfilesService.sync)', async () => {
    await inT(B, () => UserModel.updateOne({ _id: alum2.id }, { $set: { status: 'suspended' } }));
    await inT(B, () => services.profiles.sync(alum2.id));
    expect(await inT(B, () => NetworkProfileModel.countDocuments({ userId: alum2.id }))).toBe(0);
    await inT(B, () => UserModel.updateOne({ _id: alum2.id }, { $set: { status: 'active' } }));
    await inT(B, () => services.profiles.sync(alum2.id));
    expect(await inT(B, () => NetworkProfileModel.countDocuments({ userId: alum2.id }))).toBe(1);
  });

  it('within one reconcile cycle, whatever changed the sources behind the service’s back', async () => {
    expect(await inT(B, () => NetworkProfileModel.countDocuments({ userId: quietAlum.id }))).toBe(1);
    // A withdrawal written straight to the log (an import, a manual fix, a bug), and a field un-ticked.
    await inT(B, () =>
      ConsentModel.create({
        userId: quietAlum.id,
        purpose: 'network_discovery',
        version: 1,
        noticeVersion: 'x',
        granted: false,
        source: 'settings',
      }),
    );
    await inT(B, () => NetworkPrefsModel.updateOne({ userId: alum.id }, { $set: { showCompany: false } }));
    // A member who is now under 18.
    await inT(B, () =>
      UserModel.updateOne({ _id: alum2.id }, { $set: { adultOn: new Date(Date.now() + 864e5) } }),
    );
    await inT(B, () =>
      ProfileModel.updateOne({ userId: alum2.id }, { $set: { minorUntil: new Date(Date.now() + 864e5) } }),
    );
    expect((await search(student, '?q=Quiet')).body.data.items).toHaveLength(1);
    const r = await inT(B, () => services.network.reconcile());
    expect(r.deleted).toBeGreaterThanOrEqual(2);
    expect((await search(student, '?q=Quiet')).body.data.items).toEqual([]);
    expect((await search(student, '?q=Lakshmi')).body.data.items).toEqual([]);
    expect(((await search(student, '?q=Kiran')).body.data.items as NetworkCard[])[0]?.company).toBeNull();
  });

  it('a college that switches off is not searchable at once, and its projections go at the next cycle', async () => {
    await as(adminB)
      .put('/admin/network/switches')
      .send({ alumniDiscovery: false, employerAccess: false })
      .expect(200);
    expect((await search(student, '?q=Kiran')).body.data.items).toEqual([]);
    await inT(B, () => services.network.reconcile());
    expect(await inT(B, () => NetworkProfileModel.countDocuments({}))).toBe(0);
    // Nothing the members chose was deleted.
    expect(await inT(B, () => NetworkPrefsModel.countDocuments({ userId: alum.id }))).toBe(1);
    await switchOn(adminB).expect(200);
    await inT(B, () => services.network.reconcile());
    expect(await inT(B, () => NetworkProfileModel.countDocuments({ userId: alum.id }))).toBe(1);
  });

  it('pending intros expire after seven days on both sides', async () => {
    // The intro another student sent Lakshmi (its sender's copy is still there).
    const pending = await inT(B, () =>
      NetworkIntroModel.findOne({ status: 'pending', toUserId: alum2.id }).lean(),
    );
    expect(pending).not.toBeNull();
    await inT(B, () =>
      NetworkIntroModel.updateOne(
        { _id: pending?._id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      ),
    );
    await inT(B, () => services.network.reconcile());
    expect((await inT(B, () => NetworkIntroModel.findById(pending?._id).lean()))?.status).toBe('expired');
    expect((await inT(A, () => NetworkIntroOutModel.findById(pending?._id).lean()))?.status).toBe('expired');
  });
});

describe('Admin › Network', () => {
  it('shows the switches, suppressed member counts and who looked (from the audit log)', async () => {
    const v = (await as(adminB).get('/admin/network')).body.data;
    expect(v.switches.alumniDiscovery).toBe(true);
    expect(v.members.discoverable).toBe('<5');
    expect(
      v.activity.find((a: { reason: string }) => a.reason === 'network.alumni-search')?.count,
    ).toBeGreaterThan(0);
    expect((await as(student).get('/admin/network')).status).toBe(403);
  });
});

describe('privacy', () => {
  it('exports the member’s choices, projection, intros and consents; erasure leaves "Former member"', async () => {
    const out = await inT(A, () => services.network.exportFor(student.id));
    expect(out.prefs).not.toBeNull();
    expect(out.introsSent.length).toBeGreaterThan(0);
    expect(out.consents.length).toBeGreaterThan(0);
    const sentIds = out.introsSent.map((s) => String((s as { _id: unknown })._id));
    await inT(A, () => services.network.eraseFor(student.id));
    expect(await inT(A, () => NetworkProfileModel.countDocuments({ userId: student.id }))).toBe(0);
    expect(await inT(A, () => NetworkIntroOutModel.countDocuments({ userId: student.id }))).toBe(0);
    const theirs = await inT(B, () => NetworkIntroModel.find({ _id: { $in: sentIds } }).lean());
    expect(theirs.length).toBeGreaterThan(0);
    for (const t of theirs) expect(t).toMatchObject({ fromName: 'Former member', note: '' });
    // Consent records stay (the log is kept on erasure).
    expect(
      await inT(A, () => ConsentModel.countDocuments({ userId: student.id, purpose: 'network_discovery' })),
    ).toBeGreaterThan(0);
  });
});
