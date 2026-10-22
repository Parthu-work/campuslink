import {
  SafeFetchError,
  type SafeFetchOptions,
  type SafeResponse,
  type safeFetch,
} from '../src/lib/safe-fetch.js';
import { api, type TestTenant, type TestUser, type testApp } from './helpers.js';

/** Demo keys: obviously fake, and the provider's error echoes the bad one (as real ones do). */
export const GOOD_KEY = 'sk-ant-demo-GOOD-1111222233334444';
export const BAD_KEY = 'sk-ant-demo-BAD-9999888877776666';
export const OPENAI_KEY = 'sk-demo-openai-5555666677778888';
export const YOUTUBE_KEY = 'AIzaDemoYoutubeKey000011112222';

const json = (status: number, body: unknown): SafeResponse => ({
  status,
  contentType: 'application/json',
  body: Buffer.from(JSON.stringify(body)),
  finalUrl: '',
  headers: {},
});

export interface FakeCall {
  url: string;
  opts: SafeFetchOptions;
  body: Record<string, unknown> | null;
}

/** A fake SSRF-safe fetcher that answers like the AI providers do (no network). */
export function aiFetcher() {
  const calls: FakeCall[] = [];
  const fn = (async (url: string, opts: SafeFetchOptions = {}) => {
    const body = typeof opts.body === 'string' ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    calls.push({ url, opts, body });
    const h = opts.headers ?? {};
    if (url.startsWith('https://api.anthropic.com/v1/models')) {
      if (h['x-api-key'] === GOOD_KEY)
        return json(200, { data: [{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-5-5' }] });
      return json(401, {
        type: 'error',
        error: { type: 'authentication_error', message: `invalid x-api-key ${h['x-api-key']}` },
      });
    }
    if (url === 'https://api.openai.com/v1/models') {
      if (h.authorization === `Bearer ${OPENAI_KEY}`)
        return json(200, { data: [{ id: 'text-embedding-demo' }, { id: 'chat-demo' }] });
      return json(401, { error: { message: `Incorrect API key provided: ${h.authorization}` } });
    }
    if (url.startsWith('http://ollama.test:11434/')) {
      if (!opts.allowPrivateNetwork) throw new SafeFetchError('Destination address is not allowed');
      return json(200, { data: [{ id: 'local-model' }] });
    }
    if (url.startsWith('https://www.googleapis.com/youtube/v3/')) {
      return h['x-goog-api-key'] === YOUTUBE_KEY
        ? json(200, { items: [] })
        : json(400, { error: { message: `API key not valid: ${h['x-goog-api-key']}` } });
    }
    throw new SafeFetchError('Could not fetch that URL');
  }) as unknown as typeof safeFetch;
  return { fn, calls };
}

export const FLAT_SYLLABUS = [
  'UNIT - I: Finite Automata: Alphabet, strings and languages; DFA, NFA, Equivalence of NFA and DFA',
  'UNIT - II Regular Expressions',
  '1. Regular expressions and regular languages',
  '2. Pumping lemma for regular languages',
  'Unit III: Context-Free Grammars',
  '- Derivations and parse trees, ambiguity (with examples)',
].join('\n');

export interface SubjectInput {
  name?: string;
  code?: string;
  branches?: string[];
  batches?: number[];
  semester?: number | null;
  ownerIds?: string[];
}

export async function makeSubject(
  ctx: ReturnType<typeof testApp>,
  tenant: TestTenant,
  as: TestUser,
  input: SubjectInput = {},
): Promise<{ id: string }> {
  const r = await api(ctx, tenant.host, as.token)
    .post('/study/subjects')
    .send({
      name: 'Demo Formal Languages and Automata Theory',
      code: `FLAT${Math.floor(Math.random() * 1e6)}`,
      branches: ['CSE'],
      batches: [2027],
      semester: 5,
      ...input,
    });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.data as { id: string };
}
