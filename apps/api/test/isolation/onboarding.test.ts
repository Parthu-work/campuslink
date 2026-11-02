/**
 * MANDATORY tenant-isolation suite for build B4: invite links and class join codes. A link, a code,
 * a roster record or a one-time code of college A means nothing at college B.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  makeTenant,
  makeUser,
  phoneCodeFrom,
  testApp,
  type TestTenant,
  type TestUser,
} from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import { WhitelistModel } from '../../src/modules/imports/whitelist.model.js';
import { InviteLinkModel, JoinCodeModel } from '../../src/modules/verification/onboarding.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let tpoA: TestUser, tpoB: TestUser;
const PHONE = '+919700077001';
let recId = '';
let token = '';
let code = { id: '', code: '' };

beforeAll(async () => {
  A = await makeTenant('iso-onb-a');
  B = await makeTenant('iso-onb-b');
  tpoA = await makeUser(ctx, A, { roles: ['TPO'] });
  tpoB = await makeUser(ctx, B, { roles: ['TPO'] });
  const c = ctx.services.cipher;
  await runInTenant(A._id, () =>
    WhitelistModel.create({
      rollNumber: '24ISO10001',
      name: 'Isolated Roster',
      kind: 'student',
      branch: 'CSE',
      gradYear: 2027,
      source: 'import',
      phoneEnc: c.encrypt(PHONE),
      phoneIndex: c.blindIndex(PHONE),
    }),
  );
  recId = String((await runInTenant(A._id, () => WhitelistModel.findOne().lean()))?._id);
  const sent = await api(ctx, A.host, tpoA.token)
    .post('/admin/onboarding/invites')
    .send({ ids: [recId], channel: 'csv' });
  token = String(sent.body.data.links[0].link).split('/invite/')[1] ?? '';
  const jc = await api(ctx, A.host, tpoA.token).post('/admin/join-codes').send({ kind: 'student' });
  code = jc.body.data;
});

describe('tenant isolation: invites and join codes (B4)', () => {
  it("college B cannot open, accept or confirm college A's invite link", async () => {
    expect((await api(ctx, B.host).get(`/invite/${token}`)).status).toBe(404);
    expect((await api(ctx, B.host).post(`/invite/${token}/accept`).send({})).status).toBe(404);
    // A real code from college A, replayed at college B.
    const s = await api(ctx, A.host).post(`/invite/${token}/accept`).send({});
    const body = {
      challengeId: s.body.data.challengeId,
      code: phoneCodeFrom(ctx, PHONE).code,
      birthMonth: '2003-01',
      consents: ['account'],
      locale: 'en',
    };
    expect((await api(ctx, B.host).post(`/invite/${token}/accept/confirm`).send(body)).status).toBe(400);
    expect((await api(ctx, A.host).get(`/invite/${token}`)).status).toBe(200);
  });

  it("college B cannot use college A's join code or reach its roster through it", async () => {
    expect((await api(ctx, B.host).get(`/join/${code.code}`)).status).toBe(404);
    expect(
      (await api(ctx, B.host).post(`/join/${code.code}/start`).send({ rollNumber: '24ISO10001' })).status,
    ).toBe(404);
  });

  it("college B's TPO cannot list, invite, expire or print college A's records and codes", async () => {
    const b = api(ctx, B.host, tpoB.token);
    const list = await b.get('/admin/onboarding/records');
    expect(JSON.stringify(list.body)).not.toContain('24ISO10001');
    const inv = await b.post('/admin/onboarding/invites').send({ ids: [recId], channel: 'csv' });
    expect(inv.body.data).toMatchObject({ created: 0, skipped: 0 });
    expect((await b.get('/admin/join-codes')).body.data).toEqual([]);
    expect((await b.post(`/admin/join-codes/${code.id}/expire`)).status).toBe(404);
    expect((await b.get(`/admin/join-codes/${code.id}/poster`)).status).toBe(404);
    const stillLive = await runInTenant(A._id, () => JoinCodeModel.findById(code.id).lean());
    expect(stillLive?.revokedAt).toBeNull();
    const links = await runInTenant(B._id, () => InviteLinkModel.countDocuments());
    expect(links).toBe(0);
  });

  it('a token and a code are unique per college, never global', async () => {
    // The same code string can exist at B without touching A's.
    await runInTenant(B._id, () =>
      JoinCodeModel.create({
        code: code.code,
        kind: 'alumni',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdBy: tpoB.id,
      }),
    );
    expect((await api(ctx, B.host).get(`/join/${code.code}`)).body.data.kind).toBe('alumni');
    expect((await api(ctx, A.host).get(`/join/${code.code}`)).body.data.kind).toBe('student');
  });
});
