/**
 * Verifies every starter job board: the documented public API answers, returns postings, and at
 * least one is in India. Runs in GitHub Actions (.github/workflows/feeds.yml).
 * Usage: pnpm --filter @campuslink/api jobs:verify
 */
import { appendFileSync } from 'node:fs';
import { safeFetch } from '../lib/safe-fetch.js';
import { ADAPTERS } from '../modules/job-sources/adapters.js';
import { isIndiaLocation } from '../modules/jobs/normalize.js';
import { STARTER_BOARDS } from '../modules/job-sources/starter.js';

async function main() {
  const rows: { key: string; ok: boolean; verified: boolean; detail: string }[] = [];
  for (const s of STARTER_BOARDS) {
    const r = await ADAPTERS[s.kind].fetch({ kind: s.kind, board: s.board }, { fetcher: safeFetch });
    if (r.kind !== 'ok') {
      rows.push({
        key: s.key,
        ok: false,
        verified: !!s.verifiedAt,
        detail: 'message' in r ? r.message : 'not modified',
      });
      continue;
    }
    const india = r.jobs.filter((j) => isIndiaLocation(j.location)).length;
    rows.push({
      key: s.key,
      ok: india > 0,
      verified: !!s.verifiedAt,
      detail: `${r.jobs.length} postings, ${india} in India${india ? '' : ' (none in India)'}`,
    });
  }
  const date = new Date().toISOString().slice(0, 10);
  const md = [
    `## Starter job board verification (${date})`,
    '',
    '| Board | Result | Detail |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${r.key} | ${r.ok ? 'pass' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`),
  ].join('\n');
  console.warn(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  if (process.env.GITHUB_ACTIONS) {
    const lines = rows.map((r) => `${r.ok ? 'pass' : 'FAIL'} ${r.key}: ${r.detail}`);
    const enc = (v: string) => v.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    process.stdout.write(`::notice title=Starter job board verification ${date}::${enc(lines.join('\n'))}\n`);
  }
  // Red only when a verified board regresses; failing candidates simply stay unverified.
  if (rows.some((r) => r.verified && !r.ok)) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
