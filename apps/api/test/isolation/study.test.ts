/**
 * MANDATORY tenant-isolation suite for Phase 9 (Study, step 1): subjects, syllabus units and topics,
 * enrollment overrides and AI settings. Every cross-tenant read, write, update, delete and search
 * must fail. Blocks CI.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Model } from 'mongoose';
import { AI_CONSENT_VERSION } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from '../helpers.js';
import { aiFetcher, GOOD_KEY, makeSubject } from '../study-fixtures.js';
import { runInTenant } from '../../src/lib/context.js';
import { ProfileModel } from '../../src/modules/profiles/profile.model.js';
import {
  SubjectEnrollmentModel,
  SubjectModel,
  SyllabusTopicModel,
  SyllabusUnitModel,
} from '../../src/modules/study/subject.model.js';
import { AiSettingsModel } from '../../src/modules/study/ai-settings.model.js';
import { AiUsageModel } from '../../src/modules/study/ai-usage.model.js';
import {
  ChatMessageModel,
  ChatSessionModel,
  FlashcardDeckModel,
  UnansweredQuestionModel,
} from '../../src/modules/study/chat.model.js';
import {
  ContentChunkModel,
  MaterialJobModel,
  MaterialModel,
  MaterialPageModel,
  MaterialViewStatModel,
  VideoSegmentModel,
} from '../../src/modules/study/material.model.js';
import { withTextSearch } from '../../src/db/search.js';
import request from 'supertest';
import { DEMO_VTT, fakeMedia, fakeOcr, textPdf } from '../study-fixtures.js';
import { fakeMp4 } from '../feed-fixtures.js';

const ctx = testApp({ fetcher: aiFetcher().fn, media: fakeMedia(), ocr: fakeOcr(), whisper: null });
let materialA: string, videoA: string, fileLinkA: string;
let A: TestTenant, B: TestTenant;
let facA: TestUser, adminA: TestUser, studentA: TestUser;
let facB: TestUser, adminB: TestUser, studentB: TestUser, alumB: TestUser;
let subjectA: string, unitA: string, sessionA: string;
const a = (u: TestUser) => api(ctx, A.host, u.token);
const inB = (u: TestUser) => api(ctx, B.host, u.token);

const SETTINGS = {
  chatProvider: 'anthropic',
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
  chatRetentionDays: 180,
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

beforeAll(async () => {
  A = await makeTenant('isostudya');
  B = await makeTenant('isostudyb');
  facA = await makeUser(ctx, A, { roles: ['FACULTY'] });
  adminA = await makeUser(ctx, A, { roles: ['COLLEGE_ADMIN'], mfa: true });
  studentA = await makeUser(ctx, A, { roles: ['STUDENT'] });
  facB = await makeUser(ctx, B, { roles: ['FACULTY'] });
  adminB = await makeUser(ctx, B, { roles: ['COLLEGE_ADMIN'], mfa: true });
  studentB = await makeUser(ctx, B, { roles: ['STUDENT'] });
  alumB = await makeUser(ctx, B, { roles: ['ALUMNI'] });
  for (const [t, u] of [
    [A, studentA],
    [B, studentB],
  ] as const)
    await runInTenant(t._id, () =>
      ProfileModel.updateOne({ userId: u.id }, { $set: { branch: 'CSE', gradYear: 2027 } }),
    );
  subjectA = (await makeSubject(ctx, A, facA, { name: 'Alpha Zyxquark Automata', code: 'ZYX1' })).id;
  const tree = await a(facA)
    .put(`/study/subjects/${subjectA}/syllabus`)
    .send({ units: [{ title: 'Alpha unit', topics: [{ title: 'Alpha topic' }] }] });
  unitA = tree.body.data.units[0].id;
  await a(facA).put(`/study/subjects/${subjectA}/enrollments`).send({ userId: studentA.id, kind: 'include' });
  await a(adminA).put('/admin/ai').send(SETTINGS);
  await a(adminA).put('/admin/ai/keys').send({ target: 'chat', key: GOOD_KEY });
  await a(adminA).post('/admin/ai/consent').send({ version: AI_CONSENT_VERSION, accept: true });
  const up = (file: Buffer, name: string) =>
    a(facA)
      .post('/study/materials')
      .field('subjectId', subjectA)
      .field('rights', 'true')
      .attach('file', file, name);
  materialA = (
    await up(await textPdf([['Alpha Zyxquark lecture', 'Zyxquark automata are a demo idea.']]), 'alpha.pdf')
  ).body.data.id;
  videoA = (await up(fakeMp4(30), 'alpha.mp4')).body.data.id;
  await a(facA).post(`/study/materials/${videoA}/transcript`).attach('file', Buffer.from(DEMO_VTT), 'a.vtt');
  await ctx.queue.drain();
  fileLinkA = (await a(studentA).get(`/study/materials/${materialA}/file`)).body.data.url;
  // An anonymous view count for A's insights.
  expect((await a(studentA).get(`/study/materials/${materialA}`)).status).toBe(200);
  // B has its own subject so empty results are meaningful.
  await makeSubject(ctx, B, facB, { name: 'Beta Automata', code: 'ZYX1' });
  // A's student talks to the assistant (its provider is unreachable here, so the passages answer),
  // keeps a deck and leaves a gap.
  const asked = await a(studentA)
    .post('/study/chat')
    .send({ question: 'What are Zyxquark automata?' })
    .buffer(true)
    .parse((res, cb) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (d += c));
      res.on('end', () => cb(null, d));
    });
  const start = String(asked.body)
    .split('\n\n')
    .map((b) => b.split('\n').find((l) => l.startsWith('data: ')))
    .filter(Boolean)
    .map((l) => JSON.parse(String(l).slice(6)) as { type: string; sessionId?: string })
    .find((e) => e.type === 'start');
  sessionA = start?.sessionId ?? '';
  await runInTenant(A._id, async () => {
    await FlashcardDeckModel.create({
      userId: studentA.id,
      title: 'Alpha deck',
      cards: [{ front: 'a', back: 'b' }],
    });
    await UnansweredQuestionModel.create({ userId: studentA.id, subjectId: subjectA, text: 'Zyxquark gap' });
  });
});

describe('HTTP: nothing of college A is reachable from college B', () => {
  it('subjects, syllabus, overrides and contributors', async () => {
    for (const [u, m, p, body] of [
      [studentB, 'get', `/study/subjects/${subjectA}`, undefined],
      [studentB, 'get', `/study/subjects/${subjectA}/syllabus`, undefined],
      [facB, 'patch', `/study/subjects/${subjectA}`, { name: 'Taken over' }],
      [
        facB,
        'put',
        `/study/subjects/${subjectA}/syllabus`,
        { units: [{ id: unitA, title: 'x', topics: [] }] },
      ],
      [facB, 'get', `/study/subjects/${subjectA}/enrollments`, undefined],
      [facB, 'put', `/study/subjects/${subjectA}/enrollments`, { userId: studentB.id, kind: 'include' }],
      [facB, 'delete', `/study/subjects/${subjectA}/enrollments/${studentA.id}`, undefined],
      [adminB, 'put', `/study/subjects/${subjectA}/contributors`, { userId: alumB.id, grant: true }],
    ] as const) {
      const c = inB(u);
      const res =
        m === 'get'
          ? await c.get(p)
          : m === 'delete'
            ? await c.delete(p)
            : m === 'put'
              ? await c.put(p).send(body)
              : await c.patch(p).send(body);
      expect(res.status, `${m} ${p}`).toBe(404);
    }
    for (const u of [studentB, facB, alumB]) {
      const list = JSON.stringify((await inB(u).get('/study/subjects?scope=all')).body.data);
      expect(list).not.toContain(subjectA);
      expect(list).not.toContain('Alpha');
      expect((await inB(u).get('/study/subjects?scope=all&q=Zyxquark')).body.data).toEqual([]);
    }
    expect((await a(facA).get(`/study/subjects/${subjectA}/syllabus`)).body.data.units[0].title).toBe(
      'Alpha unit',
    );
  });

  it('material, files, transcripts and search', async () => {
    for (const [u, m, p, body] of [
      [studentB, 'get', `/study/materials/${materialA}`, undefined],
      [studentB, 'get', `/study/materials/${materialA}/file`, undefined],
      [studentB, 'get', `/study/subjects/${subjectA}/materials`, undefined],
      [facB, 'patch', `/study/materials/${materialA}`, { title: 'Taken over' }],
      [facB, 'delete', `/study/materials/${materialA}`, undefined],
      [facB, 'post', `/study/materials/${materialA}/reprocess`, {}],
      [facB, 'post', `/study/materials/${materialA}/review`, { action: 'publish' }],
      [facB, 'post', `/study/materials/${materialA}/takedown`, { reason: 'Cross-college attempt' }],
    ] as const) {
      const c = inB(u);
      const res =
        m === 'get'
          ? await c.get(p)
          : m === 'delete'
            ? await c.delete(p)
            : m === 'patch'
              ? await c.patch(p).send(body)
              : await c.post(p).send(body);
      expect(res.status, `${m} ${p}`).toBe(404);
    }
    expect(
      (
        await inB(facB)
          .post(`/study/materials/${videoA}/transcript`)
          .attach('file', Buffer.from(DEMO_VTT), 'b.vtt')
      ).status,
    ).toBe(404);
    expect(
      (
        await inB(facB)
          .post('/study/materials')
          .field('subjectId', subjectA)
          .field('rights', 'true')
          .attach('file', Buffer.from('Demo'), 'x.txt')
      ).status,
    ).toBe(404);
    for (const u of [studentB, facB])
      expect((await inB(u).get('/study/search?q=Zyxquark')).body.data).toEqual([]);
    expect((await a(studentA).get('/study/search?q=Zyxquark')).body.data[0].materialId).toBe(materialA);
    // A signed link minted in A is useless on B's address, and so is the file id.
    const anon = request(ctx.app);
    expect((await anon.get(fileLinkA).set('Host', A.host)).status).toBe(200);
    expect((await anon.get(fileLinkA).set('Host', B.host)).status).toBe(404);
    const fileId = String((await runInTenant(A._id, () => MaterialModel.findById(materialA).lean()))?.fileId);
    expect((await inB(studentB).get(`/files/${fileId}`)).status).toBe(404);
    expect((await inB(studentB).get(`/files/${fileId}/signed`)).status).toBe(404);
  });

  it('AI settings, keys and status are per college', async () => {
    const b = (await inB(adminB).get('/admin/ai')).body.data;
    expect(b).toMatchObject({
      chatProvider: null,
      consent: null,
      keys: { chat: { status: 'not_set', last4: null } },
    });
    expect((await inB(studentB).get('/study/ai-status')).body.data).toMatchObject({ answers: false });
    expect((await a(studentA).get('/study/ai-status')).body.data).toMatchObject({ answers: true });
    expect((await inB(adminB).post('/admin/ai/test').send({ target: 'chat' })).body.data.ok).toBe(false);
    await inB(adminB).delete('/admin/ai/keys/chat');
    expect((await a(adminA).get('/admin/ai')).body.data.keys.chat.status).toBe('valid');
  });

  it('the semantic index and its progress are per college', async () => {
    const idxA = (await a(adminA).get('/admin/ai/index')).body.data;
    expect(idxA).toMatchObject({ semantic: true, model: 'mock:mock-embed-1', pending: 0 });
    expect(idxA.embedded).toBeGreaterThan(0);
    const idxB = (await inB(adminB).get('/admin/ai/index')).body.data;
    expect(idxB).toMatchObject({ total: 0, embedded: 0 });
    // B turns on the same demo embeddings: its search by meaning still never reaches A's vectors.
    await inB(adminB)
      .put('/admin/ai')
      .send({ ...SETTINGS, chatProvider: null, embeddingProvider: 'mock' });
    expect((await inB(adminB).get('/admin/ai/index')).body.data.semantic).toBe(true);
    const hits = (await inB(studentB).get('/study/search?q=Zyxquark automata demo idea')).body.data;
    expect(hits).toEqual([]);
  });

  it('conversations, decks and the assistant never cross colleges', async () => {
    expect(sessionA).toMatch(/^[a-f0-9]{24}$/);
    expect((await inB(studentB).get(`/study/chat/sessions/${sessionA}`)).status).toBe(404);
    expect((await inB(studentB).delete(`/study/chat/sessions/${sessionA}`)).status).toBe(404);
    expect((await inB(studentB).get('/study/chat/sessions')).body.data).toEqual([]);
    expect((await inB(studentB).get('/study/decks')).body.data).toEqual([]);
    // B's assistant never cites A's material, even with A's own words.
    const r = await inB(studentB)
      .post('/study/chat')
      .send({ question: 'What are Zyxquark automata? Zyxquark demo idea' })
      .buffer(true)
      .parse((res, cb) => {
        let d = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (d += c));
        res.on('end', () => cb(null, d));
      });
    expect(String(r.body)).not.toContain(materialA);
    expect(String(r.body)).not.toMatch(/Zyxquark automata are/);
  });

  it('subject insights and the AI dashboard are per college', async () => {
    expect((await a(facA).get(`/study/subjects/${subjectA}/insights`)).status).toBe(200);
    expect((await inB(adminB).get(`/study/subjects/${subjectA}/insights`)).status).toBe(404);
    expect((await inB(facB).get(`/study/subjects/${subjectA}/insights`)).status).toBe(404);
    const usageA = (await a(adminA).get('/admin/ai/usage')).body.data;
    expect(usageA.coverage.map((c: { subjectId: string }) => c.subjectId)).toContain(subjectA);
    const usageB = (await inB(adminB).get('/admin/ai/usage')).body.data;
    expect(JSON.stringify(usageB)).not.toContain(subjectA);
    expect(JSON.stringify(usageB)).not.toContain('Zyxquark');
    // B's month counts B's own usage (its demo searches) only.
    const own = await runInTenant(B._id, async () =>
      (await AiUsageModel.find().lean()).reduce((n, r) => n + r.inputTokens + r.outputTokens, 0),
    );
    expect(usageB.month.used).toBe(own);
    expect(usageA.month.used).toBeGreaterThan(own);
  });

  it('a token from A never works on B', async () => {
    const r = await api(ctx, B.host, studentA.token).get('/study/subjects');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });
});

describe('database layer: every Phase 9 collection is scoped', () => {
  const MODELS: [string, Model<unknown>][] = [
    ['Subject', SubjectModel as Model<unknown>],
    ['SyllabusUnit', SyllabusUnitModel as Model<unknown>],
    ['SyllabusTopic', SyllabusTopicModel as Model<unknown>],
    ['SubjectEnrollment', SubjectEnrollmentModel as Model<unknown>],
    ['AiSettings', AiSettingsModel as Model<unknown>],
    ['Material', MaterialModel as Model<unknown>],
    ['MaterialJob', MaterialJobModel as Model<unknown>],
    ['MaterialPage', MaterialPageModel as Model<unknown>],
    ['ContentChunk', ContentChunkModel as Model<unknown>],
    ['VideoSegment', VideoSegmentModel as Model<unknown>],
    ['AiUsage', AiUsageModel as Model<unknown>],
    ['ChatSession', ChatSessionModel as Model<unknown>],
    ['ChatMessage', ChatMessageModel as Model<unknown>],
    ['UnansweredQuestion', UnansweredQuestionModel as Model<unknown>],
    ['FlashcardDeck', FlashcardDeckModel as Model<unknown>],
    ['MaterialViewStat', MaterialViewStatModel as Model<unknown>],
  ];

  it.each(MODELS)('%s: B cannot read, search, update or delete A’s documents', async (_name, model) => {
    const docA = await runInTenant(A._id, () => model.findOne({}).select('_id').lean<{ _id: unknown }>());
    expect(docA, 'fixture created a document in A').toBeTruthy();
    const id = docA?._id;
    await runInTenant(B._id, async () => {
      expect(await model.findById(id).lean()).toBeNull();
      expect(await model.countDocuments({ _id: id })).toBe(0);
      expect((await model.updateOne({ _id: id }, { $set: { updatedAt: new Date(0) } })).matchedCount).toBe(0);
      await model.updateMany({}, { $set: { updatedAt: new Date(0) } });
      expect((await model.deleteOne({ _id: id })).deletedCount).toBe(0);
    });
    await runInTenant(A._id, async () => {
      const still = await model.findById(id).lean<{ updatedAt?: Date }>();
      expect(still?.updatedAt?.getTime()).not.toBe(0);
    });
  });

  it('Subject and passage search stay in the tenant', async () => {
    await runInTenant(B._id, async () => {
      expect(await withTextSearch(SubjectModel.find(), 'Zyxquark').lean()).toEqual([]);
      expect(await withTextSearch(ContentChunkModel.find(), 'Zyxquark').lean()).toEqual([]);
    });
    await runInTenant(A._id, async () => {
      expect((await withTextSearch(ContentChunkModel.find(), 'Zyxquark').lean()).length).toBeGreaterThan(0);
    });
  });
});
