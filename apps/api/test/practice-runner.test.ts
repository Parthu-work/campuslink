import { beforeAll, describe, expect, it } from 'vitest';
import type { PracticeHomeView } from '@campuslink/shared';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import {
  DisabledCodeRunner,
  JUDGE0_LANGUAGE_IDS,
  Judge0CodeRunner,
  RUN_LIMITS,
  StubCodeRunner,
  type CodeRunner,
  type CodeTest,
} from '../src/modules/practice/code-runner.js';
import type { safeFetch } from '../src/lib/safe-fetch.js';

/** Prompt 2, G4: the CodeRunner contract (stub and Judge0), and practice with code runs off. */

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
/**
 * A fake Judge0: "runs" the source by echoing stdin when it says `echo`, prints `nope` otherwise,
 * and answers with the status a test asks for.
 */
function fakeJudge0(status: () => { id: number; description?: string } | 'down', sent: Sent[] = []) {
  const fetcher = (async (
    url: string,
    opts: { headers?: Record<string, string>; body?: Buffer | string } = {},
  ) => {
    const body = JSON.parse(String(opts.body ?? '{}')) as Record<string, unknown>;
    sent.push({ url, headers: opts.headers ?? {}, body });
    const s = status();
    if (s === 'down') throw new Error('connect ECONNREFUSED');
    const source = unb64(String(body.source_code ?? ''));
    const stdin = unb64(String(body.stdin ?? ''));
    const reply = {
      status: s,
      stdout: s.id === 3 ? b64(source.includes('echo') ? `${stdin}\n` : 'nope') : null,
      stderr: s.id === 11 ? b64('Segmentation fault') : null,
      compile_output: s.id === 6 ? b64("main.c:1: error: expected ';'") : null,
    };
    return {
      status: 200,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(reply)),
      finalUrl: url,
    };
  }) as unknown as typeof safeFetch;
  return new Judge0CodeRunner({
    apiKey: null,
    baseUrl: 'http://judge0.internal:2358/',
    allowPrivateNetwork: true,
    fetcher,
    authToken: 'judge0-token-0123456789',
  });
}

const TESTS: CodeTest[] = [
  { stdin: 'hello', expected: 'hello' },
  { stdin: 'campus', expected: 'campus\n' },
];

describe.each<[string, () => CodeRunner, string, string]>([
  ['stub', () => new StubCodeRunner(), 'print:{stdin}', 'print:nope'],
  ['judge0', () => fakeJudge0(() => ({ id: 3 })), 'echo', 'other'],
])('the CodeRunner contract: %s', (_name, make, good, bad) => {
  it('is enabled, names its languages and passes a correct program on every test', async () => {
    const r = make();
    expect(r.enabled).toBe(true);
    expect(r.languages).toEqual(expect.arrayContaining(['c', 'python', 'java']));
    expect(await r.run(good, 'python', TESTS)).toEqual({
      status: 'passed',
      passed: 2,
      total: 2,
      message: '',
    });
  });
  it('fails a wrong program at the first failing test, with the expected and actual output', async () => {
    const res = await make().run(bad, 'python', TESTS);
    expect(res).toMatchObject({ status: 'failed', passed: 0, total: 2 });
    expect(res.message).toContain('expected\nhello');
  });
});

describe('Judge0', () => {
  it('sends base64 code with the limits, network off, its token, and one submission per test', async () => {
    const sent: Sent[] = [];
    await fakeJudge0(() => ({ id: 3 }), sent).run('echo', 'cpp', TESTS);
    expect(sent).toHaveLength(2);
    const first = sent[0];
    expect(first?.url).toBe('http://judge0.internal:2358/submissions?base64_encoded=true&wait=true');
    expect(first?.headers['x-auth-token']).toBe('judge0-token-0123456789');
    expect(first?.body).toMatchObject({
      language_id: JUDGE0_LANGUAGE_IDS.cpp,
      stdin: b64('hello'),
      cpu_time_limit: RUN_LIMITS.cpuSeconds,
      wall_time_limit: RUN_LIMITS.wallSeconds,
      memory_limit: RUN_LIMITS.memoryKb,
      enable_network: false,
    });
    expect(unb64(String(first?.body.source_code))).toBe('echo');
  });

  it('maps compile errors, time-outs, runtime errors and an outage', async () => {
    expect(await fakeJudge0(() => ({ id: 6 })).run('x', 'c', TESTS)).toMatchObject({
      status: 'compile_error',
      message: "main.c:1: error: expected ';'",
    });
    expect((await fakeJudge0(() => ({ id: 5 })).run('x', 'c', TESTS)).status).toBe('timeout');
    const crash = await fakeJudge0(() => ({ id: 11, description: 'Runtime Error (SIGSEGV)' })).run(
      'x',
      'c',
      TESTS,
    );
    expect(crash.status).toBe('runtime_error');
    expect(crash.message).toContain('SIGSEGV');
    expect((await fakeJudge0(() => 'down').run('x', 'c', TESTS)).status).toBe('error');
    expect((await fakeJudge0(() => ({ id: 13 })).run('x', 'c', TESTS)).status).toBe('error');
  });
});

describe('code runs off (the default)', () => {
  it('the disabled runner runs nothing', async () => {
    const r = new DisabledCodeRunner();
    expect(r.enabled).toBe(false);
    expect(r.languages).toEqual([]);
    expect((await r.run()).status).toBe('error');
  });

  // CODE_RUNNER is unset in tests: the app builds the disabled runner itself.
  const ctx = testApp();
  let T: TestTenant;
  let faculty: TestUser, student: TestUser;
  const as = (u: TestUser) => api(ctx, u.tenant.host, u.token);
  beforeAll(async () => {
    T = await makeTenant('practicenorun');
    faculty = await makeUser(ctx, T, { roles: ['FACULTY'] });
    student = await makeUser(ctx, T, { roles: ['STUDENT'] });
  });

  it('coding items are never served, so a company with only coding items has nothing yet', async () => {
    const r = await as(faculty)
      .post('/practice/items')
      .send({
        kind: 'coding',
        topic: 'arrays',
        companies: ['Lumen Analytics'],
        text: 'Read two numbers and print their sum.',
        codeLanguage: 'c',
        explanation: 'Add the two numbers and print the result.',
        tests: [{ stdin: '1 2', expected: '3' }],
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const home = (await as(student).get('/practice')).body.data as PracticeHomeView;
    expect(home.runner).toBe(false);
    expect(home.companies).toEqual([]);
    expect((await as(student).post('/practice/sets').send({ company: 'Lumen Analytics' })).status).toBe(404);
    const daily = await as(student).post('/practice/sets').send({});
    expect(daily.status).toBe(201);
    expect(
      (daily.body.data as { items: { item: { kind: string } }[] }).items.every(
        (i) => i.item.kind !== 'coding',
      ),
    ).toBe(true);
  });
});

describe('the starter bank', () => {
  it('every item is well-formed for its kind, with a unique permanent ref', async () => {
    const { STARTER_ITEMS } = await import('../src/modules/practice/starter-items.js');
    const { itemProblem, PRACTICE_TOPICS } = await import('@campuslink/shared');
    expect(new Set(STARTER_ITEMS.map((s) => s.ref)).size).toBe(STARTER_ITEMS.length);
    for (const s of STARTER_ITEMS) {
      const problem = itemProblem({
        kind: s.kind,
        options: s.options ?? [],
        answer: s.answer,
        code: s.code ?? '',
        codeLanguage: s.codeLanguage ?? null,
        tests: s.tests ?? [],
      });
      expect(problem, s.ref).toBeNull();
      expect(PRACTICE_TOPICS, s.ref).toContain(s.topic);
    }
    // Coding is a small part: the bank works without a code runner.
    expect(STARTER_ITEMS.filter((s) => s.kind === 'coding').length).toBeLessThan(STARTER_ITEMS.length / 10);
  });
});
