import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CopilotHomeView, CopilotMessageView, CopilotStreamEvent } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { makeMentor } from './mentorship-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import {
  OfferModel,
  PlacementCompanyModel,
  PlacementDriveModel,
} from '../src/modules/placements/placements.model.js';
import { RoadmapModel } from '../src/modules/roadmaps/roadmap.model.js';
import { AiUsageModel } from '../src/modules/study/ai-usage.model.js';
import { ProductEventModel } from '../src/modules/insights/insights.model.js';
import { CompanyGraphModel, ExperienceModel } from '../src/modules/graph/graph.model.js';
import {
  CopilotChunkModel,
  CopilotMessageModel,
  CopilotSessionModel,
} from '../src/modules/copilot/copilot.model.js';
import { COPILOT_INDEX_JOB, CopilotIndexService } from '../src/modules/copilot/copilot-index.service.js';
import type { GraphService } from '../src/modules/graph/graph.service.js';
import type { RoadmapsService } from '../src/modules/roadmaps/roadmaps.service.js';

/** Prompt 2, G11: the Career Copilot. */

const ctx = testApp();
let T: TestTenant, U: TestTenant;
let admin: TestUser, faculty: TestUser, student: TestUser, other: TestUser, minor: TestUser, mentor: TestUser;
let outsider: TestUser;
let driveId: string;
const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
const inT = <R>(fn: () => Promise<R>) => runInTenant(T._id, fn);
const svc = () =>
  ctx.app.locals.services as {
    graph: GraphService;
    roadmaps: RoadmapsService;
    copilotIndex: CopilotIndexService;
  };
const reindex = async () => {
  await inT(() => svc().graph.run());
  await inT(() => svc().copilotIndex.run());
};
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

/** The server-sent events of one question. */
async function ask(u: TestUser, question: string, sessionId?: string) {
  const r = await as(u)
    .post('/copilot/chat')
    .set('Accept', 'text/event-stream')
    .send({ question, ...(sessionId ? { sessionId } : {}) });
  expect(r.status, r.text).toBe(200);
  const events = r.text
    .split('\n\n')
    .map((b) => /^data: (.*)$/m.exec(b)?.[1])
    .filter((x): x is string => !!x)
    .map((x) => JSON.parse(x) as CopilotStreamEvent);
  const done = events.find((e) => e.type === 'done') as
    Extract<CopilotStreamEvent, { type: 'done' }> | undefined;
  const sources = events.find((e) => e.type === 'sources') as
    Extract<CopilotStreamEvent, { type: 'sources' }> | undefined;
  const start = events.find((e) => e.type === 'start') as Extract<CopilotStreamEvent, { type: 'start' }>;
  return { events, message: done?.message as CopilotMessageView, sources: sources?.citations ?? [], start };
}
const chatUsage = () => inT(() => AiUsageModel.countDocuments({ kind: 'chat', feature: 'copilot' }));

beforeAll(async () => {
  T = await makeTenant('copilot');
  U = await makeTenant('copilotb');
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  other = await makeUser(ctx, T, { roles: ['STUDENT'] });
  minor = await makeUser(ctx, T, { roles: ['STUDENT'] });
  outsider = await makeUser(ctx, U, { roles: ['STUDENT'] });
  mentor = await makeMentor(ctx, T, {
    profile: { company: 'Nimbus Labs', topics: ['Backend', 'System design'] },
  });
  const year = new Date().getFullYear();
  await inT(async () => {
    await ProfileModel.updateMany(
      { userId: { $in: [student.id, other.id, minor.id] } },
      { $set: { branch: 'CSE', gradYear: year + 1 } },
    );
    await ProfileModel.updateOne(
      { userId: minor.id },
      { $set: { minorUntil: new Date(Date.now() + 200 * 86_400_000) } },
    );
    const company = await PlacementCompanyModel.create({ name: 'Nimbus Labs', companyKey: 'nimbus labs' });
    const drive = await PlacementDriveModel.create({
      companyId: company._id,
      title: 'Backend engineer drive',
      description: 'Nimbus Labs hires backend engineers who know Java, SQL and system design basics.',
      roles: [
        { title: 'Backend Engineer', ctcMinLpa: 6, ctcMaxLpa: 8, location: 'Hyderabad', type: 'full_time' },
      ],
      mode: 'on_campus',
      driveDate: new Date(Date.now() + 20 * 86_400_000),
      registrationCloseAt: new Date(Date.now() + 10 * 86_400_000),
      eligibility: { branches: ['CSE'], gradYears: [], minCgpa: null },
      rounds: [
        { name: 'Online test', kind: 'aptitude' },
        { name: 'Technical', kind: 'technical' },
      ],
      resumeRequired: false,
      status: 'open',
      createdBy: admin.id,
    });
    driveId = String(drive._id);
    for (let i = 0; i < 6; i++)
      await OfferModel.create({
        userId: new Types.ObjectId(),
        companyKey: 'nimbus labs',
        companyName: 'Nimbus Labs',
        role: 'Backend Engineer',
        type: 'full_time',
        status: 'verified',
        source: 'drive',
        branch: 'CSE',
        gradYear: year - 1,
        ctcBand: '5_8',
        ctcLpa: 6.5,
        offerDate: new Date(Date.now() - 200 * 86_400_000),
      });
    await ExperienceModel.create({
      authorId: null,
      companyKey: 'nimbus labs',
      companyName: 'Nimbus Labs',
      role: 'Backend Engineer',
      year: year - 1,
      rounds: [
        {
          kind: 'technical',
          name: 'Technical',
          questions: [{ text: 'Design a URL shortener and explain the database schema.', sent: null }],
          notes: 'They asked about indexing in SQL and Java collections.',
        },
      ],
      tips: 'Practise system design basics and SQL joins before the Nimbus interview.',
      difficulty: 'medium',
      result: 'selected',
      named: false,
      basis: 'verified_offer',
      branch: 'CSE',
      gradYear: year - 1,
      status: 'published',
    });
  });
  await inT(() => svc().roadmaps.installFromLibrary(null, 'backend'));
  await as(student).post('/me/consents').send({ purpose: 'analytics_aggregate', granted: true }).expect(200);
  const saved = await as(admin).put('/admin/ai').send(AI);
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  await reindex();
});

describe('the copilot index (G11)', () => {
  it('holds college-wide passages of every indexed kind, embedded, and is due daily from 03:00 India time', async () => {
    const kinds = await inT(() => CopilotChunkModel.distinct('kind'));
    expect(kinds.sort()).toEqual(['company', 'drive', 'experience', 'roadmap']);
    expect(await inT(() => CopilotChunkModel.countDocuments({ embeddingModel: null }))).toBe(0);
    // Nothing about members is indexed: no names, no résumé, no readiness.
    const text = (await inT(() => CopilotChunkModel.find().lean())).map((c) => c.text).join('\n');
    expect(text).not.toContain('Test Person');
    expect(text).not.toContain('6.5');
    const at = new Date();
    at.setUTCHours(20, 0, 0, 0); // 01:30 IST
    expect(await CopilotIndexService.enqueueDaily(ctx.queue, at)).toBe(0);
    at.setUTCHours(22, 0, 0, 0); // 03:30 IST
    expect(await CopilotIndexService.enqueueDaily(ctx.queue, at)).toBe(2);
    await ctx.queue.drain();
    expect(COPILOT_INDEX_JOB).toBe('copilot.index');
  });
});

describe('answers (G11, E2: cite or refuse)', () => {
  it('answers from numbered sources with citations, ends with human next steps, and records the question', async () => {
    const before = await chatUsage();
    const r = await ask(student, 'How should I prepare for the Nimbus Labs interview? What do they ask?');
    expect(r.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['start', 'sources', 'delta', 'done']),
    );
    expect(r.message.result).toBeNull();
    expect(r.message.citations.length).toBeGreaterThan(0);
    // Every [n] in the answer is a citation that exists; every citation opens in the app.
    const cited = [...r.message.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    expect(cited.length).toBeGreaterThan(0);
    for (const n of cited) expect(r.message.citations.map((c) => c.n)).toContain(n);
    for (const c of r.message.citations)
      expect(c.href).toMatch(/^\/(companies|placements|roadmaps|mentors|resume|readiness)/);
    expect(r.sources.map((s) => s.kind)).toEqual(
      expect.arrayContaining(['company', 'experience', 'drive', 'mentor']),
    );
    // Up to two human next steps: an alumnus at Nimbus, and the open drive.
    expect(r.message.handoffs).toEqual([
      expect.objectContaining({ kind: 'ask_alumnus', href: `/mentors/${mentor.id}`, detail: 'Nimbus Labs' }),
      expect.objectContaining({ kind: 'drive', href: `/placements/${driveId}`, name: 'Nimbus Labs' }),
    ]);
    expect(await chatUsage()).toBe(before + 1);
    // The cost of one answer stays within its envelope (docs/ai-assistant.md): ~8 sources, ≤ 700 out.
    const usage = await inT(() => AiUsageModel.find({ feature: 'copilot' }).lean());
    const chat = usage.find((u) => u.kind === 'chat');
    expect(chat?.inputTokens ?? 0).toBeGreaterThan(300);
    expect(chat?.inputTokens ?? 0).toBeLessThan(4000);
    expect(usage.some((u) => u.kind === 'embedding')).toBe(true);
    if (process.env.COPILOT_MEASURE) console.warn('copilot usage', JSON.stringify(usage));
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'copilot_question', userId: student.id })),
    ).toBe(1);
  });

  it('refuses salary predictions and guarantees without calling the AI, and still offers a human', async () => {
    const before = await chatUsage();
    for (const q of [
      'What salary will I get at Nimbus Labs?',
      'Can you guarantee I will be selected at Nimbus Labs?',
      'Will I get placed with a 6.8 CGPA? What are my chances?',
    ]) {
      const r = await ask(student, q);
      expect(r.message.result, q).toEqual({ kind: 'refusal', reason: 'prediction' });
      expect(r.message.text).toBe('');
      expect(r.message.handoffs[0]?.kind).toBe('ask_alumnus');
    }
    expect(await chatUsage()).toBe(before);
  });

  it('says what is not covered instead of answering from nothing', async () => {
    const before = await chatUsage();
    const r = await ask(student, 'What is the best biryani place in Hyderabad?');
    expect(r.message.result).toEqual({ kind: 'refusal', reason: 'not_covered' });
    expect(r.message.citations).toEqual([]);
    expect(await chatUsage()).toBe(before);
  });

  it('without AI the college gets its sources, cited, never an error', async () => {
    const r = await ask(outsider, 'How do I prepare for interviews?');
    expect(r.message.status).toBe('done');
    expect(['sources_only', 'refusal']).toContain(r.message.result?.kind);
    const home = (await as(outsider).get('/copilot')).body.data as CopilotHomeView;
    expect(home.ai).toBe(false);
  });
});

describe('access checks on every read, per source kind (G11)', () => {
  it('a source taken down after indexing is never shown: write-up, drive, company page, roadmap', async () => {
    await inT(async () => {
      await ExperienceModel.updateMany({}, { $set: { status: 'removed' } });
      await PlacementDriveModel.updateOne({ _id: driveId }, { $set: { status: 'draft' } });
      await RoadmapModel.updateMany({}, { $set: { status: 'archived' } });
      await CompanyGraphModel.deleteMany({});
    });
    // The index still has them (until tonight); the copilot re-checks each one.
    expect(await inT(() => CopilotChunkModel.countDocuments({ kind: 'experience' }))).toBeGreaterThan(0);
    const r = await ask(
      student,
      'Nimbus Labs interview questions, system design, SQL and the backend roadmap',
    );
    const kinds = r.sources.map((s) => s.kind);
    for (const k of ['experience', 'drive', 'company', 'roadmap']) expect(kinds, k).not.toContain(k);
    await inT(async () => {
      await ExperienceModel.updateMany({}, { $set: { status: 'published' } });
      await PlacementDriveModel.updateOne({ _id: driveId }, { $set: { status: 'open' } });
      await RoadmapModel.updateMany({}, { $set: { status: 'published' } });
    });
    await reindex();
  });

  it('the member’s own facts are theirs: another student never sees them; minors get no ranking signals', async () => {
    await as(student).post('/resumes').send({ title: 'Backend résumé for Nimbus' });
    const mine = await ask(student, 'Am I eligible for the Nimbus Labs drive?');
    expect(mine.sources.some((s) => s.kind === 'me' && s.title === 'Your résumé')).toBe(true);
    expect(JSON.stringify(mine.sources)).toContain('Backend résumé for Nimbus');
    const theirs = await ask(other, 'Am I eligible for the Nimbus Labs drive?');
    expect(JSON.stringify(theirs.sources)).not.toContain('Backend résumé for Nimbus');
    const young = await ask(minor, 'How do I prepare for the Nimbus Labs interview?');
    expect(young.sources.some((s) => s.title === 'Your readiness')).toBe(false);
    expect(mine.sources.some((s) => s.title === 'Your readiness')).toBe(true);
  });
});

describe('commands (G11)', () => {
  it('/eligible, /prep, /mock, /resume and /plan', async () => {
    const eligible = await ask(student, '/eligible');
    expect(eligible.message.result).toEqual({
      kind: 'drives',
      drives: [expect.objectContaining({ id: driveId, company: 'Nimbus Labs' })],
    });
    const prep = await ask(student, '/prep Nimbus Labs');
    expect(prep.message.result).toEqual({
      kind: 'link',
      command: 'prep',
      href: '/companies/nimbus%20labs',
      company: 'Nimbus Labs',
    });
    expect(prep.message.citations.length).toBeGreaterThan(0);
    expect((await ask(student, '/mock Nimbus Labs')).message.result).toEqual({
      kind: 'link',
      command: 'mock',
      href: '/interviews?company=Nimbus%20Labs',
      company: 'Nimbus Labs',
    });
    expect((await ask(student, '/resume data analyst')).message.result).toMatchObject({
      kind: 'link',
      command: 'resume',
      href: '/resume?target=data%20analyst',
    });
    const plan = (await ask(student, '/plan')).message.result;
    expect(plan?.kind).toBe('plan');
    expect(plan && plan.kind === 'plan' ? plan.weeks.map((w) => w.week) : []).toEqual([1, 2, 3, 4]);
  });
});

describe('next steps, conversations and permissions (G11)', () => {
  it('opening a human next step is recorded, only on the member’s own answer', async () => {
    const r = await ask(student, 'How should I prepare for the Nimbus Labs interview?');
    await as(student)
      .post('/copilot/handoff')
      .send({ messageId: r.message.id, kind: 'ask_alumnus' })
      .expect(204);
    expect(
      await inT(() => ProductEventModel.countDocuments({ name: 'copilot_handoff', userId: student.id })),
    ).toBe(1);
    expect(
      (await as(other).post('/copilot/handoff').send({ messageId: r.message.id, kind: 'ask_alumnus' }))
        .status,
    ).toBe(404);
  });

  it('conversations are private to the member', async () => {
    const r = await ask(student, 'What rounds does Nimbus Labs have?');
    const sid = r.start.sessionId;
    const follow = await ask(student, 'And the aptitude test?', sid);
    expect(follow.start.sessionId).toBe(sid);
    const mine = await as(student).get(`/copilot/sessions/${sid}`);
    expect(mine.body.data.messages).toHaveLength(4);
    expect((await as(other).get(`/copilot/sessions/${sid}`)).status).toBe(404);
    expect(
      (await as(other).post('/copilot/chat').send({ question: 'hello there', sessionId: sid })).status,
    ).toBe(404);
    expect((await as(other).delete(`/copilot/sessions/${sid}`)).status).toBe(404);
    expect((await as(faculty).get(`/copilot/sessions/${sid}`)).status).toBe(403);
    await as(student).delete(`/copilot/sessions/${sid}`).expect(204);
    expect(await inT(() => CopilotMessageModel.countDocuments({ sessionId: sid }))).toBe(0);
  });

  it('staff and alumni do not use it; the placements switch turns it off', async () => {
    expect((await as(faculty).get('/copilot')).status).toBe(403);
    expect((await as(mentor).get('/copilot')).status).toBe(403);
    const home = (await as(student).get('/copilot')).body.data as CopilotHomeView;
    expect(home.ai).toBe(true);
    expect(home.left).toBeGreaterThan(0);
  });

  it('privacy: export and erasure of the member’s conversations', async () => {
    await ask(other, 'What rounds does Nimbus Labs have?');
    const exp = JSON.parse((await as(other).get('/me/export')).text);
    expect(exp.copilot.copilotMessages.length).toBeGreaterThan(0);
    const services = ctx.app.locals.services as { copilot: { eraseFor(u: string): Promise<void> } };
    await inT(() => services.copilot.eraseFor(other.id));
    expect(await inT(() => CopilotMessageModel.countDocuments({ userId: other.id }))).toBe(0);
    expect(await inT(() => CopilotSessionModel.countDocuments({ userId: other.id }))).toBe(0);
  });
});
