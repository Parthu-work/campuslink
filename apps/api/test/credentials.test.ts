import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { compactVerify, importJWK, type JWK } from 'jose';
import type { CredentialView, MyCredentialsView } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { OfferModel } from '../src/modules/placements/placements.model.js';
import { CredentialModel, IssuerKeyModel } from '../src/modules/credentials/credential.model.js';
import { CredentialsService } from '../src/modules/credentials/credentials.service.js';
import { ENCRYPTED_COLLECTIONS } from '../src/scripts/field-rotation.js';
import type { ProfilesService } from '../src/modules/profiles/profiles.service.js';

/** Prompt 2, G12 (ADR 0014 §12): verified credentials. N32 to N35. */

const ctx = testApp();
const services = ctx.app.locals.services as { credentials: CredentialsService; profiles: ProfilesService };
let T: TestTenant, U: TestTenant;
let admin: TestUser, member: TestUser, minor: TestUser, otherAdmin: TestUser;
let offerId = '';
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);
/** The public routes live on the root host, outside the API prefix. */
const root = (path: string, host = 'localhost') => request(ctx.app).get(path).set('Host', host);
const dec = new TextDecoder();

beforeAll(async () => {
  T = await makeTenant('credt');
  U = await makeTenant('credu');
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  otherAdmin = await makeUser(ctx, U, { roles: ['COLLEGE_ADMIN'], mfa: true });
  member = await makeUser(ctx, T, { roles: ['STUDENT'], email: 'meena@credt.example' });
  minor = await makeUser(ctx, T, { roles: ['STUDENT'] });
  await inT(() =>
    ProfileModel.updateOne({ userId: member.id }, { $set: { name: 'Meena Kumari Das', gradYear: 2026 } }),
  );
  const o = await inT(() =>
    OfferModel.create({
      userId: member.id,
      companyKey: 'zephyr',
      companyName: 'Zephyr Systems',
      role: 'Data Analyst',
      type: 'full_time',
      status: 'verified',
      source: 'drive',
      gradYear: 2026,
      ctcBand: '8_12',
      ctcLpa: 9.4,
      offerDate: new Date(),
    }),
  );
  offerId = String(o._id);
  await inT(() =>
    UserModel.updateOne({ _id: minor.id }, { $set: { adultOn: new Date(Date.now() + 100 * 864e5) } }),
  );
  await inT(() => services.profiles.sync(minor.id));
});

describe('issuing (N32)', () => {
  it('is off until the college turns credentials on', async () => {
    const v = (await as(member).get('/credentials')).body.data as MyCredentialsView;
    expect(v.enabled).toBe(false);
    const r = await as(member)
      .post('/credentials')
      .send({ type: 'PlacementOfferCredential', sourceId: offerId, nameStyle: 'full' });
    expect(r.body.error.code).toBe('NETWORK_NOT_ENABLED');
    await as(admin).put('/admin/network/switches').send({ credentials: true, acceptTerms: true }).expect(200);
  });

  it('only from a verified record the member holds, never for a minor', async () => {
    const v = (await as(member).get('/credentials')).body.data as MyCredentialsView;
    expect(v.sources.find((s) => s.type === 'PlacementOfferCredential')).toMatchObject({
      sourceId: offerId,
      label: 'Zephyr Systems · Data Analyst',
      issued: false,
    });
    expect(
      (
        await as(member)
          .post('/credentials')
          .send({ type: 'PlacementOfferCredential', sourceId: '0123456789abcdef01234567', nameStyle: 'full' })
      ).status,
    ).toBe(400);
    const m = await as(minor)
      .post('/credentials')
      .send({ type: 'PlacementOfferCredential', sourceId: offerId, nameStyle: 'full' });
    expect(m.body.error.code).toBe('NOT_FOR_MINORS');
  });
});

describe('the signed credential and its public page (N33 to N35)', () => {
  let cred: CredentialView;

  it('is a W3C VC 2.0 as vc+jwt, signed with the college’s Ed25519 key from did.json', async () => {
    const r = await as(member)
      .post('/credentials')
      .send({ type: 'PlacementOfferCredential', sourceId: offerId, nameStyle: 'full' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    cred = r.body.data as CredentialView;
    expect(cred.url).toBe(`http://localhost:5173/credt/verify/${cred.id}`);
    expect(
      (
        await as(member)
          .post('/credentials')
          .send({ type: 'PlacementOfferCredential', sourceId: offerId, nameStyle: 'full' })
      ).status,
    ).toBe(409);

    const jwt = (await root(`/credt/verify/${cred.id}.jwt`)).text;
    const did = (await root('/credt/did.json')).body as {
      id: string;
      verificationMethod: { id: string; publicKeyJwk: JWK }[];
    };
    expect(did.id).toBe('did:web:localhost%3A5173:credt');
    const header = JSON.parse(Buffer.from(jwt.split('.')[0] ?? '', 'base64url').toString()) as {
      alg: string;
      typ: string;
      kid: string;
    };
    expect(header).toMatchObject({ alg: 'EdDSA', typ: 'vc+jwt' });
    const method = did.verificationMethod.find((m) => m.id === header.kid);
    expect(method).toBeDefined();
    const { payload } = await compactVerify(jwt, await importJWK(method?.publicKeyJwk as JWK, 'EdDSA'));
    const vc = JSON.parse(dec.decode(payload)) as Record<string, unknown> & {
      credentialSubject: Record<string, unknown>;
    };
    expect(vc['@context']).toEqual(['https://www.w3.org/ns/credentials/v2']);
    expect(vc.type).toEqual(['VerifiableCredential', 'PlacementOfferCredential']);
    expect(vc.credentialSubject).toEqual({
      type: 'PlacementOfferCredential',
      name: 'Meena Kumari Das',
      company: 'Zephyr Systems',
      role: 'Data Analyst',
      batch: 2026,
    });
    // Never the CTC, contact details or a student identifier. The CTC as a figure on its own: a
    // time such as 39.412Z must not count.
    expect(JSON.stringify(vc)).not.toMatch(/(?<![\d.])9\.4(?![\d])|8_12|meena@|userId/);
    // A tampered credential fails.
    const [h, p, s] = jwt.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...vc, credentialSubject: { ...vc.credentialSubject, company: 'Big Co' } })).toString('base64url')}.${s}`;
    expect(p).toBeTruthy();
    await expect(
      compactVerify(forged, await importJWK(method?.publicKeyJwk as JWK, 'EdDSA')),
    ).rejects.toThrow();
  });

  it('the verify page shows the claims and the status, and nothing else (N35)', async () => {
    const page = await root(`/credt/verify/${cred.id}`);
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['x-robots-tag']).toBe('noindex');
    expect(page.text).toContain('Valid: signed by the college');
    expect(page.text).toContain('Zephyr Systems');
    expect(page.text).toContain('Meena Kumari Das');
    expect(page.text).not.toMatch(/(?<![\d.])9\.4(?![\d])|meena@|8_12/);
    // The same page on the college's own host; another college's host or slug is a 404.
    expect((await root(`/credt/verify/${cred.id}`, 'credt.localhost')).status).toBe(200);
    expect((await root(`/credt/verify/${cred.id}`, 'credu.localhost')).status).toBe(404);
    expect((await root(`/credu/verify/${cred.id}`)).status).toBe(404);
    expect((await root(`/credt/verify/${'A'.repeat(22)}`)).status).toBe(404);
  });

  it('the private key is encrypted, never returned, and re-encrypted on a field-key rotation', async () => {
    const k = await inT(() => IssuerKeyModel.findOne({}).select('+privateKeyEnc').lean());
    expect(k?.privateKeyEnc).toMatch(/^v2\./);
    expect(ENCRYPTED_COLLECTIONS.map((c) => c.name)).toEqual(
      expect.arrayContaining(['credential issuer keys', 'network intros']),
    );
    const views = JSON.stringify([
      (await as(admin).get('/admin/credentials')).body,
      (await root('/credt/did.json')).body,
    ]);
    expect(views).not.toContain('privateKey');
    expect(views).not.toMatch(/"d":/);
  });

  it('rotation keeps old credentials valid; a compromised key re-signs them under the same link', async () => {
    const before = await inT(() => CredentialModel.findOne({ publicId: cred.id }).lean());
    const rotated = (await as(admin).post('/admin/credentials/rotate')).body.data;
    expect(rotated.keys.map((k: { status: string }) => k.status).sort()).toEqual(['active', 'retired']);
    expect((await root(`/credt/verify/${cred.id}`)).text).toContain('Valid');
    const r = await as(admin).post(`/admin/credentials/keys/${before?.kid}/compromised`);
    expect(r.status).toBe(200);
    const after = await inT(() => CredentialModel.findOne({ publicId: cred.id }).lean());
    expect(after?.kid).not.toBe(before?.kid);
    expect((await root(`/credt/verify/${cred.id}`)).text).toContain('Valid');
    const did = (await root('/credt/did.json')).body as { verificationMethod: { id: string }[] };
    expect(did.verificationMethod.some((m) => m.id.endsWith(`#${before?.kid}`))).toBe(false);
    expect((await as(otherAdmin).post(`/admin/credentials/keys/${after?.kid}/compromised`)).status).toBe(404);
  });

  it('revocation shows at once on the page and in the signed status list (N34)', async () => {
    const statusIndex = (await inT(() => CredentialModel.findOne({ publicId: cred.id }).lean()))
      ?.statusIndex as number;
    expect((await as(member).delete(`/credentials/${cred.id}`)).status).toBe(200);
    const page = await root(`/credt/verify/${cred.id}`);
    expect(page.text).toContain('Revoked');
    expect((await root(`/credt/verify/${cred.id}.jwt`)).status).toBe(404);
    const list = (await root('/credt/credentials/status/1')).text;
    const body = JSON.parse(Buffer.from(list.split('.')[1] ?? '', 'base64url').toString()) as {
      credentialSubject: { encodedList: string };
    };
    expect(CredentialsService.isRevokedIn(body.credentialSubject.encodedList, statusIndex)).toBe(true);
    expect(
      CredentialsService.isRevokedIn(body.credentialSubject.encodedList, (statusIndex + 1) % 131_072),
    ).toBe(false);
  });

  it('a source that stops standing revokes its credential at the reconcile', async () => {
    const again = (
      await as(member)
        .post('/credentials')
        .send({ type: 'PlacementOfferCredential', sourceId: offerId, nameStyle: 'first' })
    ).body.data as CredentialView;
    expect(again.name).toBe('Meena');
    await inT(() => OfferModel.updateOne({ _id: offerId }, { $set: { status: 'rejected' } }));
    expect(await inT(() => services.credentials.reconcile())).toBe(1);
    expect((await root(`/credt/verify/${again.id}`)).text).toContain('Revoked');
  });

  it('erasure revokes and strips the credential: only the status stays', async () => {
    await inT(() => OfferModel.updateOne({ _id: offerId }, { $set: { status: 'verified' } }));
    const c = (
      await as(member)
        .post('/credentials')
        .send({ type: 'PlacementOfferCredential', sourceId: offerId, nameStyle: 'full' })
    ).body.data as CredentialView;
    const exported = await inT(() => services.credentials.exportFor(member.id));
    expect(exported.credentials.length).toBeGreaterThan(0);
    await inT(() => services.credentials.eraseFor(member.id));
    const row = await inT(() => CredentialModel.findOne({ publicId: c.id }).lean());
    expect(row).toMatchObject({
      status: 'revoked',
      revokedReason: 'erased',
      name: null,
      claims: null,
      jwt: null,
      userId: null,
    });
    const page = await root(`/credt/verify/${c.id}`);
    expect(page.status).toBe(404);
    expect(page.text).not.toContain('Meena');
  });
});
