import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import type { SafeFetchOptions, SafeResponse, safeFetch } from '../src/lib/safe-fetch.js';
import { runInTenant } from '../src/lib/context.js';
import {
  MemoryVectorStore,
  VectorIndex,
  assertScoped,
  type ScopedFilter,
  type VectorPoint,
  type VectorStore,
} from '../src/modules/study/vector/store.js';
import { QdrantVectorStore, toPointId, toQdrantFilter } from '../src/modules/study/vector/qdrant.js';
import { createVectorStore } from '../src/modules/study/vector/factory.js';
import { LlmReranker, noReranker, parseOrder } from '../src/modules/study/ai/rerank.js';
import type { LLMProvider } from '../src/modules/study/ai/provider.js';
import { coverage, keywordTerm } from '../src/modules/study/retrieval.service.js';
import { fromBytes, toBytes } from '../src/modules/study/indexing.service.js';

const id = () => new Types.ObjectId().toHexString();
const A = id();
const B = id();
const S1 = id();
const S2 = id();
const M1 = id();
const M2 = id();
const U1 = id();
const T1 = id();

const point = (over: Partial<VectorPoint['payload']>, vector: number[], pid = id()): VectorPoint => ({
  id: pid,
  vector,
  payload: {
    tenantId: A,
    subjectId: S1,
    materialId: M1,
    materialType: 'pdf',
    unitId: null,
    topicIds: [],
    visibility: 'published',
    model: 'mock:m1',
    ...over,
  },
});
const scope = (over: Partial<ScopedFilter> = {}): ScopedFilter => ({
  tenantId: A,
  subjectIds: [S1, S2],
  model: 'mock:m1',
  visibility: ['published'],
  ...over,
});

/** The contract every store must keep (run against the in-memory store; Qdrant below when available). */
async function contract(store: VectorStore) {
  const near = point({}, [1, 0, 0], 'p-near');
  const far = point({}, [0, 1, 0], 'p-far');
  const other = point({ tenantId: B }, [1, 0, 0], 'p-other');
  const draft = point({ visibility: 'in_review' }, [1, 0, 0], 'p-draft');
  const s2 = point(
    { subjectId: S2, materialId: M2, materialType: 'video_file', unitId: U1, topicIds: [T1] },
    [0.9, 0.1, 0],
    'p-s2',
  );
  const old = point({ model: 'mock:m0' }, [1, 0, 0], 'p-old');
  await store.upsert([near, far, other, draft, s2, old]);

  const ids = async (f: Partial<ScopedFilter> = {}) =>
    (await store.search([1, 0, 0], scope(f), 10)).map((h) => h.id);
  expect(await ids()).toEqual(['p-near', 'p-s2', 'p-far']);
  expect((await store.search([1, 0, 0], scope(), 1))[0]?.score).toBeCloseTo(1, 5);
  // Never another college, an unpublished passage, another model or an unlisted subject.
  expect(await ids({ tenantId: B })).toEqual(['p-other']);
  expect(await ids({ subjectIds: [S2] })).toEqual(['p-s2']);
  expect(await ids({ subjectIds: [] })).toEqual([]);
  expect(await ids({ model: 'mock:m0' })).toEqual(['p-old']);
  expect(await ids({ unitId: U1 })).toEqual(['p-s2']);
  expect(await ids({ topicId: T1 })).toEqual(['p-s2']);
  expect(await ids({ materialIds: [M2] })).toEqual(['p-s2']);
  expect(await ids({ materialTypes: ['video_file'] })).toEqual(['p-s2']);
  expect(await ids({ visibility: ['published', 'in_review'] })).toContain('p-draft');

  await store.setVisibility(A, M2, 'archived');
  expect(await ids()).toEqual(['p-near', 'p-far']);
  expect(await store.count(A, 'mock:m1')).toBe(4);
  await store.deleteOtherModels(A, 'mock:m1');
  expect(await ids({ model: 'mock:m0' })).toEqual([]);
  await store.deleteMaterial(A, M1);
  expect(await store.count(A, 'mock:m1')).toBe(1); // p-s2 (archived) remains
  expect(await ids({ tenantId: B })).toEqual(['p-other']);

  // No tenant, no subjects or no model: refused, never "everything".
  await expect(store.search([1, 0, 0], { ...scope(), tenantId: '' }, 5)).rejects.toThrow(/tenant/);
  await expect(store.search([1, 0, 0], { ...scope(), subjectIds: undefined } as never, 5)).rejects.toThrow(
    /subject/,
  );
  await expect(store.search([1, 0, 0], { ...scope(), model: '' }, 5)).rejects.toThrow(/model/);
  await expect(store.upsert([point({ tenantId: 'nope' }, [1, 0, 0])])).rejects.toThrow(/tenant/);
  await expect(store.deleteMaterial('', M1)).rejects.toThrow(/tenant/);
}

describe('in-memory vector store', () => {
  it('keeps the store contract', async () => {
    await contract(new MemoryVectorStore());
  });

  it('loads a college’s stored vectors once, the first time they are needed', async () => {
    let loads = 0;
    const store = new MemoryVectorStore(async (t) => {
      loads++;
      return [point({ tenantId: t }, [1, 0], 'p-1'), point({ tenantId: B }, [1, 0], 'p-foreign')];
    });
    const [a, b] = await Promise.all([
      store.search([1, 0], scope({ subjectIds: [S1] }), 5),
      store.search([1, 0], scope({ subjectIds: [S1] }), 5),
    ]);
    expect(a.map((h) => h.id)).toEqual(['p-1']);
    expect(b.map((h) => h.id)).toEqual(['p-1']);
    expect(loads).toBe(1);
    store.clear();
    await store.count(A, 'mock:m1');
    expect(loads).toBe(2);
  });

  it('assertScoped refuses a filter without a tenant, subjects, model or visibility', () => {
    expect(() => assertScoped(undefined)).toThrow();
    expect(() => assertScoped({ ...scope(), visibility: [] })).toThrow(/visibility/);
    expect(() => assertScoped({ ...scope(), subjectIds: ['x'] })).toThrow(/subject/);
    expect(() => assertScoped(scope())).not.toThrow();
  });
});

describe('the vector index takes the college from the request, never from the caller', () => {
  it('refuses outside a tenant context and stamps the tenant on writes', async () => {
    const store = new MemoryVectorStore();
    const index = new VectorIndex(store);
    await expect(index.search([1, 0], { subjectIds: [S1], model: 'mock:m1' }, 5)).rejects.toThrow();
    await expect(index.deleteMaterial(M1)).rejects.toThrow();
    await runInTenant(A, () =>
      index.upsert([
        { id: 'p-a', vector: [1, 0], payload: { ...point({}, []).payload, tenantId: B } as never },
      ]),
    );
    expect(await store.count(A, 'mock:m1')).toBe(1);
    expect(await store.count(B, 'mock:m1')).toBe(0);
    expect(
      await runInTenant(B, () => index.search([1, 0], { subjectIds: [S1], model: 'mock:m1' }, 5)),
    ).toEqual([]);
    expect(
      (await runInTenant(A, () => index.search([1, 0], { subjectIds: [S1], model: 'mock:m1' }, 5)))[0]?.id,
    ).toBe('p-a');
  });

  it('stores vectors as float32 bytes on the passage', () => {
    const v = [0.25, -1, 3.5];
    expect(fromBytes(toBytes(v))).toEqual(v);
    // As the driver returns a lean Binary.
    expect(fromBytes({ buffer: new Uint8Array(toBytes(v)) })).toEqual(v);
    expect(fromBytes(null)).toEqual([]);
  });
});

/** A fake Qdrant over the SSRF-safe fetcher's interface: records every request. */
function fakeQdrant() {
  const requests: {
    method: string;
    path: string;
    body: Record<string, unknown> | null;
    key: string | undefined;
  }[] = [];
  let exists = false;
  const ok = (result: unknown): SafeResponse => ({
    status: 200,
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ result, status: 'ok' })),
    finalUrl: '',
    headers: {},
  });
  const fn = (async (url: string, opts: SafeFetchOptions = {}) => {
    const path = new URL(url).pathname.replace(/^\//, '');
    const body = typeof opts.body === 'string' ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    requests.push({ method: opts.method ?? 'GET', path, body, key: opts.headers?.['api-key'] });
    if (!opts.allowPrivateNetwork) throw new Error('the platform URL should be allowed to be private');
    if (path.endsWith('/exists')) return ok({ exists });
    if (path === 'collections')
      return ok({ collections: exists ? [{ name: 'campuslink_passages_3' }, { name: 'someone_else' }] : [] });
    if (opts.method === 'PUT' && /^collections\/[^/]+$/.test(path)) exists = true;
    if (path.endsWith('/points/query'))
      return ok({
        points: [
          { id: toPointId(A), score: 0.9, payload: { passageId: 'p-1', tenantId: A } },
          // A point another college's filter would never match; the adapter drops it anyway.
          { id: toPointId(B), score: 0.8, payload: { passageId: 'p-2', tenantId: B } },
        ],
      });
    if (path.endsWith('/points/count')) return ok({ count: 7 });
    return ok(true);
  }) as unknown as typeof safeFetch;
  return { fn, requests };
}

describe('Qdrant adapter', () => {
  const conn = (fetcher: typeof safeFetch) => ({
    apiKey: 'qdrant-demo-key-0123456789',
    baseUrl: 'http://qdrant:6333',
    allowPrivateNetwork: true,
    fetcher,
  });

  it('creates a collection per vector size with a tenant index, and upserts UUID points', async () => {
    const q = fakeQdrant();
    const store = new QdrantVectorStore(conn(q.fn));
    const pid = id();
    await store.upsert([point({}, [1, 0, 0], pid)]);
    const put = q.requests.filter((r) => r.method === 'PUT');
    expect(put[0]).toMatchObject({
      path: 'collections/campuslink_passages_3',
      body: { vectors: { size: 3, distance: 'Cosine' } },
    });
    expect(put[1]?.body).toEqual({
      field_name: 'tenantId',
      field_schema: { type: 'keyword', is_tenant: true },
    });
    const up = put.at(-1);
    expect(up?.path).toBe('collections/campuslink_passages_3/points');
    const pts = up?.body?.points as { id: string; payload: Record<string, unknown> }[];
    expect(pts[0]?.id).toBe(toPointId(pid));
    expect(pts[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(pts[0]?.payload).toMatchObject({ tenantId: A, passageId: pid, model: 'mock:m1' });
    expect(q.requests.every((r) => r.key === 'qdrant-demo-key-0123456789')).toBe(true);
  });

  it('every search and write carries the tenant in its filter', async () => {
    const q = fakeQdrant();
    const store = new QdrantVectorStore(conn(q.fn));
    await store.upsert([point({}, [1, 0, 0])]);
    const hits = await store.search([1, 0, 0], scope({ unitId: U1, topicId: T1, materialTypes: ['pdf'] }), 5);
    expect(hits).toEqual([{ id: 'p-1', score: 0.9 }]);
    const query = q.requests.find((r) => r.path.endsWith('/points/query'));
    expect(query?.body?.filter).toEqual(
      toQdrantFilter(scope({ unitId: U1, topicId: T1, materialTypes: ['pdf'] })),
    );
    expect((query?.body?.filter as { must: unknown[] }).must.slice(0, 4)).toEqual([
      { key: 'tenantId', match: { value: A } },
      { key: 'subjectId', match: { any: [S1, S2] } },
      { key: 'model', match: { value: 'mock:m1' } },
      { key: 'visibility', match: { any: ['published'] } },
    ]);
    await store.deleteMaterial(A, M1);
    await store.setVisibility(A, M1, 'archived');
    await store.deleteOtherModels(A, 'mock:m1');
    expect(await store.count(A, 'mock:m1')).toBe(7);
    const writes = q.requests.filter((r) => /points\/(delete|payload|count)$/.test(r.path));
    expect(writes.length).toBe(4);
    for (const w of writes) {
      expect(w.path.startsWith('collections/campuslink_passages_3/')).toBe(true);
      expect((w.body?.filter as { must: unknown[] }).must[0]).toEqual({
        key: 'tenantId',
        match: { value: A },
      });
    }
    // No subjects: nothing is asked at all.
    const n = q.requests.length;
    expect(await store.search([1, 0, 0], scope({ subjectIds: [] }), 5)).toEqual([]);
    expect(q.requests.length).toBe(n);
    await expect(store.search([1, 0, 0], scope({ tenantId: '' }), 5)).rejects.toThrow(/tenant/);
  });

  it('is chosen when QDRANT_URL is set (or required), otherwise memory', () => {
    const f = fakeQdrant().fn;
    expect(
      createVectorStore({ VECTOR_STORE: 'auto', QDRANT_URL: undefined, QDRANT_API_KEY: undefined }, f).id,
    ).toBe('memory');
    expect(
      createVectorStore({ VECTOR_STORE: 'auto', QDRANT_URL: 'http://q:6333', QDRANT_API_KEY: undefined }, f)
        .id,
    ).toBe('qdrant');
    expect(
      createVectorStore({ VECTOR_STORE: 'memory', QDRANT_URL: 'http://q:6333', QDRANT_API_KEY: undefined }, f)
        .id,
    ).toBe('memory');
    expect(() =>
      createVectorStore({ VECTOR_STORE: 'qdrant', QDRANT_URL: undefined, QDRANT_API_KEY: undefined }, f),
    ).toThrow(/QDRANT_URL/);
  });

  // Real Qdrant (docker compose --profile qdrant): runs when QDRANT_TEST_URL is set.
  it.runIf(!!process.env.QDRANT_TEST_URL)('keeps the store contract against a real Qdrant', async () => {
    const { safeFetch } = await import('../src/lib/safe-fetch.js');
    const store = new QdrantVectorStore(
      {
        apiKey: null,
        baseUrl: process.env.QDRANT_TEST_URL ?? '',
        allowPrivateNetwork: true,
        fetcher: safeFetch,
      },
      `test_${Date.now()}`,
    );
    const ids = new Map<string, string>();
    const real: VectorStore = {
      id: 'qdrant',
      upsert: (pts) => {
        for (const p of pts) ids.set(p.id, ids.get(p.id) ?? id());
        return store.upsert(pts.map((p) => ({ ...p, id: ids.get(p.id) ?? '' })));
      },
      search: async (v, f, l) => {
        const back = new Map([...ids].map(([k, v2]) => [v2, k]));
        return (await store.search(v, f, l)).map((h) => ({ ...h, id: back.get(h.id) ?? h.id }));
      },
      deleteMaterial: (t, m) => store.deleteMaterial(t, m),
      deleteOtherModels: (t, k) => store.deleteOtherModels(t, k),
      setVisibility: (t, m, v) => store.setVisibility(t, m, v),
      count: (t, m) => store.count(t, m),
    };
    await contract(real);
  });
});

describe('re-ranking and retrieval helpers', () => {
  const llm = (text: string | Error): LLMProvider => ({
    id: 'mock',
    async generate() {
      if (text instanceof Error) throw text;
      return { text, inputTokens: 40, outputTokens: 5, stopReason: 'end' };
    },
    async listModels() {
      return [];
    },
  });
  const passages = [
    { id: 'a', text: 'first' },
    { id: 'b', text: 'second' },
    { id: 'c', text: 'third' },
  ];

  it('the LLM re-ranker follows the model’s order and keeps every passage', async () => {
    expect(await new LlmReranker(llm('Ranked: [3, 1]'), 'm').rerank('q', passages)).toEqual({
      ids: ['c', 'a', 'b'],
      tokens: 45,
    });
  });

  it('an unreadable answer or a failure keeps the fused order', async () => {
    expect((await new LlmReranker(llm('passage three is best'), 'm').rerank('q', passages)).ids).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect((await new LlmReranker(llm(new Error('down')), 'm').rerank('q', passages)).ids).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect((await noReranker.rerank('q', passages)).ids).toEqual(['a', 'b', 'c']);
    expect(parseOrder('[9, 2, 2, 0, 1]', 3)).toEqual([2, 1]);
    expect(parseOrder('[]', 3)).toBeNull();
  });

  it('keyword terms are words only (no $text operators), at most 100 characters', () => {
    expect(keywordTerm('What is the "pumping lemma" -regular?')).toBe('what is the pumping lemma regular');
    expect(keywordTerm('పంపింగ్ లెమ్మా అంటే ఏమిటి')).toBe('పంపింగ్ లెమ్మా అంటే ఏమిటి');
    expect(keywordTerm('word '.repeat(10) + 'x'.repeat(120))).toBe('word');
    expect(keywordTerm('a b')).toBe('');
    expect(
      keywordTerm(Array.from({ length: 40 }, (_, i) => `w${i}xyz`).join(' ')).length,
    ).toBeLessThanOrEqual(100);
  });

  it('coverage is the share of the question’s content words found in the passages', () => {
    expect(coverage('Explain the pumping lemma', ['The pumping lemma for regular languages'])).toBe(1);
    expect(coverage('pumping lemma and turing machines', ['The pumping lemma'])).toBeCloseTo(0.5);
    expect(coverage('what is', ['anything'])).toBe(0);
  });
});
