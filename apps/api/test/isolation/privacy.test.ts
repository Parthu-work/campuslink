/** Tenant isolation for data rights: exports and erasure never cross colleges. */
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, PASSWORD, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import type { PrivacyService } from '../../src/modules/privacy/privacy.service.js';
import { UserModel } from '../../src/modules/auth/user.model.js';

const ctx = testApp();
const privacy = (ctx.app.locals.services as { privacy: PrivacyService }).privacy;
let A: TestTenant, B: TestTenant;
let alumA: TestUser, alumB: TestUser;

beforeAll(async () => {
  A = await makeTenant('isoprivacya');
  B = await makeTenant('isoprivacyb');
  alumA = await makeUser(ctx, A, { roles: ['ALUMNI'] });
  alumB = await makeUser(ctx, B, { roles: ['ALUMNI'] });
  await api(ctx, A.host, alumA.token).post('/posts').send({ kind: 'text', body: 'Alpha-only Zyxquark post' });
});

describe('privacy across colleges', () => {
  it('an export holds only the requesting college’s data', async () => {
    const r = await api(ctx, B.host, alumB.token).get('/me/export');
    expect(r.status).toBe(200);
    expect(r.text).not.toContain('Zyxquark');
    expect(r.text).not.toContain(alumA.id);
    expect((await api(ctx, B.host, alumA.token).get('/me/export')).status).toBe(401);
  });

  it('erasure in one college never touches another', async () => {
    await api(ctx, A.host, alumA.token).post('/me/deletion').send({ password: PASSWORD });
    await runInTenant(A._id, () =>
      UserModel.updateOne({ _id: alumA.id }, { $set: { deletionPurgeAt: new Date(Date.now() - 1000) } }),
    );
    expect(await runInTenant(B._id, () => privacy.purgeDue())).toBe(0);
    expect(await runInTenant(A._id, () => UserModel.countDocuments({ _id: alumA.id }))).toBe(1);
    expect(await runInTenant(A._id, () => privacy.purgeDue())).toBe(1);
    expect(await runInTenant(B._id, () => UserModel.countDocuments({ _id: alumB.id }))).toBe(1);
  });
});
