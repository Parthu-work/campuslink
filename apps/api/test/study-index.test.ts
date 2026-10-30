import { beforeAll, describe, expect, it } from 'vitest';
import { AI_CONSENT_VERSION } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import { aiFetcher, makeSubject, OPENAI_KEY, textPdf } from './study-fixtures.js';
import { mockVector } from '../src/modules/study/ai/mock.js';
import { runInTenant } from '../src/lib/context.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { ContentChunkModel } from '../src/modules/study/material.model.js';
import { AiUsageModel } from '../src/modules/study/ai-usage.model.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { EMBED_JOB, type IndexingService } from '../src/modules/study/indexing.service.js';
import type { MemoryVectorStore, VectorIndex } from '../src/modules/study/vector/store.js';

const fake = aiFetcher();
const ctx = testApp({ fetcher: fake.fn });
const services = ctx.app.locals.services as { indexing: IndexingService; vectors: VectorIndex };
services.indexing.sleep = async () => undefined;
const store = services.vectors.store as MemoryVectorStore;

let T: TestTenant, U: TestTenant;
let faculty: TestUser,
  admin: TestUser,
  cse: TestUser,
  ece: TestUser,
  otherFaculty: TestUser,
  otherAdmin: TestUser;
let shared: string, cseOnly: string, eceOnly: string, otherSubject: string;
const as = (u: TestUser, t = T) => api(ctx, t.host, u.token);
const inT = <R>(fn: () => Promise<R>, t = T) => runInTenant(t._id, fn);
const settle = () => ctx.queue.drain();
const MODEL = 'openai:text-embedding-demo';

function upload(u: TestUser, subjectId: string, file: Buffer, name: string, t = T) {
  return as(u, t)
    .post('/study/materials')
    .field('subjectId', subjectId)
    .field('rights', 'true')
    .attach('file', file, name);
}

const settings = (patch: Record<string, unknown> = {}) => ({
  chatProvider: null,
  chatModel: '',
  embeddingProvider: null,
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
  },
  killSwitch: false,
  ...patch,
});

/** Admin: OpenAI embeddings with the demo key, consent accepted (the key save starts the back-fill). */
async function turnOnEmbeddings(a: TestUser, t: TestTenant, model = 'text-embedding-demo') {
  expect(
    (
      await as(a, t)
        .put('/admin/ai')
        .send(settings({ embeddingProvider: 'openai', embeddingModel: model }))
    ).status,
  ).toBe(200);
  expect(
    (await as(a, t).post('/admin/ai/consent').send({ version: AI_CONSENT_VERSION, accept: true })).status,
  ).toBe(200);
  const k = await as(a, t).put('/admin/ai/keys').send({ target: 'embedding', key: OPENAI_KEY });
  expect(k.body.data.result).toMatchObject({ ok: true });
  await settle();
}

const search = async (u: TestUser, q: string, subjectId?: string) => {
  const r = await as(u)
    .get('/study/search')
    .query({ q, ...(subjectId ? { subjectId } : {}) });
  return r;
};
const chunks = (filter: Record<string, unknown> = {}, t = T) =>
  inT(
    () =>
      ContentChunkModel.find(filter)
        .select('+vector materialId subjectId embeddingStatus embeddingModel topicIds')
        .lean(),
    t,
  );

const PUMPING = [
  ['Pumping lemma', 'The pumping lemma for regular languages shows a language is not regular.'],
  ['Demo example', 'Demo: the language of balanced brackets is not regular, by the pumping lemma.'],
];
const GRAMMARS = [['Grammars', 'A context-free grammar has productions and a start symbol (demo text).']];

beforeAll(async () => {
  T = await makeTenant('studyidx');
  U = await makeTenant('studyidx2');
  faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
  admin = await makeUser(ctx, T, { roles: ['COLLEGE_ADMIN'], mfa: true });
  cse = await makeUser(ctx, T, { roles: ['STUDENT'] });
  ece = await makeUser(ctx, T, { roles: ['STUDENT'] });
  otherFaculty = await makeUser(ctx, U, { roles: ['FACULTY'] });
  otherAdmin = await makeUser(ctx, U, { roles: ['COLLEGE_ADMIN'], mfa: true });
  await inT(() => ProfileModel.updateOne({ userId: cse.id }, { $set: { branch: 'CSE', gradYear: 2027 } }));
  await inT(() => ProfileModel.updateOne({ userId: ece.id }, { $set: { branch: 'ECE', gradYear: 2027 } }));
  shared = (await makeSubject(ctx, T, faculty, { code: 'IDX101' })).id;
  cseOnly = (await makeSubject(ctx, T, faculty, { code: 'IDX102', branches: ['CSE'] })).id;
  eceOnly = (await makeSubject(ctx, T, faculty, { code: 'IDX103', branches: ['ECE'] })).id;
  otherSubject = (await makeSubject(ctx, U, otherFaculty, { code: 'IDX201' })).id;
});

describe('without an embedding provider', () => {
  it('passages wait for vectors and search is keyword-only', async () => {
    expect((await upload(faculty, shared, await textPdf(PUMPING), 'pumping.pdf')).status).toBe(201);
    await settle();
    const rows = await chunks();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((c) => c.embeddingStatus === 'embedding_pending' && !c.vector)).toBe(true);
    const r = await search(cse, 'pumping lemma');
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.every((h: { match: string }) => h.match === 'keyword')).toBe(true);
    const idx = (await as(admin).get('/admin/ai/index')).body.data;
    expect(idx).toMatchObject({ semantic: false, model: null, store: 'memory', embedded: 0, running: false });
    expect(idx.pending).toBe(idx.total);
  });
});

describe('back-fill, hybrid search and re-indexing', () => {
  it('saving a working key back-fills every passage; search becomes hybrid', async () => {
    const before = fake.state.embedRequests;
    await turnOnEmbeddings(admin, T);
    expect(fake.state.embedRequests).toBeGreaterThan(before);
    const rows = await chunks();
    expect(rows.every((c) => c.embeddingStatus === 'embedded' && c.embeddingModel === MODEL)).toBe(true);
    expect(await inT(() => services.vectors.count(MODEL))).toBe(rows.length);
    const idx = (await as(admin).get('/admin/ai/index')).body.data;
    expect(idx).toMatchObject({ semantic: true, model: MODEL, pending: 0, failed: 0, embedded: rows.length });
    // Embedding tokens are counted for the college (no member: background work).
    const usage = await inT(() => AiUsageModel.find({ kind: 'embedding', userId: null }).lean());
    expect(usage[0]).toMatchObject({ model: MODEL });
    expect(usage[0]?.inputTokens).toBeGreaterThan(0);

    const hits = (await search(cse, 'pumping lemma regular')).body.data as { match: string; page: number }[];
    expect(hits.some((h) => h.match === 'both')).toBe(true);
    // A search by meaning is the member's own usage.
    expect(await inT(() => AiUsageModel.countDocuments({ kind: 'embedding', userId: cse.id }))).toBe(1);
  });

  it('new material is embedded as it is processed', async () => {
    const r = await upload(faculty, shared, await textPdf(GRAMMARS), 'grammars.pdf');
    await settle();
    const rows = await chunks({ materialId: r.body.data.id });
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ embeddingStatus: 'embedded', embeddingModel: MODEL });
  });

  it('a lost index comes back from the stored vectors, without calling the provider', async () => {
    const calls = fake.state.embedRequests;
    store.clear(); // a restart, or an index that was wiped
    const hits = (await search(cse, 'context-free grammar productions')).body.data as { match: string }[];
    expect(hits.some((h) => h.match !== 'keyword')).toBe(true);
    expect(fake.state.embedRequests).toBe(calls + 1); // the question only
    // The admin can also ask for a rebuild (audit-logged).
    for (const u of [faculty, cse]) expect((await as(u).post('/admin/ai/reindex')).status).toBe(403);
    const re = await as(admin).post('/admin/ai/reindex').set('Idempotency-Key', 'idx-rebuild-1');
    expect(re.status).toBe(200);
    await settle();
    expect(fake.state.embedRequests).toBe(calls + 1);
    expect(await inT(() => AuditModel.countDocuments({ action: 'ai.reindex_started' }))).toBe(1);
  });

  it('a new embedding model re-indexes everything; two models are never mixed', async () => {
    const total = (await chunks()).length;
    expect(
      (
        await as(admin)
          .put('/admin/ai')
          .send(settings({ embeddingProvider: 'openai', embeddingModel: 'text-embedding-demo-2' }))
      ).status,
    ).toBe(200);
    await settle();
    const rows = await chunks();
    expect(rows.every((c) => c.embeddingModel === 'openai:text-embedding-demo-2')).toBe(true);
    expect(await inT(() => services.vectors.count('openai:text-embedding-demo-2'))).toBe(total);
    expect(await inT(() => services.vectors.count(MODEL))).toBe(0);
    // Back to the first model for the rest of the suite.
    await as(admin)
      .put('/admin/ai')
      .send(settings({ embeddingProvider: 'openai', embeddingModel: 'text-embedding-demo' }));
    await settle();
    expect((await chunks()).every((c) => c.embeddingModel === MODEL)).toBe(true);
  });
});

describe('failures never block material', () => {
  it('a passage the provider refuses stays keyword-searchable; its neighbours get vectors', async () => {
    const r = await upload(
      faculty,
      shared,
      await textPdf([
        ['Refused page', 'REFUSE-ME demo passage about finite automata.'],
        ['Accepted page', 'Demo passage about Turing machines.'],
      ]),
      'mixed.pdf',
    );
    await settle();
    const rows = await chunks({ materialId: r.body.data.id });
    expect(rows.map((c) => c.embeddingStatus).sort()).toEqual(['embedded', 'failed']);
    expect((await search(cse, 'finite automata')).body.data.length).toBeGreaterThan(0);
    const idx = (await as(admin).get('/admin/ai/index')).body.data;
    expect(idx.failed).toBe(1);
  });

  it('an outage leaves passages waiting and tries again later; search falls back to keywords', async () => {
    fake.state.embeddingsDown = true;
    const r = await upload(
      faculty,
      shared,
      await textPdf([['Outage', 'Demo text about Moore machines.']]),
      'o.pdf',
    );
    await settle();
    expect((await chunks({ materialId: r.body.data.id }))[0]?.embeddingStatus).toBe('embedding_pending');
    expect(ctx.queue.delayed.some((j) => j.name === EMBED_JOB)).toBe(true);
    const hits = (await search(cse, 'Moore machines')).body.data as { match: string }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.match === 'keyword')).toBe(true);
    expect((await as(admin).get('/admin/ai/index')).body.data.lastError).toMatch(/overloaded/i);
    fake.state.embeddingsDown = false;
    await ctx.queue.runDelayed({ name: EMBED_JOB });
    expect((await chunks({ materialId: r.body.data.id }))[0]?.embeddingStatus).toBe('embedded');
  });

  it('a key the provider revoked is marked invalid for the admin; members get keyword search', async () => {
    fake.state.embeddingsRevoked = true;
    const r = await upload(
      faculty,
      shared,
      await textPdf([['Revoked', 'Demo text about Mealy machines.']]),
      'r.pdf',
    );
    await settle();
    expect((await chunks({ materialId: r.body.data.id }))[0]?.embeddingStatus).toBe('embedding_pending');
    const view = (await as(admin).get('/admin/ai')).body.data;
    expect(view.keys.embedding.status).toBe('invalid');
    expect(view.status.semantic).toBe(false);
    expect((await search(cse, 'Mealy machines')).body.data.length).toBeGreaterThan(0);
    // A working key again: the waiting passages catch up.
    fake.state.embeddingsRevoked = false;
    await as(admin).put('/admin/ai/keys').send({ target: 'embedding', key: OPENAI_KEY });
    await settle();
    expect((await chunks({ materialId: r.body.data.id }))[0]?.embeddingStatus).toBe('embedded');
  });
});

describe('isolation and visibility in the vector index', () => {
  it('members only ever retrieve published passages of subjects they take', async () => {
    await upload(faculty, cseOnly, await textPdf([['CSE only', 'Demo: pushdown stacks for CSE.']]), 'c.pdf');
    await upload(faculty, eceOnly, await textPdf([['ECE only', 'Demo: pushdown stacks for ECE.']]), 'e.pdf');
    await settle();
    const subjectsOf = async (u: TestUser) =>
      new Set(
        ((await search(u, 'pushdown stacks')).body.data as { subjectId: string }[]).map((h) => h.subjectId),
      );
    expect(await subjectsOf(cse)).toEqual(new Set([cseOnly]));
    expect(await subjectsOf(ece)).toEqual(new Set([eceOnly]));
    expect((await search(cse, 'pushdown stacks', eceOnly)).status).toBe(404);
  });

  it('another college’s vectors are never returned, even for the same words', async () => {
    await turnOnEmbeddings(otherAdmin, U);
    await upload(
      otherFaculty,
      otherSubject,
      await textPdf([['Other', 'Demo: pumping lemma at another college.']]),
      'x.pdf',
      U,
    );
    await settle();
    const ids = new Set((await chunks({}, U)).map((c) => String(c._id)));
    const hits = (await search(cse, 'pumping lemma another college')).body.data as { chunkId: string }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => ids.has(h.chunkId))).toBe(false);
  });

  it('a takedown hides vectors at once, and a stale vector still cannot leak', async () => {
    const r = await upload(
      faculty,
      shared,
      await textPdf([['Takedown', 'Demo: Chomsky normal form.']]),
      't.pdf',
    );
    await settle();
    expect((await search(cse, 'Chomsky normal form')).body.data.length).toBeGreaterThan(0);
    await as(faculty)
      .post(`/study/materials/${r.body.data.id}/takedown`)
      .send({ reason: 'Demo copyright request' });
    expect((await search(cse, 'Chomsky normal form')).body.data).toEqual([]);
    // Even if the index missed the change, retrieval re-reads every passage before returning it.
    await inT(() => services.vectors.setVisibility(r.body.data.id, 'published'));
    expect((await search(cse, 'Chomsky normal form')).body.data).toEqual([]);
  });

  it('deleting material removes its vectors', async () => {
    const r = await upload(
      faculty,
      shared,
      await textPdf([['Gone', 'Demo: Greibach normal form.']]),
      'g.pdf',
    );
    await settle();
    const ids = (await chunks({ materialId: r.body.data.id })).map((c) => String(c._id));
    expect(ids.length).toBe(1);
    expect((await as(faculty).delete(`/study/materials/${r.body.data.id}`)).status).toBe(204);
    const left = await store.search(
      mockVector('Gone\nGone\nDemo: Greibach normal form.'),
      { tenantId: String(T._id), subjectIds: [shared], model: MODEL, visibility: ['published', 'archived'] },
      100,
    );
    expect(left.some((h) => ids.includes(h.id))).toBe(false);
  });

  it('the index refuses to run without a college', async () => {
    await expect(
      services.vectors.search([1, 0], { subjectIds: [shared], model: MODEL }, 5),
    ).rejects.toThrow();
    await expect(
      store.search([1, 0], { subjectIds: [shared], model: MODEL, visibility: ['published'] } as never, 5),
    ).rejects.toThrow(/tenant/);
  });
});
