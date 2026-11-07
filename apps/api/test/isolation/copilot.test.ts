/**
 * MANDATORY tenant-isolation suite for prompt 2, G11: the Career Copilot's index, its search by
 * words and by meaning (one vector store shared by every college in this process), conversations
 * and next steps stay inside their college.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CopilotStreamEvent } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { runInTenant } from '../../src/lib/context.js';
import { PlacementCompanyModel, PlacementDriveModel } from '../../src/modules/placements/placements.model.js';
import { CopilotChunkModel, CopilotMessageModel } from '../../src/modules/copilot/copilot.model.js';
import { copilotScope, type CopilotIndexService } from '../../src/modules/copilot/copilot-index.service.js';
import type { GraphService } from '../../src/modules/graph/graph.service.js';

const ctx = testApp();
let A: TestTenant, B: TestTenant;
let adminA: TestUser, adminB: TestUser, studentA: TestUser, studentB: TestUser;
const AI = {
  chatProvider: 'mock',
  chatModel: '',
  embeddingProvider: 'mock',
  embeddingModel: '',
  baseUrl: null,
  embeddingBaseUrl: null,
  temperature: null,
  maxAnswerTokens: 800,
  maxChunks: 6,
  monthlyTokenBudget: 0,
  dailyMessagesPerUser: 40,
  chatRetentionDays: 30,
  features: { chatbot: true, studentUploads: false, externalVideos: false, ocr: true, transcription: true },
  killSwitch: false,
};

async function seed(t: TestTenant, admin: TestUser, company: string, secret: string) {
  await runInTenant(t._id, async () => {
    const c = await PlacementCompanyModel.create({ name: company, companyKey: company.toLowerCase() });
    await PlacementDriveModel.create({
      companyId: c._id,
      title: 'Campus drive',
      description: `${company} interviews ask about ${secret}.`,
      mode: 'on_campus',
      driveDate: new Date(Date.now() + 20 * 86_400_000),
      registrationCloseAt: new Date(Date.now() + 10 * 86_400_000),
      status: 'open',
      createdBy: admin.id,
    });
  });
  await api(ctx, t.host, admin.token).put('/admin/ai').send(AI).expect(200);
  const s = ctx.app.locals.services as { graph: GraphService; copilotIndex: CopilotIndexService };
  await runInTenant(t._id, () => s.graph.run());
  await runInTenant(t._id, () => s.copilotIndex.run());
}

async function ask(t: TestTenant, u: TestUser, question: string) {
  const r = await api(ctx, t.host, u.token).post('/copilot/chat').send({ question });
  const events = r.text
    .split('\n\n')
    .map((b) => /^data: (.*)$/m.exec(b)?.[1])
    .filter((x): x is string => !!x)
    .map((x) => JSON.parse(x) as CopilotStreamEvent);
  return { status: r.status, text: r.text, events };
}

beforeAll(async () => {
  A = await makeTenant('iso-copilot-a');
  B = await makeTenant('iso-copilot-b');
  adminA = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  studentB = await makeUser(ctx, B, { roles: ['STUDENT'] });
  await seed(A, adminA, 'Alphacorp', 'quaternion rotations');
  await seed(B, adminB, 'Betacorp', 'graph colouring');
});

describe('tenant isolation: the Career Copilot (prompt 2, G11)', () => {
  it('each college indexes only its own sources, under its own scopes', async () => {
    const a = await runInTenant(A._id, () => CopilotChunkModel.find().lean());
    const b = await runInTenant(B._id, () => CopilotChunkModel.find().lean());
    expect(a.map((c) => c.text).join()).toContain('Alphacorp');
    expect(a.map((c) => c.text).join()).not.toContain('Betacorp');
    expect(b.map((c) => c.text).join()).not.toContain('Alphacorp');
    const scopeA = await runInTenant(A._id, async () => copilotScope('drive'));
    const scopeB = await runInTenant(B._id, async () => copilotScope('drive'));
    expect(scopeA).not.toBe(scopeB);
  });

  it("searches by words and by meaning never return another college's sources", async () => {
    const answerOf = (r: Awaited<ReturnType<typeof ask>>) =>
      JSON.stringify(r.events.filter((e) => e.type === 'sources' || e.type === 'done' || e.type === 'delta'));
    const r = await ask(B, studentB, 'Do Alphacorp interviews ask about quaternion rotations?');
    expect(r.status).toBe(200);
    // The question is echoed back; nothing from college A's sources is.
    expect(answerOf(r)).not.toContain('quaternion');
    const own = await ask(A, studentA, 'Do Alphacorp interviews ask about quaternion rotations?');
    expect(answerOf(own)).toContain('quaternion');
  });

  it('conversations and next steps are not reachable from another college', async () => {
    const r = await ask(A, studentA, 'What does Alphacorp ask in interviews?');
    const start = r.events.find((e) => e.type === 'start') as Extract<CopilotStreamEvent, { type: 'start' }>;
    const done = r.events.find((e) => e.type === 'done') as Extract<CopilotStreamEvent, { type: 'done' }>;
    const asB = api(ctx, B.host, studentB.token);
    expect((await asB.get(`/copilot/sessions/${start.sessionId}`)).status).toBe(404);
    expect((await asB.delete(`/copilot/sessions/${start.sessionId}`)).status).toBe(404);
    expect(
      (await asB.post('/copilot/chat').send({ question: 'hello there', sessionId: start.sessionId })).status,
    ).toBe(404);
    expect(
      (await asB.post('/copilot/handoff').send({ messageId: done.message.id, kind: 'drive' })).status,
    ).toBe(404);
    expect(JSON.stringify((await asB.get('/copilot')).body.data.sessions)).not.toContain(start.sessionId);
    expect((await api(ctx, B.host, studentA.token).get('/copilot')).status).toBe(401);
    expect(await runInTenant(B._id, () => CopilotMessageModel.countDocuments({ userId: studentA.id }))).toBe(
      0,
    );
  });
});
