/**
 * Study performance check (spec §12): retrieval p95 under 300 ms with 50,000 passages, and the
 * first streamed words under 1.5 s with the demo responder.
 *
 * Usage: pnpm --filter @campuslink/api study:perf
 *   STUDY_PERF_CHUNKS=50000 STUDY_PERF_QUERIES=200 (defaults) tune the run; STUDY_PERF_VOCAB=small
 *   measures the worst case for keyword search (every passage made of the same 70 words).
 *
 * Uses its own database (`campuslink_perf`, dropped first and afterwards; refuses any other name)
 * and the in-memory vector store with the demo embeddings, so it needs only MongoDB. The passages
 * are generated from a small vocabulary: obviously synthetic DEMO text. Prints a Markdown table
 * (docs/performance.md) and exits non-zero when a target is missed.
 */
import { performance } from 'node:perf_hooks';
import mongoose, { Types } from 'mongoose';
import { ALL_PERMISSIONS, type ChatStreamEvent } from '@campuslink/shared';
import { loadEnv } from '../config/env.js';
import { syncIndexes } from '../db/connect.js';
import { runInTenant } from '../lib/context.js';
import { createLogger } from '../lib/logger.js';
import { MemoryMailProvider } from '../lib/mailer.js';
import { InlineJobQueue } from '../lib/jobs.js';
import { createApp } from '../app.js';
import { TenantModel } from '../modules/tenants/tenant.model.js';
import { SubjectModel } from '../modules/study/subject.model.js';
import { ContentChunkModel, MaterialModel } from '../modules/study/material.model.js';
import { AiSettingsModel } from '../modules/study/ai-settings.model.js';
import { mockVector } from '../modules/study/ai/mock.js';
import { embedText, toBytes } from '../modules/study/indexing.service.js';
import type { RetrievalService } from '../modules/study/retrieval.service.js';
import type { VectorIndex } from '../modules/study/vector/store.js';
import { withTextSearch } from '../db/search.js';
import type { ChatService } from '../modules/study/chat.service.js';
import type { AuthState } from '../types.js';

const env = loadEnv();
if (env.NODE_ENV === 'production')
  throw new Error('Refusing to run the study performance check in production');
const DB = 'campuslink_perf';
const CHUNKS = Number(process.env.STUDY_PERF_CHUNKS ?? 50_000);
const QUERIES = Number(process.env.STUDY_PERF_QUERIES ?? 200);
const SUBJECTS = 50;
const PER_MATERIAL = 50;

const mongoUri = (() => {
  const u = new URL(env.MONGODB_URI);
  u.pathname = `/${DB}`;
  return u.toString();
})();

const WORDS = (
  'automaton state transition alphabet string language regular expression grammar derivation parse ' +
  'tree pushdown stack turing machine tape decidable halting reduction closure union concatenation ' +
  'star pumping lemma minimisation equivalence nondeterministic deterministic epsilon move accepting ' +
  'start symbol production terminal variable ambiguity normal form chomsky greibach recursive enumerable ' +
  'complexity polynomial graph tree array list queue heap sort search hash compiler lexer parser token'
).split(' ');
const pick = (i: number) => WORDS[i % WORDS.length] as string;
/**
 * A library like a real one: each subject has its own topic words, all passages share a long tail
 * of common words (Zipf over 4,000 words), and the subject words above appear everywhere a little.
 * A question names two topic words of one subject and one shared subject word. With
 * STUDY_PERF_VOCAB=small every passage uses only the 70 shared words: the worst case for keywords.
 */
const SMALL = process.env.STUDY_PERF_VOCAB === 'small';
const VOCAB = 4000;
const TOPIC_WORDS = 30;
const cumulative = (() => {
  const c: number[] = [];
  let sum = 0;
  for (let r = 1; r <= VOCAB; r++) c.push((sum += 1 / r ** 1.07));
  return c.map((x) => x / sum);
})();
function zipfWord(u: number): string {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cumulative[mid] ?? 1) < u) lo = mid + 1;
    else hi = mid;
  }
  return `lex${lo + 1}`;
}
const topicWord = (subject: number, k: number) => `topic${subject}x${k % TOPIC_WORDS}`;
/** Deterministic synthetic DEMO text (no real material). */
function demoText(n: number, subject: number): string {
  const out: string[] = ['DEMO passage'];
  let x = (n * 2654435761) >>> 0;
  for (let i = 0; i < 90; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    const u = x / 2 ** 32;
    out.push(
      SMALL
        ? pick(x >>> 8)
        : u < 0.7
          ? zipfWord(u / 0.7)
          : u < 0.9
            ? topicWord(subject, x >>> 8)
            : pick(x >>> 8),
    );
  }
  return `${out.join(' ')}.`;
}
/** Question `q`: two topic words of one subject and one shared word (or three shared words). */
const question = (q: number) =>
  SMALL
    ? `${pick(q * 7)} ${pick(q * 13 + 3)} ${pick(q * 5 + 11)}`
    : `${topicWord(q % SUBJECTS, q * 7)} ${topicWord(q % SUBJECTS, q * 13 + 3)} ${pick(q * 5 + 11)}`;
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

async function main() {
  if (!mongoUri.includes(`/${DB}`)) throw new Error(`Refusing: not the ${DB} database`);
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  await syncIndexes();
  const tenant = await TenantModel.create({
    slug: 'perf',
    branding: {
      displayName: 'Performance Demo College',
      shortName: 'PERF',
      primary: '#3fb8e6',
      secondary: '#6d5ae6',
      accent: '#f2b705',
      monogram: 'PD',
    },
    subscription: { plan: 'trial', seatLimit: 1000, renewalDate: null },
  });
  const app = createApp({
    env: { ...env, VECTOR_STORE: 'memory' },
    logger: createLogger('silent'),
    readiness: {},
    mailer: new MemoryMailProvider(),
    jobs: new InlineJobQueue(),
  });
  const services = app.locals.services as {
    retrieval: RetrievalService;
    chat: ChatService;
    vectors: VectorIndex;
  };
  // Faculty read every subject: the widest (slowest) retrieval scope.
  const viewer: AuthState = {
    userId: new Types.ObjectId().toHexString(),
    sessionId: 'perf',
    roles: ['FACULTY'],
    capabilities: [],
    verified: true,
    mfaEnabled: false,
    mfaPending: false,
    permissions: new Set(ALL_PERMISSIONS.filter((p) => p.startsWith('study:'))),
  };

  const rows: string[][] = [];
  await runInTenant(tenant._id, async () => {
    await AiSettingsModel.create({
      chatProvider: 'mock',
      chatModel: 'mock-chat-1',
      embeddingProvider: 'mock',
      embeddingModel: 'mock-embed-1',
      features: { chatbot: true },
    });
    const started = performance.now();
    const subjects = await SubjectModel.insertMany(
      Array.from({ length: SUBJECTS }, (_, i) => ({
        name: `DEMO subject ${i + 1}`,
        code: `PERF${i + 1}`,
        createdBy: new Types.ObjectId(viewer.userId),
      })),
    );
    let n = 0;
    while (n < CHUNKS) {
      const subject = subjects[Math.floor(n / PER_MATERIAL) % SUBJECTS];
      if (!subject) break;
      const material = await MaterialModel.create({
        subjectId: subject._id,
        title: `DEMO material ${Math.floor(n / PER_MATERIAL) + 1}`,
        type: 'pdf',
        category: 'notes',
        visibility: 'published',
        stage: 'indexed',
        rightsAttestedAt: new Date(),
      });
      const batch = Array.from({ length: Math.min(PER_MATERIAL, CHUNKS - n) }, (_, i) => {
        const text = demoText(n + i, Math.floor(n / PER_MATERIAL) % SUBJECTS);
        return {
          subjectId: subject._id,
          materialId: material._id,
          version: 1,
          index: i,
          text,
          heading: '',
          page: i + 1,
          tokenCount: Math.ceil(text.length / 4),
          contentHash: `perf-${n + i}`,
          visibility: 'published',
          embeddingStatus: 'embedded',
          embeddingModel: 'mock:mock-embed-1',
          vector: toBytes(mockVector(embedText(material.title, '', text))),
          embeddedAt: new Date(),
        };
      });
      await ContentChunkModel.insertMany(batch);
      n += batch.length;
    }
    rows.push(['Passages generated', `${n}`, `${Math.round(performance.now() - started)} ms`, '']);

    // First search loads the college's vectors into the in-memory index (once per process).
    const warm = performance.now();
    await services.retrieval.retrieve(viewer, { query: 'pumping lemma regular language' });
    rows.push(['First search (loads the index)', '1', `${Math.round(performance.now() - warm)} ms`, '']);

    // The two halves of hybrid retrieval, measured on their own.
    const scope = subjects.map((x) => String(x._id));
    const kw: number[] = [];
    const vec: number[] = [];
    for (let q = 0; q < Math.min(QUERIES, 50); q++) {
      const query = question(q);
      let t0 = performance.now();
      await withTextSearch(
        ContentChunkModel.find({ subjectId: { $in: subjects.map((x) => x._id) }, visibility: 'published' }),
        query,
      )
        .select({ score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(24)
        .lean();
      kw.push(performance.now() - t0);
      t0 = performance.now();
      await services.vectors.search(mockVector(query), { subjectIds: scope, model: 'mock:mock-embed-1' }, 24);
      vec.push(performance.now() - t0);
    }
    rows.push([
      'Keyword search only',
      `${kw.length}`,
      `p50 ${pct(kw, 50).toFixed(0)} ms · p95 ${pct(kw, 95).toFixed(0)} ms`,
      '',
    ]);
    rows.push([
      'Vector search only (in memory)',
      `${vec.length}`,
      `p50 ${pct(vec, 50).toFixed(0)} ms · p95 ${pct(vec, 95).toFixed(0)} ms`,
      '',
    ]);

    const times: number[] = [];
    for (let q = 0; q < QUERIES; q++) {
      const query = question(q);
      const t0 = performance.now();
      await services.retrieval.retrieve(viewer, { query });
      times.push(performance.now() - t0);
    }
    const p95 = pct(times, 95);
    rows.push([
      'Hybrid retrieval, all 50 subjects',
      `${QUERIES}`,
      `p50 ${pct(times, 50).toFixed(0)} ms · p95 ${p95.toFixed(0)} ms`,
      p95 < 300 ? 'pass (< 300 ms)' : 'FAIL (≥ 300 ms)',
    ]);

    const firsts: number[] = [];
    for (let q = 0; q < 10; q++) {
      const run = await services.chat.prepare(viewer, {
        question: `What is ${question(q)}?`,
        mode: 'simple',
      } as Parameters<ChatService['prepare']>[1]);
      const t0 = performance.now();
      let first = 0;
      await run((e: ChatStreamEvent) => {
        if (!first && (e.type === 'delta' || e.type === 'done')) first = performance.now() - t0;
      }, new AbortController().signal);
      firsts.push(first);
    }
    const worst = Math.max(...firsts);
    rows.push([
      'Chat with the demo responder: first words',
      '10',
      `p50 ${pct(firsts, 50).toFixed(0)} ms · max ${worst.toFixed(0)} ms`,
      worst < 1500 ? 'pass (< 1.5 s)' : 'FAIL (≥ 1.5 s)',
    ]);
  });

  console.warn('\n| Check | Runs | Result | Target |\n| --- | --- | --- | --- |');
  for (const r of rows) console.warn(`| ${r.join(' | ')} |`);
  // STUDY_PERF_KEEP=1 keeps the data for a closer look (explain plans); otherwise it is dropped.
  if (process.env.STUDY_PERF_KEEP !== '1') await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (rows.some((r) => r[3]?.startsWith('FAIL'))) process.exit(1);
}

main().catch(async (err: unknown) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
