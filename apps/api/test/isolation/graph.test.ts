/**
 * MANDATORY tenant-isolation suite for prompt 2, G10: company pages, the Interview Experience Bank,
 * mentor outcomes and the 7-day prompts stay inside their college; a token for one college does
 * nothing at another.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompaniesView, ExperienceView } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import { OfferModel } from '../../src/modules/placements/placements.model.js';
import {
  CompanyGraphModel,
  ExperienceModel,
  ExperiencePromptModel,
  MentorOutcomeModel,
} from '../../src/modules/graph/graph.model.js';
import { GraphService } from '../../src/modules/graph/graph.service.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let studentA: TestUser, studentB: TestUser, facultyA: TestUser, facultyB: TestUser;
const asA = (u: TestUser) => api(ctx, A.host, u.token);
const asB = (u: TestUser) => api(ctx, B.host, u.token);
let shared: ExperienceView;

const offer = (userId: string, companyName: string) => ({
  userId,
  companyKey: companyName.toLowerCase(),
  companyName,
  role: 'Engineer',
  type: 'full_time',
  status: 'verified',
  source: 'drive',
  branch: 'CSE',
  gradYear: 2025,
  ctcBand: '5_8',
  ctcLpa: 6,
  offerDate: new Date(),
  verifiedAt: new Date(),
});
const SHARE = {
  company: 'Alphaonly',
  role: 'Engineer',
  year: 2025,
  rounds: [{ kind: 'technical', questions: ['What is a deadlock and how do you avoid one?'] }],
  difficulty: 'easy',
  result: 'selected',
};

beforeAll(async () => {
  A = await makeTenant('iso-graph-a');
  B = await makeTenant('iso-graph-b');
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  studentB = await makeUser(ctx, B, { roles: ['STUDENT'] });
  facultyA = await makeUser(ctx, A, { roles: ['FACULTY'] });
  facultyB = await makeUser(ctx, B, { roles: ['FACULTY'] });
  await runInTenant(A._id, () => OfferModel.create(offer(studentA.id, 'Alphaonly')));
  await runInTenant(B._id, () => OfferModel.create(offer(studentB.id, 'Betaonly')));
  const at = new Date();
  at.setUTCHours(21, 30, 0, 0);
  expect(await GraphService.enqueueNightly(ctx.queue, at)).toBe(2);
  await ctx.queue.drain();
  shared = (await asA(studentA).post('/me/experiences').send(SHARE)).body.data as ExperienceView;
});

describe('tenant isolation: the moat data (prompt 2, G10)', () => {
  it('each nightly run reads and writes only its own college', async () => {
    const a = await runInTenant(A._id, () => CompanyGraphModel.find().lean());
    const b = await runInTenant(B._id, () => CompanyGraphModel.find().lean());
    expect(a.map((g) => g.companyKey)).toEqual(['alphaonly']);
    expect(b.map((g) => g.companyKey)).toEqual(['betaonly']);
    expect(
      await runInTenant(B._id, () => ExperiencePromptModel.countDocuments({ userId: studentA.id })),
    ).toBe(0);
    expect(await runInTenant(B._id, () => MentorOutcomeModel.countDocuments())).toBe(0);
  });

  it('reads and search: company pages and lists of another college are not found', async () => {
    const list = (await asB(studentB).get('/companies')).body.data as CompaniesView;
    expect(list.items.map((c) => c.key)).toEqual(['betaonly']);
    const search = (await asB(studentB).get('/companies?q=alpha')).body.data as CompaniesView;
    expect(search.items).toEqual([]);
    expect((await asB(studentB).get('/companies/alphaonly')).status).toBe(404);
    expect((await api(ctx, B.host, studentA.token).get('/companies/alphaonly')).status).toBe(401);
  });

  it('writes: a member cannot share about a company from another college’s records', async () => {
    expect((await asB(studentB).post('/me/experiences').send(SHARE)).status).toBe(403);
    const mine = (await asB(studentB).get('/me/experiences')).body.data;
    expect(mine.items).toEqual([]);
    expect(mine.companies).toEqual([{ key: 'betaonly', name: 'Betaonly' }]);
  });

  it('updates and deletes: another college’s reviewers and members cannot touch a write-up', async () => {
    expect((await asB(facultyB).get('/admin/experiences')).body.data).toEqual([]);
    expect(
      (await asB(facultyB).post(`/admin/experiences/${shared.id}/decision`).send({ decision: 'approve' }))
        .status,
    ).toBe(404);
    expect(
      (await asB(facultyB).post(`/admin/experiences/${shared.id}/practice`).send({ round: 0, question: 0 }))
        .status,
    ).toBe(404);
    expect((await asB(studentB).delete(`/me/experiences/${shared.id}`)).status).toBe(404);
    expect(
      (
        await asB(studentB)
          .post('/reports')
          .send({ targetType: 'experience', targetId: shared.id, reason: 'spam' })
      ).status,
    ).toBe(404);
    expect(await runInTenant(A._id, () => ExperienceModel.findById(shared.id).lean())).toMatchObject({
      status: 'pending',
    });
    // Published at A, it is still nowhere at B.
    await asA(facultyA)
      .post(`/admin/experiences/${shared.id}/decision`)
      .send({ decision: 'approve' })
      .expect(200);
    expect((await asB(studentB).get('/companies/alphaonly')).status).toBe(404);
    expect((await asA(studentA).get('/companies/alphaonly')).body.data.experiences).toHaveLength(1);
  });
});
