import { normaliseOutput, type CodeLanguage, type CodeRunStatus } from '@campuslink/shared';
import { callJson, type ProviderConnection } from '../study/ai/provider.js';

/**
 * Runs a member's code against an item's hidden tests (prompt 2, G4). Off unless the platform owner
 * sets CODE_RUNNER=judge0 with a self-hosted Judge0 (JUDGE0_URL) on an isolated network: code is
 * never sent to a third party. Without a runner, coding is practised through output prediction and
 * multiple choice, and coding items are not served.
 */
export interface CodeRunResult {
  status: CodeRunStatus;
  passed: number;
  total: number;
  /** A short, safe message: the first failing test's expected and actual output, or the compiler's first lines. */
  message: string;
}
export interface CodeTest {
  stdin: string;
  expected: string;
}
export interface CodeRunner {
  readonly id: 'disabled' | 'judge0' | 'stub';
  readonly enabled: boolean;
  readonly languages: readonly CodeLanguage[];
  run(code: string, language: CodeLanguage, tests: readonly CodeTest[]): Promise<CodeRunResult>;
}

/** The limits every run gets (per test). */
export const RUN_LIMITS = {
  cpuSeconds: 2,
  wallSeconds: 5,
  memoryKb: 128_000,
  maxFileKb: 1024,
} as const;
const MESSAGE_MAX = 400;
const clip = (s: string) => (s.length > MESSAGE_MAX ? `${s.slice(0, MESSAGE_MAX)}…` : s);

export class DisabledCodeRunner implements CodeRunner {
  readonly id = 'disabled';
  readonly enabled = false;
  readonly languages: readonly CodeLanguage[] = [];
  run(): Promise<CodeRunResult> {
    return Promise.resolve({ status: 'error', passed: 0, total: 0, message: 'Code runs are not available' });
  }
}

/**
 * Judge0 CE language ids (1.13): C (GCC 9.2), C++ (GCC 9.2), Java (OpenJDK 13), Python 3.8,
 * JavaScript (Node 12). A Judge0 with other compilers can be mapped with JUDGE0_LANGUAGES.
 */
export const JUDGE0_LANGUAGE_IDS: Record<CodeLanguage, number> = {
  c: 50,
  cpp: 54,
  java: 62,
  python: 71,
  javascript: 63,
};

interface Judge0Submission {
  status?: { id?: number; description?: string };
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string | null | undefined) => (s ? Buffer.from(s, 'base64').toString('utf8') : '');

/**
 * A self-hosted Judge0: one synchronous submission per test (`wait=true`), network off, time and
 * memory limits on every run. The output is compared here, with the same rules as output items.
 */
export class Judge0CodeRunner implements CodeRunner {
  readonly id = 'judge0';
  readonly enabled = true;
  readonly languages: readonly CodeLanguage[];
  constructor(
    private readonly conn: ProviderConnection & { authToken: string | null },
    private readonly ids: Record<CodeLanguage, number> = JUDGE0_LANGUAGE_IDS,
  ) {
    this.languages = (Object.keys(ids) as CodeLanguage[]).filter((l) => ids[l] > 0);
  }

  private async submit(code: string, language: CodeLanguage, stdin: string): Promise<Judge0Submission> {
    const base = (this.conn.baseUrl ?? '').replace(/\/+$/, '');
    return callJson<Judge0Submission>(this.conn, `${base}/submissions?base64_encoded=true&wait=true`, {
      method: 'POST',
      headers: this.conn.authToken ? { 'x-auth-token': this.conn.authToken } : {},
      body: {
        source_code: b64(code),
        language_id: this.ids[language],
        stdin: b64(stdin),
        cpu_time_limit: RUN_LIMITS.cpuSeconds,
        wall_time_limit: RUN_LIMITS.wallSeconds,
        memory_limit: RUN_LIMITS.memoryKb,
        max_file_size: RUN_LIMITS.maxFileKb,
        enable_network: false,
      },
      timeoutMs: (RUN_LIMITS.wallSeconds + 10) * 1000,
      maxBytes: 256 * 1024,
    });
  }

  async run(code: string, language: CodeLanguage, tests: readonly CodeTest[]): Promise<CodeRunResult> {
    const total = tests.length;
    if (!this.languages.includes(language))
      return { status: 'error', passed: 0, total, message: 'This language is not available' };
    let passed = 0;
    for (const [i, t] of tests.entries()) {
      let r: Judge0Submission;
      try {
        r = await this.submit(code, language, t.stdin);
      } catch {
        return {
          status: 'error',
          passed,
          total,
          message: 'The code runner did not answer. Try again in a minute.',
        };
      }
      const id = r.status?.id ?? 13;
      if (id === 6)
        return { status: 'compile_error', passed: 0, total, message: clip(unb64(r.compile_output).trim()) };
      if (id === 5) return { status: 'timeout', passed, total, message: `Test ${i + 1} ran out of time` };
      if (id >= 7 && id <= 12)
        return {
          status: 'runtime_error',
          passed,
          total,
          message: clip(
            `Test ${i + 1}: ${r.status?.description ?? 'runtime error'}\n${unb64(r.stderr).trim()}`,
          ),
        };
      if (id !== 3 && id !== 4)
        return { status: 'error', passed, total, message: 'The code runner could not run this. Try again.' };
      const out = normaliseOutput(unb64(r.stdout));
      if (out !== normaliseOutput(t.expected))
        return {
          status: 'failed',
          passed,
          total,
          message: clip(`Test ${i + 1}: expected\n${normaliseOutput(t.expected)}\ngot\n${out}`),
        };
      passed++;
    }
    return { status: 'passed', passed, total, message: '' };
  }
}

/**
 * For tests and local development: "runs" a program by reading `print:<text>` lines from its
 * source (`print:{stdin}` echoes the input), so the runner contract can be checked without Judge0.
 */
export class StubCodeRunner implements CodeRunner {
  readonly id = 'stub';
  readonly enabled = true;
  readonly languages: readonly CodeLanguage[] = ['c', 'cpp', 'java', 'python', 'javascript'];
  run(code: string, _language: CodeLanguage, tests: readonly CodeTest[]): Promise<CodeRunResult> {
    const total = tests.length;
    if (code.includes('syntax error'))
      return Promise.resolve({ status: 'compile_error', passed: 0, total, message: 'syntax error' });
    if (code.includes('while(true)'))
      return Promise.resolve({ status: 'timeout', passed: 0, total, message: 'Test 1 ran out of time' });
    let passed = 0;
    for (const [i, t] of tests.entries()) {
      const out = code
        .split('\n')
        .filter((l) => l.startsWith('print:'))
        .map((l) => l.slice(6).replace('{stdin}', t.stdin.trim()))
        .join('\n');
      if (normaliseOutput(out) !== normaliseOutput(t.expected))
        return Promise.resolve({
          status: 'failed',
          passed,
          total,
          message: `Test ${i + 1}: expected\n${normaliseOutput(t.expected)}\ngot\n${normaliseOutput(out)}`,
        });
      passed++;
    }
    return Promise.resolve({ status: 'passed', passed, total, message: '' });
  }
}
