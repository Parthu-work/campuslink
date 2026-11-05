/**
 * MANDATORY tenant-isolation suite for prompt 2, G5: readiness scores, the board, weights, nudges
 * and the export stay inside their college; a token for one college does nothing at another.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_READINESS_WEIGHTS, type ReadinessBoardView } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import { ProfileModel } from '../../src/modules/profiles/profile.model.js';
import { ResumeModel } from '../../src/modules/resumes/resume.model.js';
import { NotificationModel } from '../../src/modules/notifications/notification.model.js';
import { ReadinessConfigModel, ReadinessNudgeModel } from '../../src/modules/readiness/readiness.model.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let tpoA: TestUser, tpoB: TestUser, studentA: TestUser, studentB: TestUser;
const asA = (u: TestUser) => api(ctx, A.host, u.token);
const asB = (u: TestUser) => api(ctx, B.host, u.token);

beforeAll(async () => {
  A = await makeTenant('iso-ready-a');
  B = await makeTenant('iso-ready-b');
  tpoA = await makeUser(ctx, A, { roles: ['TPO'] });
  tpoB = await makeUser(ctx, B, { roles: ['TPO'] });
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  studentB = await makeUser(ctx, B, { roles: ['STUDENT'] });
  await runInTenant(A._id, async () => {
    await ProfileModel.updateOne(
      { userId: studentA.id },
      { $set: { name: 'Isolated Ready A', branch: 'CSE', gradYear: 2027 } },
    );
    await ResumeModel.create({
      userId: studentA.id,
      title: 'A only',
      content: { basics: {} },
      atsReport: {
        score: 88,
        checks: [],
        keywords: null,
        gaps: [],
        pages: 1,
        version: 1,
        checkedAt: new Date().toISOString(),
      },
    });
  });
});

describe('tenant isolation: readiness (prompt 2, G5)', () => {
  it("a college's score reads only its own data; a token is refused at another college", async () => {
    const mine = await asA(studentA).get('/me/readiness');
    expect(mine.body.data.components.find((c: { id: string }) => c.id === 'resume').facts.ats).toBe(88);
    // College B's student has no résumé there: A's never counts for them.
    const theirs = await asB(studentB).get('/me/readiness');
    expect(theirs.body.data.components.find((c: { id: string }) => c.id === 'resume').facts.resumes).toBe(0);
    // A's student's token at B's host.
    expect((await api(ctx, B.host, studentA.token).get('/me/readiness')).status).toBe(401);
  });

  it("college B's board, export and search never include college A's students", async () => {
    const b = (await asB(tpoB).get('/admin/readiness')).body.data as ReadinessBoardView;
    expect(b.groups.every((g) => g.gradYear !== 2027 || g.branch !== 'CSE')).toBe(true);
    expect(JSON.stringify(b)).not.toContain(studentA.id);
    const csv = await asB(tpoB).get('/admin/readiness/export');
    expect(csv.text).not.toContain('Isolated Ready A');
    const filtered = (await asB(tpoB).get('/admin/readiness?branch=CSE&gradYear=2027')).body
      .data as ReadinessBoardView;
    expect(filtered.groups).toEqual([]);
    expect((await api(ctx, A.host, tpoB.token).get('/admin/readiness')).status).toBe(401);
  });

  it("college B cannot nudge college A's students or change college A's weights", async () => {
    const n = await asB(tpoB)
      .post('/admin/readiness/nudge')
      .send({ userIds: [studentA.id] });
    expect(n.body.data).toEqual({ sent: 0, coolingOff: 0, notListed: 1 });
    expect(
      await runInTenant(A._id, () =>
        NotificationModel.countDocuments({ userId: studentA.id, type: 'readiness_nudge' }),
      ),
    ).toBe(0);
    expect(await runInTenant(A._id, () => ReadinessNudgeModel.countDocuments({}))).toBe(0);

    const weights = { ...DEFAULT_READINESS_WEIGHTS, mentorship: 0 };
    const put = await asB(tpoB)
      .put('/admin/readiness/config')
      .send({ weights, threshold: 70, closingDays: 3 });
    expect(put.status).toBe(200);
    // B's weights are B's: A still has the defaults, and A's TPO sees them.
    expect(await runInTenant(A._id, () => ReadinessConfigModel.countDocuments({}))).toBe(0);
    const a = (await asA(tpoA).get('/admin/readiness/config')).body.data;
    expect(a).toMatchObject({ weights: DEFAULT_READINESS_WEIGHTS, threshold: 50 });
  });

  it('erasure in one college leaves the other college untouched', async () => {
    await runInTenant(B._id, () => ReadinessNudgeModel.create({ userId: studentB.id, driveId: studentB.id }));
    await runInTenant(A._id, () => ReadinessNudgeModel.create({ userId: studentA.id, driveId: studentA.id }));
    const services = ctx.services as unknown as {
      readiness: { eraseFor(u: string): Promise<void> };
    };
    await runInTenant(B._id, () => services.readiness.eraseFor(studentA.id));
    expect(await runInTenant(A._id, () => ReadinessNudgeModel.countDocuments({ userId: studentA.id }))).toBe(
      1,
    );
  });
});
