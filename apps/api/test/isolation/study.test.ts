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
import { withTextSearch } from '../../src/db/search.js';

const ctx = testApp({ fetcher: aiFetcher().fn });
let A: TestTenant, B: TestTenant;
let facA: TestUser, adminA: TestUser, studentA: TestUser;
let facB: TestUser, adminB: TestUser, studentB: TestUser, alumB: TestUser;
let subjectA: string, unitA: string;
const a = (u: TestUser) => api(ctx, A.host, u.token);
const inB = (u: TestUser) => api(ctx, B.host, u.token);

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
  const base = {
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
  await a(adminA).put('/admin/ai').send(base);
  await a(adminA).put('/admin/ai/keys').send({ target: 'chat', key: GOOD_KEY });
  await a(adminA).post('/admin/ai/consent').send({ version: AI_CONSENT_VERSION, accept: true });
  // B has its own subject so empty results are meaningful.
  await makeSubject(ctx, B, facB, { name: 'Beta Automata', code: 'ZYX1' });
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

  it('Subject search stays in the tenant', async () => {
    await runInTenant(B._id, async () => {
      const hits = await withTextSearch(SubjectModel.find(), 'Zyxquark').lean();
      expect(hits).toEqual([]);
    });
  });
});
