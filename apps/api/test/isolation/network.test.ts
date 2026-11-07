/**
 * MANDATORY tenant-isolation suite for the network (prompt 2, G12, ADR 0014). Blocks CI.
 * Only the named network paths cross a college; every other path refuses another tenant, and an
 * employer's tenant is as closed to colleges (and to other employers) as a college is.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { gstinCheckDigit } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import { TenantModel } from '../../src/modules/tenants/tenant.model.js';
import {
  NetworkCandidacyModel,
  NetworkIntroModel,
  NetworkIntroOutModel,
  NetworkPrefsModel,
  NetworkProfileModel,
} from '../../src/modules/network/network.model.js';
import {
  BillableEventModel,
  PostingModel,
  PostingOfferModel,
} from '../../src/modules/employers/employer.model.js';
import { CredentialModel, IssuerKeyModel } from '../../src/modules/credentials/credential.model.js';

const ctx = testApp();
const registry = () =>
  ctx.app.locals.registry as {
    spec: { method: string; path: string; scope?: string; access: { kind: string } };
  }[];
let A: TestTenant, B: TestTenant, E1: TestTenant, E2: TestTenant;
let adminA: TestUser, adminB: TestUser, studentB: TestUser, rec1: TestUser, rec2: TestUser;
const fake = '0123456789abcdef01234567';
const call = (u: TestUser, host: string, method: string, path: string) =>
  (
    api(ctx, host, u.token) as unknown as Record<
      string,
      (p: string) => {
        send: (b: unknown) => Promise<{ status: number; body: { error?: { code?: string } } }>;
      }
    >
  )[method]!(path.replace(/:[A-Za-z]+/g, fake)).send({});

async function employer(slug: string): Promise<TestTenant> {
  const body = '36AABCA1234B1Z';
  const t = await TenantModel.create({
    slug,
    kind: 'employer',
    branding: {
      displayName: slug,
      shortName: slug,
      primary: '#000000',
      secondary: '#111111',
      accent: '#222222',
      monogram: 'E',
    },
    employer: {
      legalName: slug,
      domain: `${slug}.example`,
      gstin: body + gstinCheckDigit(body),
      status: 'approved',
      dnsToken: 'x',
      domainVerifiedAt: new Date(),
    },
  });
  return { _id: t._id, slug, host: `${slug}.localhost` };
}

beforeAll(async () => {
  A = await makeTenant('isonet-a');
  B = await makeTenant('isonet-b');
  E1 = await employer('emp-isoone');
  E2 = await employer('emp-isotwo');
  adminA = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  studentB = await makeUser(ctx, B, { roles: ['STUDENT'] });
  rec1 = await makeUser(ctx, E1, { roles: ['EMPLOYER_ADMIN'], mfa: true });
  rec2 = await makeUser(ctx, E2, { roles: ['EMPLOYER_ADMIN'], mfa: true });
  // One record of every network collection in A and E1.
  const uid = new Types.ObjectId();
  await runInTenant(A._id, async () => {
    await NetworkPrefsModel.create({ userId: uid });
    await NetworkProfileModel.create({
      ref: 'r'.repeat(22),
      userId: uid,
      kind: 'alumni',
      name: 'A Person',
      discoverable: true,
      employerVisible: true,
      refreshedAt: new Date(),
    });
    await NetworkCandidacyModel.create({
      ref: 'c'.repeat(22),
      userId: uid,
      driveId: uid,
      employerTenantId: E1._id,
      postingRef: 'p'.repeat(22),
      name: 'A Person',
      stage: 'shared',
      sharedAt: new Date(),
    });
    await NetworkIntroModel.create({
      toUserId: uid,
      fromTenantId: B._id,
      fromRef: 'f'.repeat(22),
      fromName: 'X',
      helpWith: 'quick_chat',
      goal: 'career_advice',
      status: 'pending',
      expiresAt: new Date(),
    });
    await NetworkIntroOutModel.create({
      userId: uid,
      toTenantId: B._id,
      toRef: 't'.repeat(22),
      toName: 'Y',
      helpWith: 'quick_chat',
      goal: 'career_advice',
      status: 'pending',
      expiresAt: new Date(),
    });
    await PostingOfferModel.create({
      employerTenantId: E1._id,
      employerName: 'E1',
      postingRef: 'p'.repeat(22),
      title: 'T',
      role: 'R',
      type: 'full_time',
      location: 'L',
      description: 'D'.repeat(30),
      closesAt: new Date(),
      offeredAt: new Date(),
    });
    await CredentialModel.create({
      publicId: 'k'.repeat(22),
      userId: uid,
      type: 'PlacementOfferCredential',
      kid: 'kid',
      statusIndex: 7,
      issuedAt: new Date(),
    });
    await IssuerKeyModel.create({ kid: 'kid', publicJwk: {}, privateKeyEnc: 'x', status: 'active' });
  });
  await runInTenant(E1._id, async () => {
    await PostingModel.create({
      ref: 'p'.repeat(22),
      title: 'T',
      role: 'R',
      type: 'full_time',
      location: 'L',
      description: 'D'.repeat(30),
      closesAt: new Date(),
      createdBy: uid,
    });
    await BillableEventModel.create({
      kind: 'posting',
      key: 'posting:x',
      postingRef: 'p'.repeat(22),
      amount: 0,
      revenueShareBps: 0,
      at: new Date(),
    });
  });
});

describe('tokens across kinds', () => {
  it('an employer token is refused on every college route of a college host (TENANT_MISMATCH or 404)', async () => {
    const bad: string[] = [];
    for (const { spec } of registry()) {
      if (spec.access.kind === 'public' || spec.path.startsWith('/:slug')) continue;
      if ((spec.scope ?? 'college') === 'platform') continue;
      const r = await call(rec1, A.host, spec.method, spec.path);
      // A switched-off feature answers before authentication (FEATURE_DISABLED): nothing is read.
      if (r.body.error?.code === 'FEATURE_DISABLED') continue;
      if (r.status !== 401 && r.status !== 404) bad.push(`${spec.method} ${spec.path} → ${r.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('a college token is refused on an employer host, and one employer’s token on another’s', async () => {
    const bad: string[] = [];
    for (const { spec } of registry().filter((r) => r.spec.scope === 'employer')) {
      for (const [u, host] of [
        [adminA, E1.host],
        [rec2, E1.host],
      ] as const) {
        const r = await call(u, host, spec.method, spec.path);
        if (r.status !== 401 && r.status !== 404) bad.push(`${spec.method} ${spec.path} → ${r.status}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('a member of B is refused on every network and credential route of A', async () => {
    const bad: string[] = [];
    for (const { spec } of registry().filter((r) =>
      /^\/(network|admin\/network|credentials|admin\/credentials)/.test(r.spec.path),
    )) {
      const r = await call(studentB, A.host, spec.method, spec.path);
      if (r.status !== 401) bad.push(`${spec.method} ${spec.path} → ${r.status}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('the network collections are tenant-owned outside the named paths', () => {
  const models = [
    NetworkPrefsModel,
    NetworkProfileModel,
    NetworkCandidacyModel,
    NetworkIntroModel,
    NetworkIntroOutModel,
    PostingOfferModel,
    CredentialModel,
    IssuerKeyModel,
  ] as const;

  it('B reads, counts, updates and deletes nothing of A (read, search, update, delete)', async () => {
    await runInTenant(B._id, async () => {
      for (const m of models) {
        const model = m as unknown as typeof NetworkPrefsModel;
        expect(await model.find({}).lean(), model.modelName).toEqual([]);
        expect(await model.countDocuments({}), model.modelName).toBe(0);
        expect(
          (await model.updateMany({}, { $set: { updatedAt: new Date() } })).matchedCount,
          model.modelName,
        ).toBe(0);
        expect((await model.deleteMany({})).deletedCount, model.modelName).toBe(0);
      }
    });
    await runInTenant(A._id, async () => {
      for (const m of models)
        expect(await (m as unknown as typeof NetworkPrefsModel).countDocuments({})).toBe(1);
    });
  });

  it('an employer reads nothing of another employer, and a college nothing of an employer', async () => {
    for (const t of [E2._id, A._id])
      await runInTenant(t, async () => {
        expect(await PostingModel.countDocuments({})).toBe(0);
        expect(await BillableEventModel.countDocuments({})).toBe(0);
      });
    expect((await api(ctx, E2.host, rec2.token).get('/employer/postings')).body.data).toEqual([]);
  });

  it('another college’s admin cannot decide, block through, resume or revoke in A', async () => {
    const offer = await runInTenant(A._id, () => PostingOfferModel.findOne({}).lean());
    const at = new Date(Date.now() + 864e5).toISOString();
    await api(ctx, B.host, adminB.token)
      .put('/admin/network/switches')
      .send({ employerAccess: true, credentials: true, acceptTerms: true })
      .expect(200);
    expect(
      (
        await api(ctx, B.host, adminB.token)
          .post(`/admin/network/postings/${String(offer?._id)}/decision`)
          .send({ decision: 'approved', registrationCloseAt: at, driveDate: at })
      ).status,
    ).toBe(404);
    expect(
      (await api(ctx, B.host, adminB.token).post(`/admin/credentials/${'k'.repeat(22)}/revoke`)).status,
    ).toBe(404);
    expect(
      (await api(ctx, B.host, adminB.token).post('/admin/credentials/keys/kidkidkid/compromised')).status,
    ).toBe(404);
    expect((await runInTenant(A._id, () => PostingOfferModel.findById(offer?._id).lean()))?.decision).toBe(
      'pending',
    );
  });
});
