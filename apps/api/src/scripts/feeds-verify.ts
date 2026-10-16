/**
 * Verifies every starter feed: reachable over HTTPS, allowed by robots.txt, parses as RSS/Atom,
 * has items, and the newest is recent. Runs in GitHub Actions (.github/workflows/feeds.yml).
 * Usage: pnpm --filter @campuslink/api feeds:verify
 */
import { appendFileSync } from 'node:fs';
import { safeFetch } from '../lib/safe-fetch.js';
import { fetchFeed } from '../modules/content-sources/fetch.js';
import { STARTER_SOURCES } from '../modules/content-sources/starter.js';

const RECENT_DAYS = 120;

async function main() {
  const rows: { key: string; ok: boolean; verified: boolean; retry: boolean; detail: string }[] = [];
  for (const s of STARTER_SOURCES) {
    const r = await fetchFeed(s.url, safeFetch);
    if (r.kind !== 'ok') {
      rows.push({
        key: s.key,
        ok: false,
        verified: !!s.verifiedAt,
        // 429/503: the source asked us to slow down; inconclusive, retried on the next run.
        retry: r.kind === 'error' && r.retryAfterSec !== null,
        detail: 'message' in r ? r.message : 'not modified',
      });
      continue;
    }
    const newest = r.feed.items.reduce((m, i) => Math.max(m, i.publishedAt.getTime()), 0);
    const ageDays = Math.round((Date.now() - newest) / 86_400_000);
    const ok = r.feed.items.length > 0 && ageDays <= RECENT_DAYS;
    rows.push({
      key: s.key,
      ok,
      verified: !!s.verifiedAt,
      retry: false,
      detail: `${r.feed.format}, ${r.feed.items.length} items, newest ${ageDays} days old${ok ? '' : ' (stale or empty)'}`,
    });
  }
  const date = new Date().toISOString().slice(0, 10);
  const md = [
    `## Starter feed verification (${date})`,
    '',
    '| Feed | Result | Detail |',
    '| --- | --- | --- |',
    ...rows.map(
      (r) => `| ${r.key} | ${r.ok ? 'pass' : r.retry ? 'RETRY' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`,
    ),
  ].join('\n');
  console.warn(md);
  console.warn(
    `\nVERIFIED_KEYS=${rows
      .filter((r) => r.ok)
      .map((r) => r.key)
      .join(',')}`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  // One annotation with every result: readable through the REST API (check-run annotations) even
  // where log downloads are not reachable.
  if (process.env.GITHUB_ACTIONS) {
    const lines = rows.map((r) => `${r.ok ? 'pass' : r.retry ? 'RETRY' : 'FAIL'} ${r.key}: ${r.detail}`);
    const enc = (v: string) => v.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    process.stdout.write(`::notice title=Starter feed verification ${date}::${enc(lines.join('\n'))}\n`);
  }
  // Red only when a verified feed definitely regresses (rate limits are retried next run).
  if (rows.some((r) => r.verified && !r.ok && !r.retry)) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
