/**
 * MANDATORY tenant-isolation suite for build B2: phone identities, one-time codes, guardian numbers
 * and guardian consent. A number, a code or a consent of college A means nothing at college B.
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
import { OtpChallengeModel } from '../../src/modules/verification/verification.model.js';
import { UserModel } from '../../src/modules/auth/user.model.js';
import { ConsentModel } from '../../src/modules/consent/consent.model.js';
import { WhitelistModel } from '../../src/modules/imports/whitelist.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let tpoB: TestUser;
const PHONE = '+919700012345';
const GUARDIAN = '+919700054321';
const signup = {
  name: 'Isolated Phone',
  intent: 'STUDENT',
  birthMonth: '2001-02',
  consents: ['account'],
  locale: 'en',
};

async function signUpAt(t: TestTenant, phone: string, birthMonth = '2001-02') {
  const s = await api(ctx, t.host).post('/auth/phone/start').send({ phone, purpose: 'signup' });
  return api(ctx, t.host)
    .post('/auth/phone/verify')
    .send({
      challengeId: s.body.data.challengeId,
      code: phoneCodeFrom(ctx, phone).code,
      signup: { ...signup, birthMonth },
    });
}

beforeAll(async () => {
  A = await makeTenant('isophonea');
  B = await makeTenant('isophoneb');
  tpoB = await makeUser(ctx, B, { roles: ['TPO'] });
});

describe('phone identity isolation', () => {
  it('the same number is a separate account in each college', async () => {
    const a = await signUpAt(A, PHONE);
    const b = await signUpAt(B, PHONE);
    expect([a.body.data.created, b.body.data.created]).toEqual([true, true]);
    const ids = [
      (await api(ctx, A.host, a.body.data.session.accessToken).get('/me')).body.data.id,
      (await api(ctx, B.host, b.body.data.session.accessToken).get('/me')).body.data.id,
    ];
    expect(ids[0]).not.toBe(ids[1]);
    // A's token is refused at B.
    expect((await api(ctx, B.host, a.body.data.session.accessToken).get('/me')).status).toBe(401);
  });

  it('a code issued at A cannot be read, used or updated at B', async () => {
    const s = await api(ctx, A.host).post('/auth/phone/start').send({ phone: PHONE, purpose: 'login' });
    const id = s.body.data.challengeId as string;
    const code = phoneCodeFrom(ctx, PHONE).code;
    const atB = await api(ctx, B.host).post('/auth/phone/verify').send({ challengeId: id, code });
    expect(atB.status).toBe(400);
    expect(await runInTenant(B._id, () => OtpChallengeModel.findById(id).lean())).toBeNull();
    expect(
      (await runInTenant(B._id, () => OtpChallengeModel.updateOne({ _id: id }, { $inc: { attempts: 5 } })))
        .matchedCount,
    ).toBe(0);
    expect((await runInTenant(B._id, () => OtpChallengeModel.deleteOne({ _id: id }))).deletedCount).toBe(0);
    // Still valid at A.
    const atA = await api(ctx, A.host).post('/auth/phone/verify').send({ challengeId: id, code });
    expect(atA.body.data.created).toBe(false);
  });

  it('phone lookups, guardian numbers and guardian consents stay in their college', async () => {
    const c = ctx.services.cipher;
    expect(
      await runInTenant(B._id, () =>
        UserModel.countDocuments({ phoneIndex: { $in: c.blindIndexes(PHONE) } }),
      ),
    ).toBe(1);
    const minorPhone = '+919700099999';
    await runInTenant(A._id, () =>
      WhitelistModel.create({
        rollNumber: '24IS1A0001',
        name: 'Iso Minor',
        kind: 'student',
        source: 'import',
        phoneEnc: c.encrypt(minorPhone),
        phoneIndex: c.blindIndex(minorPhone),
        guardianPhoneEnc: c.encrypt(GUARDIAN),
        guardianPhoneIndex: c.blindIndex(GUARDIAN),
      }),
    );
    const year = new Date().getUTCFullYear();
    const m = await signUpAt(A, minorPhone, `${year - 16}-03`);
    const token = m.body.data.session.accessToken as string;
    const s = await api(ctx, A.host, token).post('/me/guardian/start').send({});
    await api(ctx, A.host, token)
      .post('/me/guardian/confirm')
      .send({ challengeId: s.body.data.challengeId, code: phoneCodeFrom(ctx, GUARDIAN).code, language: 'en' })
      .expect(200);
    expect(await runInTenant(B._id, () => ConsentModel.countDocuments({ purpose: 'guardian_consent' }))).toBe(
      0,
    );
    expect(
      await runInTenant(B._id, () =>
        WhitelistModel.countDocuments({ guardianPhoneIndex: { $in: c.blindIndexes(GUARDIAN) } }),
      ),
    ).toBe(0);
    // B's TPO sees nothing of A's queue.
    expect((await api(ctx, B.host, tpoB.token).get('/admin/verification')).body.data).toEqual([]);
  });
});
