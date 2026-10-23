import { beforeAll, describe, expect, it } from 'vitest';
import {
  AI_CONSENT_VERSION,
  type AiUsageView,
  type ChatMessageView,
  type ChatStreamEvent,
  type StudyInsightsView,
} from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { aiFetcher, makeSubject, OPENAI_KEY, textPdf } from './study-fixtures.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { NotificationModel } from '../src/modules/notifications/notification.model.js';
import { EMBED_JOB, type IndexingService } from '../src/modules/study/indexing.service.js';
import { nextMonth, type AiUsageService } from '../src/modules/study/ai-usage.service.js';
import type { AiSettingsService } from '../src/modules/study/ai-settings.service.js';
import { costOf } from '../src/modules/study/insights.service.js';
import {
  BREAKER_OPEN_MS,
  BREAKER_THRESHOLD,
  CircuitBreaker,
  guardedChat,
} from '../src/modules/study/ai/breaker.js';
import { ProviderError, type LLMProvider } from '../src/modules/study/ai/provider.js';

const fake = aiFetcher();
const ctx = testApp({ fetcher: fake.fn });
const services = ctx.app.locals.services as {
  aiSettings: AiSettingsService;
  aiUsage: AiUsageService;
  indexing: IndexingService;
};
services.aiSettings.sleep = async () => undefined;

let T: TestTenant, U: TestTenant;
let faculty: TestUser, otherFaculty: TestUser, admin: TestUser, otherAdmin: TestUser;
let students: TestUser[];
let shared: string, cfgTopic: string, pumpingTopic: string, pdfId: string, otherSubject: string;
const as = (u: TestUser, t = T) => api(ctx, t.host, u.token);
const inT = <R>(fn: () => Promise<R>, t = T) => runInTenant(t._id, fn);
const student = (i: number) => students[i] as TestUser;

const SETTINGS = {
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
  features: {
    chatbot: true,
    studentUploads: false,
    externalVideos: false,
    ocr: true,
    transcription: true,
    facultySeeChats: false,
  },
  killSwitch: false,
};
const save = (patch: Record<string, unknown> = {}) =>
  as(admin)
    .put('/admin/ai')
    .send({ ...SETTINGS, ...patch });

/** POST /study/chat, reading the server-sent events up to `done`. */
async function ask(u: TestUser, body: Record<string, unknown>): Promise<ChatMessageView | undefined> {
  const r = await as(u)
    .post('/study/chat')
    .send(body)
    .buffer(true)
    .parse((res, cb) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (d += c));
      res.on('end', () => cb(null, d));
    });
  expect(r.status).toBe(200);
  const done = String(r.body)
    .split('\n\n')
    .map((b) => b.split('\n').find((l) => l.startsWith('data: ')))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(6)) as ChatStreamEvent)
    .find((e) => e.type === 'done');
  return done?.type === 'done' ? done.message : undefined;
}

const notified = (u: TestUser, type: string) =>
  inT(() => NotificationModel.countDocuments({ userId: u.id, type }));

const LECTURE = [
  ['Regular languages', 'A regular language is accepted by some DFA. Every DFA has an equivalent NFA.'],
  [
    'Pumping lemma',
    'The pumping lemma for regular languages shows that a language is not regular. Demo example: balanced brackets.',
  ],
];

beforeAll(async () => {
  T = await makeTenant('studyinsights');
  U = await makeTenant('studyinsights2');
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  otherFaculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  otherAdmin = await makeUser(ctx, U, { roles: ['COLLEGE_ADMIN'], mfa: true });
  students = [];
  for (let i = 0; i < 8; i++) {
    const s = await makeUser(ctx, T, { roles: ['STUDENT'] });
    await inT(() => ProfileModel.updateOne({ userId: s.id }, { $set: { branch: 'CSE', gradYear: 2027 } }));
    students.push(s);
  }
  shared = (await makeSubject(ctx, T, faculty, { code: 'INS101' })).id;
  otherSubject = (
    await makeSubject(ctx, U, await makeUser(ctx, U, { roles: ['FACULTY'] }), { code: 'INS201' })
  ).id;
  const tree = await as(faculty)
    .put(`/study/subjects/${shared}/syllabus`)
    .send({
      units: [
        { title: 'Regular languages', topics: [{ title: 'Pumping lemma', keywords: ['pumping'] }] },
        { title: 'Grammars', topics: [{ title: 'Context-free grammars', keywords: ['grammars'] }] },
      ],
    });
  pumpingTopic = tree.body.data.units[0].topics[0].id;
  cfgTopic = tree.body.data.units[1].topics[0].id;
  expect((await save()).status).toBe(200);
  pdfId = (
    await as(faculty)
      .post('/study/materials')
      .field('subjectId', shared)
      .field('rights', 'true')
      .field('topicIds', pumpingTopic)
      .attach('file', await textPdf(LECTURE), 'lecture.pdf')
  ).body.data.id;
  await ctx.queue.drain();
});

describe('the monthly budget', () => {
  it('warns the admins at 80% and tells them at 100%, once each; then AI pauses and keyword search stays', async () => {
    expect((await save({ monthlyTokenBudget: 1000 })).status).toBe(200);
    await inT(() =>
      services.aiUsage.record({
        kind: 'embedding',
        model: 'mock:mock-embed-1',
        userId: null,
        inputTokens: 850,
      }),
    );
    expect((await as(student(0)).get('/study/ai-status')).body.data).toMatchObject({ answers: true });
    await as(student(1)).get('/study/ai-status');
    expect(await notified(admin, 'ai_budget_warning')).toBe(1);
    const warn = await inT(() =>
      NotificationModel.findOne({ userId: admin.id, type: 'ai_budget_warning' }).lean(),
    );
    expect(warn?.data).toEqual({ percent: '80' });
    expect(await notified(faculty, 'ai_budget_warning')).toBe(0);

    await inT(() =>
      services.aiUsage.record({ kind: 'chat', model: 'mock:mock-chat-1', userId: null, inputTokens: 200 }),
    );
    expect((await as(student(0)).get('/study/ai-status')).body.data).toEqual({
      answers: false,
      semantic: false,
      reason: 'budget_exhausted',
      demo: false,
    });
    await as(student(1)).get('/study/ai-status');
    expect(await notified(admin, 'ai_budget_reached')).toBe(1);
    expect(await notified(admin, 'ai_budget_warning')).toBe(1);

    // Answers become the matching passages (keyword search), and generative commands say why.
    const a = await ask(student(0), { question: 'What does the pumping lemma show?' });
    expect(a?.result).toEqual({ kind: 'passages', reason: 'budget_exhausted' });
    expect(a?.citations.length).toBeGreaterThan(0);
    const q = await ask(student(0), { command: 'quiz', question: 'pumping lemma' });
    expect(q?.result).toEqual({ kind: 'passages', reason: 'budget_exhausted' });
    const s = await as(student(0)).get('/study/search').query({ q: 'pumping lemma' });
    expect(s.status).toBe(200);
    expect(s.body.data.length).toBeGreaterThan(0);

    // Embedding waits for next month (a back-fill is scheduled for then).
    await inT(() => services.indexing.scheduleBackfill());
    await ctx.queue.drain();
    expect(
      ctx.queue.delayed.some(
        (j) =>
          j.name === EMBED_JOB &&
          String(j.data.tenantId) === String(T._id) &&
          j.dueAt >= nextMonth().getTime(),
      ),
    ).toBe(true);
  });

  it('a raised budget resumes answers and embedding, and warns again at the new 80%', async () => {
    const before = ctx.queue.delayed.length;
    expect((await save({ monthlyTokenBudget: 1_000_000 })).status).toBe(200);
    expect((await as(student(0)).get('/study/ai-status')).body.data).toMatchObject({
      answers: true,
      reason: null,
    });
    expect((await ask(student(0), { question: 'What does the pumping lemma show?' }))?.status).toBe(
      'complete',
    );
    // A back-fill runs now (not only next month).
    expect(ctx.queue.delayed.length).toBe(before);
    const usage = (await as(admin).get('/admin/ai/usage').query({ days: 7 })).body.data as AiUsageView;
    expect(usage.month).toMatchObject({ budget: 1_000_000, exhausted: false });
    expect(usage.month.used).toBeGreaterThanOrEqual(1050);
    expect(usage.month.percent).toBe(0);
    expect((await save()).status).toBe(200);
  });
});

describe('the per-member daily limit', () => {
  it('past it, my questions get the passages and generative commands say why; others are unaffected', async () => {
    expect((await save({ dailyMessagesPerUser: 1 })).status).toBe(200);
    expect((await ask(student(2), { question: 'What does the pumping lemma show?' }))?.status).toBe(
      'complete',
    );
    const again = await ask(student(2), { question: 'What does the pumping lemma show?' });
    expect(again?.result).toEqual({ kind: 'passages', reason: 'daily_limit' });
    expect(again?.citations.length).toBeGreaterThan(0);
    expect((await ask(student(2), { command: 'summary', question: 'pumping lemma' }))?.result).toEqual({
      kind: 'passages',
      reason: 'daily_limit',
    });
    // Retrieval commands keep working, and the limit is per member.
    expect((await ask(student(2), { command: 'notes', question: 'pumping lemma' }))?.result?.kind).toBe(
      'notes',
    );
    expect((await ask(student(3), { question: 'What does the pumping lemma show?' }))?.status).toBe(
      'complete',
    );
    expect((await save()).status).toBe(200);
  });
});

describe('faculty insights (aggregates only)', () => {
  it('count topics, gaps, material and units without any question text or member', async () => {
    // Six students ask about the pumping lemma; one rates the answer.
    for (let i = 0; i < 6; i++) {
      const a = await ask(student(i), {
        subjectId: shared,
        question: `What does the pumping lemma show? (demo ${i})`,
      });
      if (i === 0 && a)
        await as(student(0))
          .post(`/study/chat/messages/${a.id}/feedback`)
          .send({ rating: 'down', reason: 'unclear' });
      await as(student(i)).get(`/study/materials/${pdfId}`);
    }
    // Five ask about something no material or topic covers; their own extra words stay hidden.
    for (let i = 0; i < 5; i++)
      await ask(student(i), { subjectId: shared, question: `Explain photosynthesis zqword${i}` });
    // Two ask about a syllabus topic with no material.
    for (let i = 0; i < 2; i++)
      await ask(student(i), { subjectId: shared, question: 'What are context-free grammars?' });
    // Staff previews are not counted as views.
    await as(faculty).get(`/study/materials/${pdfId}`);

    const r = await as(faculty).get(`/study/subjects/${shared}/insights`).query({ days: 30 });
    expect(r.status).toBe(200);
    const v = r.body.data as StudyInsightsView;
    expect(v.days).toBe(30);
    expect(v.students).toBe(6);
    expect(typeof v.questions).toBe('number');
    expect(v.topics[0]).toMatchObject({
      topicId: pumpingTopic,
      title: 'Pumping lemma',
      unitTitle: 'Regular languages',
    });
    expect(v.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topicId: cfgTopic, title: 'Context-free grammars', questions: '<5' }),
        expect.objectContaining({ topicId: null, title: 'photosynthesis', students: 5 }),
      ]),
    );
    const pdf = v.materials.find((m) => m.id === pdfId);
    expect(pdf).toMatchObject({ title: 'lecture', type: 'pdf', views: 6 });
    expect(typeof pdf?.cited).toBe('number');
    expect(v.units.find((u) => u.title === 'Regular languages')).toMatchObject({ students: 6, views: 6 });
    expect(v.units.find((u) => u.title === 'Grammars')).toMatchObject({ students: '<5' });
    // Fewer than five ratings: counts suppressed and no rate.
    expect(v.feedback).toMatchObject({ down: '<5', helpfulRate: null });
    // Nothing a member wrote or who they are.
    const text = JSON.stringify(v);
    expect(text).not.toMatch(/zqword|demo \d|What does/);
    for (const s of students) expect(text).not.toContain(s.id);
  });

  it('only owners and admins see them; a subject elsewhere is not found', async () => {
    expect((await as(admin).get(`/study/subjects/${shared}/insights`)).status).toBe(200);
    expect((await as(otherFaculty).get(`/study/subjects/${shared}/insights`)).status).toBe(403);
    expect((await as(student(0)).get(`/study/subjects/${shared}/insights`)).status).toBe(403);
    expect((await as(admin).get(`/study/subjects/${otherSubject}/insights`)).status).toBe(404);
    expect((await as(otherAdmin, U).get(`/study/subjects/${shared}/insights`)).status).toBe(404);
    expect((await as(faculty).get(`/study/subjects/${shared}/insights`).query({ days: 13 })).status).toBe(
      400,
    );
  });
});

describe('the admin AI dashboard', () => {
  it('shows college usage per day and model, costs from entered prices, failures, queue and coverage', async () => {
    expect(
      (await save({ prices: { currency: 'INR', chatInput: 10, chatOutput: 30, embedding: 1 } })).status,
    ).toBe(200);
    const r = await as(admin).get('/admin/ai/usage').query({ days: 7 });
    expect(r.status).toBe(200);
    const v = r.body.data as AiUsageView;
    expect(v.series).toHaveLength(7);
    expect(v.series.at(-1)?.chat).toBeGreaterThan(0);
    expect(v.models.find((m) => m.model === 'mock:mock-chat-1')).toMatchObject({ kind: 'chat', cost: 0 });
    expect(v.cost).toMatchObject({ currency: 'INR', priced: true });
    expect(v.coverage.find((c) => c.subjectId === shared)).toMatchObject({
      code: 'INS101',
      materials: 1,
      indexed: 1,
      processing: 0,
      failed: 0,
    });
    const c = v.coverage.find((x) => x.subjectId === shared);
    expect(c?.embedded).toBe(c?.passages);
    expect(v.queue).toMatchObject({ processing: 0, failed: 0, embeddingsPending: 0 });
    expect(v.breaker.open).toBe(false);
    // College totals only: no member appears.
    for (const s of students) expect(JSON.stringify(v)).not.toContain(s.id);
    expect((await as(faculty).get('/admin/ai/usage')).status).toBe(403);
    expect((await as(otherAdmin, U).get('/admin/ai/usage')).body.data.coverage).toEqual([
      expect.objectContaining({ subjectId: otherSubject }),
    ]);
    const settings = (await as(admin).get('/admin/ai')).body.data;
    expect(settings.prices).toEqual({ currency: 'INR', chatInput: 10, chatOutput: 30, embedding: 1 });
  });

  it('prices turn tokens into an estimate; the demo is free and transcription is not estimated', () => {
    const p = { currency: 'USD' as const, chatInput: 3, chatOutput: 15, embedding: 0.02 };
    expect(
      costOf({ model: 'openai:x', kind: 'chat', inputTokens: 1_000_000, outputTokens: 200_000 }, p),
    ).toBe(6);
    expect(costOf({ model: 'openai:e', kind: 'embedding', inputTokens: 500_000, outputTokens: 0 }, p)).toBe(
      0.01,
    );
    expect(costOf({ model: 'mock:mock-chat-1', kind: 'chat', inputTokens: 9, outputTokens: 9 }, p)).toBe(0);
    expect(
      costOf({ model: 'openai:w', kind: 'transcription', inputTokens: 9, outputTokens: 0 }, p),
    ).toBeNull();
    expect(
      costOf(
        { model: 'openai:x', kind: 'chat', inputTokens: 1, outputTokens: 1 },
        { ...p, chatOutput: null },
      ),
    ).toBeNull();
  });
});

describe('provider failures (an external provider)', () => {
  beforeAll(async () => {
    expect((await save({ chatProvider: 'openai', chatModel: 'chat-demo' })).status).toBe(200);
    expect((await as(admin).put('/admin/ai/keys').send({ target: 'chat', key: OPENAI_KEY })).status).toBe(
      200,
    );
    expect(
      (await as(admin).post('/admin/ai/consent').send({ version: AI_CONSENT_VERSION, accept: true })).status,
    ).toBe(200);
    expect((await as(student(6)).get('/study/ai-status')).body.data).toMatchObject({
      answers: true,
      demo: false,
    });
  });

  it('an outage before any text is retried once', async () => {
    const before = fake.state.chatRequests;
    fake.state.chatFailures = 1;
    const a = await ask(student(6), { question: 'What does the pumping lemma show?' });
    expect(a).toMatchObject({ status: 'complete', grounded: true });
    expect(a?.text).toMatch(/^Demo answer/);
    expect(fake.state.chatRequests - before).toBe(2);
  });

  it('a second failure gives the passages, and the admin sees the failure', async () => {
    fake.state.chatFailures = 2;
    const a = await ask(student(6), { question: 'What does the pumping lemma show?' });
    expect(a).toMatchObject({ status: 'failed', result: { kind: 'passages', reason: null } });
    expect(a?.citations.length).toBeGreaterThan(0);
    const v = (await as(admin).get('/admin/ai/usage')).body.data as AiUsageView;
    expect(v.lastError?.message).toMatch(/unavailable/);
    expect(v.lastError?.message).not.toContain(OPENAI_KEY);
    expect(v.answers.failed).toBe('<5');
  });

  it('a key the provider rejects while answering is marked invalid and the admins are told once', async () => {
    fake.state.chatRevoked = true;
    const a = await ask(student(6), { question: 'What does the pumping lemma show?' });
    expect(a).toMatchObject({ status: 'failed', result: { kind: 'passages' } });
    expect((await as(admin).get('/admin/ai')).body.data.keys.chat.status).toBe('invalid');
    expect(await notified(admin, 'ai_key_invalid')).toBe(1);
    const calls = fake.state.chatRequests;
    const b = await ask(student(7), { question: 'What does the pumping lemma show?' });
    expect(b?.result).toEqual({ kind: 'passages', reason: 'key_invalid' });
    expect(fake.state.chatRequests).toBe(calls);
    expect(await notified(admin, 'ai_key_invalid')).toBe(1);
    fake.state.chatRevoked = false;
    expect((await as(admin).post('/admin/ai/test').send({ target: 'chat' })).body.data.ok).toBe(true);
  });

  it('after repeated outages answers pause (no provider calls) and the dashboard says so', async () => {
    // Start from a success, then keep failing.
    expect((await ask(student(7), { question: 'What does the pumping lemma show?' }))?.status).toBe(
      'complete',
    );
    fake.state.chatDown = true;
    for (let i = 0; i < BREAKER_THRESHOLD; i++)
      expect((await ask(student(7), { question: 'What does the pumping lemma show?' }))?.status).toBe(
        'failed',
      );
    const calls = fake.state.chatRequests;
    const a = await ask(student(7), { question: 'What does the pumping lemma show?' });
    expect(a).toMatchObject({ status: 'failed', result: { kind: 'passages' } });
    expect(fake.state.chatRequests).toBe(calls);
    const v = (await as(admin).get('/admin/ai/usage')).body.data as AiUsageView;
    expect(v.breaker.open).toBe(true);
    expect(new Date(v.breaker.until ?? 0).getTime()).toBeGreaterThan(Date.now());
    fake.state.chatDown = false;
    // Other colleges are unaffected (the pause is per college and endpoint).
    expect((await as(otherAdmin, U).get('/admin/ai/usage')).body.data.breaker.open).toBe(false);
  });
});

describe('the circuit breaker and retry', () => {
  const outage = new ProviderError('unavailable', 'The provider is unavailable right now');

  it('opens after repeated outages, lets one call through after a minute, and ignores key errors', () => {
    let now = 1_000;
    const b = new CircuitBreaker(() => now);
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) b.failure('k', outage);
    expect(b.openUntil('k')).toBeNull();
    b.failure('k', new ProviderError('auth', 'The provider rejected the key'));
    b.failure('k', new Error('a bug'));
    expect(b.openUntil('k')).toBeNull();
    b.failure('k', outage);
    expect(b.openUntil('k')).toBe(1_000 + BREAKER_OPEN_MS);
    expect(() => b.check('k')).toThrow(ProviderError);
    expect(() => b.check('other')).not.toThrow();
    now += BREAKER_OPEN_MS;
    expect(() => b.check('k')).not.toThrow();
    // Half-open: one more failure pauses again; a success closes it.
    b.failure('k', outage);
    expect(b.openUntil('k')).not.toBeNull();
    now += BREAKER_OPEN_MS;
    b.success('k');
    b.failure('k', outage);
    expect(b.openUntil('k')).toBeNull();
  });

  it('retries once before any text was streamed, never after, and never when the member stopped', async () => {
    const run = async (plan: ('fail' | 'stream-fail' | 'ok')[], signal?: AbortSignal) => {
      let calls = 0;
      const p: LLMProvider = {
        id: 'openai',
        listModels: async () => [],
        async generate(_req, opts) {
          const step = plan[calls++];
          if (step === 'stream-fail') {
            opts?.onText?.('partial ');
            throw outage;
          }
          if (step === 'fail') throw outage;
          opts?.onText?.('ok');
          return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' };
        },
      };
      const g = guardedChat(p, { breaker: new CircuitBreaker(), key: 'k', sleep: async () => undefined });
      const req = { model: 'm', system: '', messages: [], maxTokens: 10, temperature: null };
      const result = await g
        .generate(req, { onText: () => undefined, ...(signal ? { signal } : {}) })
        .catch((e: unknown) => e);
      return { calls, result };
    };
    expect(await run(['fail', 'ok'])).toMatchObject({ calls: 2, result: { text: 'ok' } });
    expect(await run(['fail', 'fail', 'ok'])).toMatchObject({ calls: 2, result: outage });
    expect(await run(['stream-fail', 'ok'])).toMatchObject({ calls: 1, result: outage });
    const stopped = new AbortController();
    stopped.abort();
    expect(await run(['fail', 'ok'], stopped.signal)).toMatchObject({ calls: 1, result: outage });
  });
});
