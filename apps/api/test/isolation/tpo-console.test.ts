/**
 * MANDATORY tenant-isolation suite for build B6: bulk verification decisions, onboarding
 * progress and targeted announcements stay inside their college.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import { VerificationRequestModel } from '../../src/modules/verification/verification.model.js';
import { WhitelistModel } from '../../src/modules/imports/whitelist.model.js';
import { NotificationModel } from '../../src/modules/notifications/notification.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let tpoA: TestUser, tpoB: TestUser, facultyA: TestUser, studentB: TestUser;
let requestA = '';

beforeAll(async () => {
  A = await makeTenant('iso-tpo-a', 'college', { whatsapp: true });
  B = await makeTenant('iso-tpo-b', 'college', { whatsapp: true });
  tpoA = await makeUser(ctx, A, { roles: ['TPO'] });
  tpoB = await makeUser(ctx, B, { roles: ['TPO'] });
  facultyA = await makeUser(ctx, A, { roles: ['FACULTY'] });
  studentB = await makeUser(ctx, B, { roles: ['STUDENT'] });
  const pendingA = await makeUser(ctx, A, { roles: ['STUDENT'], verified: false });
  requestA = await runInTenant(A._id, async () => {
    await WhitelistModel.create({
      rollNumber: '24ISOTPO01',
      name: 'Isolated Roster',
      branch: 'IT',
      gradYear: 2029,
      kind: 'student',
      source: 'import',
    });
    const r = await VerificationRequestModel.create({
      userId: pendingA.id,
      method: 'id_card',
      rollNumber: '24ISOTPO02',
      gradYear: 2029,
    });
    return String(r._id);
  });
});

describe('tenant isolation: TPO console (B6)', () => {
  it("college B's TPO cannot decide college A's verification requests in bulk", async () => {
    const r = await api(ctx, B.host, tpoB.token)
      .post('/admin/verification/bulk-decision')
      .send({ ids: [requestA], decision: 'approve' });
    expect(r.body.data).toEqual([expect.objectContaining({ id: requestA, ok: false, error: 'NOT_FOUND' })]);
    const doc = await runInTenant(A._id, () => VerificationRequestModel.findById(requestA).lean());
    expect(doc?.status).toBe('pending');
  });

  it("college B's onboarding progress and nudges never include college A's list", async () => {
    const b = api(ctx, B.host, tpoB.token);
    expect((await b.get('/admin/onboarding')).body.data).toEqual([]);
    const n = await b
      .post('/admin/onboarding/nudge')
      .send({ branch: 'IT', gradYear: 2029, attestOptIn: true });
    expect(n.body.data).toMatchObject({ created: 0, sent: 0 });
    expect((await api(ctx, A.host, tpoA.token).get('/admin/onboarding')).body.data[0]).toMatchObject({
      branch: 'IT',
      roster: 1,
    });
  });

  it("college A's announcement reaches nobody at college B", async () => {
    const r = await api(ctx, A.host, facultyA.token)
      .post('/posts')
      .send({ kind: 'text', body: 'Isolated announcement', announcement: true, sendWhatsApp: true });
    expect(r.status).toBe(201);
    await ctx.queue.drain();
    expect(await runInTenant(B._id, () => NotificationModel.countDocuments({ type: 'announcement' }))).toBe(
      0,
    );
    expect((await api(ctx, B.host, studentB.token).get(`/posts/${r.body.data.id}`)).status).toBe(404);
  });
});
