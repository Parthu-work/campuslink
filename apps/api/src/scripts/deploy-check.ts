/**
 * Prompt 4 (P2, P4): the deployment check. Run inside the API or worker container, it proves the
 * production adapters against the real services this deployment is configured with:
 *
 *   node dist/scripts/deploy-check.js            (deploy/prod/smoke.sh runs it)
 *   pnpm --filter @campuslink/api deploy:check   (from a checkout, with the same environment)
 *
 * - storage: an object is written with the configured encryption, the store confirms it is
 *   encrypted at rest (HEAD), it reads back identical, and it is deleted;
 * - scanner: ClamAV answers, flags the EICAR test file and passes a clean one;
 * - vectors: a vector is written to the configured store under a scratch college id, found again
 *   by a search scoped to that college, not found under another college's id, and removed;
 * - embeddings: the platform's default embedding provider returns vectors (through the SSRF-safe
 *   fetcher: a private address is reached only when AI_PRIVATE_ENDPOINTS lists it);
 * - database: the application user can read and write its own database and nothing else.
 *
 * Prints one line per check and exits non-zero when any fails. Writes only scratch data and
 * removes it; reads no member data. Checks whose service is not configured are reported as skipped.
 */
import { randomBytes } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { loadEnv, type Env } from '../config/env.js';
import { ClamdScanner } from '../lib/clamav.js';
import { safeFetch } from '../lib/safe-fetch.js';
import { S3Storage } from '../lib/s3-storage.js';
import { storageFromEnv } from '../lib/storage-factory.js';
import { embeddingProvider } from '../modules/study/ai/registry.js';
import { createVectorStore } from '../modules/study/vector/factory.js';

export type CheckResult = { name: string; status: 'ok' | 'failed' | 'skipped'; detail: string };

// The EICAR anti-virus test file (harmless by design), assembled so this source is not flagged.
const EICAR = Buffer.from(
  ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''),
  'latin1',
);

async function storage(env: Env): Promise<CheckResult> {
  const name = 'storage';
  const { storage: store } = storageFromEnv(env);
  if (!(store instanceof S3Storage))
    return { name, status: 'skipped', detail: 'STORAGE_DRIVER is not s3 (local disk)' };
  // The same key shape FilesService uses (two hex characters, a slash, 48 more).
  const hex = randomBytes(25).toString('hex');
  const key = `${hex.slice(0, 2)}/${hex.slice(2, 50)}`;
  const body = randomBytes(2048);
  await store.put(key, body);
  try {
    const sse = await store.encryptionOf(key);
    const back = await store.get(key);
    if (!back?.equals(body))
      return { name, status: 'failed', detail: 'the object did not read back identical' };
    if (env.S3_SSE !== 'none' && sse !== env.S3_SSE)
      return {
        name,
        status: 'failed',
        detail: `asked for ${env.S3_SSE}, the store reports ${sse ?? 'no encryption'}`,
      };
    return {
      name,
      status: 'ok',
      detail: `written, encrypted at rest (${sse ?? 'none'}), read back, deleted`,
    };
  } finally {
    await store.delete(key);
  }
}

async function scanner(env: Env): Promise<CheckResult> {
  const name = 'scanner';
  if (env.MALWARE_SCANNER !== 'clamav')
    return { name, status: 'skipped', detail: 'MALWARE_SCANNER is not clamav' };
  const clamd = new ClamdScanner({ address: env.CLAMAV_ADDRESS, timeoutMs: 30_000 });
  if (!(await clamd.ping())) return { name, status: 'failed', detail: 'clamd does not answer' };
  const bad = await clamd.scan(EICAR);
  const good = await clamd.scan(Buffer.from('roll,name\n1,A demo row\n'));
  if (bad !== 'infected')
    return { name, status: 'failed', detail: `the EICAR test file was reported ${bad}` };
  if (good !== 'clean') return { name, status: 'failed', detail: `a clean file was reported ${good}` };
  return { name, status: 'ok', detail: 'EICAR flagged, a clean file passed' };
}

async function embeddings(env: Env): Promise<CheckResult & { vector?: number[] }> {
  const name = 'embeddings';
  const id = env.AI_DEFAULT_EMBEDDING_PROVIDER;
  const model = env.AI_DEFAULT_EMBEDDING_MODEL;
  if (!id || !model) return { name, status: 'skipped', detail: 'no platform embedding provider is set' };
  const baseUrl = env.AI_DEFAULT_EMBEDDING_BASE_URL ?? env.AI_DEFAULT_BASE_URL ?? null;
  const provider = embeddingProvider(id, {
    apiKey: env.AI_DEFAULT_EMBEDDING_API_KEY ?? null,
    baseUrl,
    // The same rule the app applies: private only when the owner allowlisted this exact origin.
    allowPrivateNetwork: !!baseUrl && env.AI_PRIVATE_ENDPOINTS.includes(new URL(baseUrl).origin),
    fetcher: safeFetch,
  });
  const started = Date.now();
  const r = await provider.embed(
    ['Binary search halves the range at every step.', 'Placement drives open in the seventh semester.'],
    model,
  );
  const dim = r.vectors[0]?.length ?? 0;
  if (r.vectors.length !== 2 || !dim || r.vectors[1]?.length !== dim)
    return { name, status: 'failed', detail: 'the provider did not return two vectors of one size' };
  const expected = env.AI_EMBEDDING_DIMENSIONS ?? 0;
  if (expected && dim !== expected)
    return {
      name,
      status: 'failed',
      detail: `vectors have ${dim} dimensions, AI_EMBEDDING_DIMENSIONS says ${expected}`,
    };
  const [vector] = r.vectors;
  return {
    name,
    status: 'ok',
    detail: `${id}:${model}, ${dim} dimensions, ${Date.now() - started} ms for two passages`,
    ...(vector ? { vector } : {}),
  };
}

async function vectors(env: Env, sample: number[] | undefined): Promise<CheckResult> {
  const name = 'vectors';
  const store = createVectorStore(env, safeFetch);
  if (store.id !== 'qdrant')
    return { name, status: 'skipped', detail: `VECTOR_STORE resolves to ${store.id}` };
  // Scratch ids: no college has them, and everything written is removed again.
  const [tenantId, other, subjectId, materialId, id] = Array.from({ length: 5 }, () =>
    new Types.ObjectId().toString(),
  ) as [string, string, string, string, string];
  // The store keeps one collection per vector size: use the real size when embeddings are configured.
  const vector = sample ?? Array.from({ length: 8 }, (_, i) => (i + 1) / 10);
  const model = `deploy-check:${vector.length}`;
  const filter = { subjectIds: [subjectId], model, visibility: ['published' as const] };
  await store.upsert([
    {
      id,
      vector,
      payload: {
        tenantId,
        subjectId,
        materialId,
        materialType: 'notes',
        unitId: null,
        topicIds: [],
        visibility: 'published',
        model,
      } as never,
    },
  ]);
  try {
    const mine = await store.search(vector, { tenantId, ...filter }, 3);
    const theirs = await store.search(vector, { tenantId: other, ...filter }, 3);
    if (!mine.some((h) => h.id === id))
      return { name, status: 'failed', detail: 'the vector was not found again' };
    if (theirs.length) return { name, status: 'failed', detail: 'another college’s search saw the vector' };
    return {
      name,
      status: 'ok',
      detail: `qdrant: written, found in its college only, removed (${vector.length} dimensions)`,
    };
  } finally {
    await store.deleteMaterial(tenantId, materialId);
  }
}

async function database(env: Env): Promise<CheckResult> {
  const name = 'database';
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    // A scratch collection outside every tenant's data, written and dropped by this one check: the
    // point is to test the database user's rights, which the tenant plugin would hide.
    // eslint-disable-next-line no-restricted-syntax -- no tenant data is read or written here
    const db = mongoose.connection.db;
    if (!db) return { name, status: 'failed', detail: 'no database handle' };
    const scratch = db.collection('deploychecks');
    await scratch.insertOne({ at: new Date() });
    await scratch.drop();
    // Least privilege: the application user must not be able to read another database or the users.
    const denied = async (fn: () => Promise<unknown>) =>
      fn().then(
        () => false,
        () => true,
      );
    const admin = mongoose.connection.getClient().db('admin');
    const noUsers = await denied(() => admin.collection('system.users').findOne({}));
    const noOther = await denied(() =>
      mongoose.connection.getClient().db('deploy_check_other').collection('x').insertOne({ a: 1 }),
    );
    if (env.NODE_ENV === 'production' && !(noUsers && noOther))
      return { name, status: 'failed', detail: 'the application user can reach beyond its own database' };
    return {
      name,
      status: 'ok',
      detail:
        noUsers && noOther
          ? 'reads and writes its own database only'
          : 'reads and writes (not least-privilege: development)',
    };
  } finally {
    await mongoose.disconnect();
  }
}

export async function runChecks(env: Env): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const guard = async (name: string, fn: () => Promise<CheckResult & { vector?: number[] }>) => {
    try {
      const r = await fn();
      out.push({ name: r.name, status: r.status, detail: r.detail });
      return r;
    } catch (err) {
      // Messages only: a provider or driver error never carries a key (callJson redacts them).
      out.push({
        name,
        status: 'failed',
        detail: err instanceof Error ? err.message.slice(0, 300) : 'failed',
      });
      return null;
    }
  };
  await guard('database', () => database(env));
  await guard('storage', () => storage(env));
  await guard('scanner', () => scanner(env));
  const e = await guard('embeddings', () => embeddings(env));
  await guard('vectors', () => vectors(env, e?.vector));
  return out;
}

async function main() {
  const results = await runChecks(loadEnv());
  for (const r of results)
    process.stdout.write(`${r.status.toUpperCase().padEnd(8)}${r.name.padEnd(12)}${r.detail}\n`);
  if (results.some((r) => r.status === 'failed')) process.exit(1);
}

if (process.argv[1]?.endsWith('deploy-check.ts') || process.argv[1]?.endsWith('deploy-check.js'))
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
