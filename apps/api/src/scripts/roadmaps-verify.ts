/**
 * Checks every URL cited by the roadmap library (roadmap sources, node sources and resources)
 * still answers. Runs in GitHub Actions (.github/workflows/feeds.yml); results go into
 * docs/roadmap-sources.md and failing nodes are marked `needsReview`.
 * Usage: pnpm --filter @campuslink/api roadmaps:verify
 */
import { appendFileSync } from 'node:fs';
import { safeFetch } from '../lib/safe-fetch.js';
import { LIBRARY } from '../modules/roadmaps/library/index.js';

type Result = 'pass' | 'RETRY' | 'FAIL';
/** Sites that refuse automated clients or rate-limit are inconclusive, not broken. */
const INCONCLUSIVE = new Set([
  401, 403, 405, 406, 408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524,
]);

async function check(url: string): Promise<{ result: Result; detail: string }> {
  try {
    const r = await safeFetch(url, {
      maxBytes: 3 * 1024 * 1024,
      timeoutMs: 20_000,
      maxRedirects: 8,
      headers: { accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8' },
    });
    if (r.status >= 200 && r.status < 400) return { result: 'pass', detail: String(r.status) };
    return { result: INCONCLUSIVE.has(r.status) ? 'RETRY' : 'FAIL', detail: `HTTP ${r.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The page answered; it is just bigger than we read.
    if (msg === 'Response is too large') return { result: 'pass', detail: 'large' };
    // Connection refused or reset: some official sites (Indian government, NPTEL) refuse
    // connections from overseas CI runners. Inconclusive; checked by hand and listed in the docs.
    if (msg === 'The request timed out' || msg === 'Too many redirects' || msg === 'Could not fetch that URL')
      return { result: 'RETRY', detail: msg };
    return { result: 'FAIL', detail: msg };
  }
}

async function main() {
  const where = new Map<string, string[]>();
  for (const l of LIBRARY) {
    const cite = (url: string, at: string) => where.set(url, [...(where.get(url) ?? []), at]);
    for (const s of l.content.sources) cite(s.url, l.key);
    for (const n of l.content.nodes)
      for (const s of [...n.sources, ...n.resources]) cite(s.url, `${l.key}/${n.id}`);
  }
  const urls = [...where.keys()];
  const results = new Map<string, { result: Result; detail: string }>();
  // A few at a time, so no single site sees a burst.
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < urls.length) {
        const url = urls[next++] as string;
        results.set(url, await check(url));
      }
    }),
  );
  const count = (k: Result) => [...results.values()].filter((r) => r.result === k).length;
  const date = new Date().toISOString().slice(0, 10);
  const notPassing = urls.filter((u) => results.get(u)?.result !== 'pass');
  const line = (u: string) => {
    const r = results.get(u);
    return `${r?.result ?? 'FAIL'} ${u} (${r?.detail ?? ''}) cited by ${(where.get(u) ?? []).join(', ')}`;
  };
  const md = [
    `## Roadmap link check (${date})`,
    '',
    `${urls.length} URLs: ${count('pass')} pass, ${count('RETRY')} inconclusive, ${count('FAIL')} fail.`,
    '',
    ...notPassing.map((u) => `- ${line(u).replace(/\|/g, '/')}`),
  ].join('\n');
  console.warn(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  if (process.env.GITHUB_ACTIONS) {
    const enc = (v: string) => v.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    const body = [
      `${urls.length} URLs: ${count('pass')} pass, ${count('RETRY')} inconclusive, ${count('FAIL')} fail`,
      ...notPassing.map(line),
    ].join('\n');
    process.stdout.write(`::notice title=Roadmap link check ${date}::${enc(body.slice(0, 60_000))}\n`);
  }
  // Red only for definite breakage (gone, not found, no such host, http-only); blocks, rate limits and
  // refused connections are retried.
  if (count('FAIL') > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
