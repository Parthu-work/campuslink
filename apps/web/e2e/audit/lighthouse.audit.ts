import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, test } from '@playwright/test';
import { signIn } from '../helpers';

/**
 * Lighthouse 12.8.2 (the audit's version, fetched with npx and not a dependency) on the same pages
 * as the audit plus Study, in Lighthouse's default mobile emulation and simulated throttling.
 * Signed-in pages use a persistent Chromium profile with a fresh sign-in before each run; "cold"
 * runs clear the service worker, Cache Storage and HTTP cache first, "warm" ones visit the page once.
 * Writes `data-after/lighthouse/<name>.json.gz` and `lighthouse-summary.json`.
 * Run: `pnpm --filter @campuslink/web audit:lighthouse` (needs PW_CHROMIUM_PATH or Playwright's Chromium).
 */
const OUT = join(process.env.AUDIT_OUT ?? '../../docs/design/revamp', 'data-after', 'lighthouse');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://dpit.localhost:4173';
const CHROME = process.env.PW_CHROMIUM_PATH ?? chromium.executablePath();
const RESOLVE = '--host-resolver-rules=MAP *.localhost 127.0.0.1';

const RUNS: { name: string; path: string; signedIn: boolean; warm?: boolean }[] = [
  { name: 'home-cold', path: '/home', signedIn: true },
  { name: 'mentors-cold', path: '/mentors', signedIn: true },
  { name: 'jobs-cold', path: '/jobs', signedIn: true },
  { name: 'roadmaps-cold', path: '/roadmaps', signedIn: true },
  { name: 'study-cold', path: '/study', signedIn: true },
  { name: 'profile-edit-cold', path: '/profile', signedIn: true },
  { name: 'profile-view-cold', path: '/people', signedIn: true },
  { name: 'home-warm', path: '/home', signedIn: true, warm: true },
  { name: 'jobs-warm', path: '/jobs', signedIn: true, warm: true },
  { name: 'landing', path: '/', signedIn: false },
  { name: 'sign-in', path: '/sign-in', signedIn: false },
];

/** A profile signed in as the demo student, primed (warm) or emptied (cold). */
async function profile(run: (typeof RUNS)[number]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'lh-'));
  if (!run.signedIn) return dir;
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: CHROME, args: [RESOLVE] });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await signIn(page, 'ananya@dpit.example');
  if (run.path === '/people') {
    // The profile view: a member's page (the first one in the directory).
    await page.goto(`${BASE}/people`);
    const href = await page.locator('main a[href^="/people/"]').first().getAttribute('href');
    run.path = href ?? '/people';
  }
  if (run.warm) {
    // The installed app: the service worker has installed (it precaches every screen's code) and
    // controls the page, which has been visited before.
    await page.goto(`${BASE}${run.path}`);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      async () => !!(await navigator.serviceWorker?.getRegistration())?.active,
      undefined,
      { timeout: 60_000, polling: 500 },
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 30_000 });
    await page.waitForTimeout(1000);
  } else {
    await page.evaluate(async () => {
      for (const r of (await navigator.serviceWorker?.getRegistrations()) ?? []) await r.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
  }
  await ctx.close();
  return dir;
}

const display = (a: Record<string, { displayValue?: string; score?: number | null }>, id: string) =>
  a[id]?.displayValue ?? null;

test.setTimeout(0);

test('lighthouse', async () => {
  const summary: Record<string, unknown>[] = [];
  // Lighthouse occasionally fails to record a trace (NO_NAVSTART): each page gets three tries, and
  // a page that still fails is recorded as such while the others carry on.
  for (const run of RUNS)
    for (let attempt = 1; attempt <= 3; attempt++)
      try {
        await audit(run);
        break;
      } catch (e) {
        if (attempt === 3) summary.push({ name: run.name, error: String(e).split('\n')[0] });
      }
  writeFileSync(join(resolve(OUT), 'lighthouse-summary.json'), `${JSON.stringify(summary, null, 1)}\n`);

  async function audit(run: (typeof RUNS)[number]) {
    const dir = await profile(run);
    const out = join(tmpdir(), `lh-${run.name}.json`);
    try {
      execFileSync(
        'npx',
        [
          '-y',
          'lighthouse@12.8.2',
          `${BASE}${run.path}`,
          '--quiet',
          '--output=json',
          `--output-path=${out}`,
          `--chrome-flags=--headless=new --no-sandbox --user-data-dir=${dir} ${RESOLVE}`,
          '--only-categories=performance,accessibility,best-practices',
          '--disable-storage-reset',
        ],
        // Lighthouse finds Chromium through CHROME_PATH (it has no flag for it).
        { stdio: 'inherit', timeout: 240_000, env: { ...process.env, CHROME_PATH: CHROME } },
      );
      const lhr = JSON.parse(readFileSync(out, 'utf8')) as {
        finalDisplayedUrl: string;
        categories: Record<string, { score: number | null }>;
        audits: Record<
          string,
          { displayValue?: string; score?: number | null; details?: { items?: Record<string, unknown>[] } }
        >;
      };
      writeFileSync(join(OUT, `lighthouse-${run.name}.json.gz`), gzipSync(readFileSync(out)));
      const a = lhr.audits;
      const items = (id: string) => a[id]?.details?.items ?? [];
      summary.push({
        name: run.name,
        url: `${BASE}${run.path}`,
        finalUrl: lhr.finalDisplayedUrl,
        performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
        accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
        bestPractices: Math.round((lhr.categories['best-practices']?.score ?? 0) * 100),
        FCP: display(a, 'first-contentful-paint'),
        LCP: display(a, 'largest-contentful-paint'),
        TBT: display(a, 'total-blocking-time'),
        CLS: display(a, 'cumulative-layout-shift'),
        SI: display(a, 'speed-index'),
        TTI: display(a, 'interactive'),
        lcpElement:
          (
            items('largest-contentful-paint-element')[0]?.items as
              { node?: { snippet?: string } }[] | undefined
          )?.[0]?.node?.snippet ?? null,
        unusedJs: display(a, 'unused-javascript'),
        totalBytes: display(a, 'total-byte-weight'),
        mainThread: display(a, 'mainthread-work-breakdown'),
        bootup: display(a, 'bootup-time'),
        longTasks: items('long-tasks').length,
        unsizedImages: items('unsized-images').length,
        transferredScripts: items('network-requests').filter((r) => r.resourceType === 'Script').length,
        criticalChains: display(a, 'critical-request-chains'),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { force: true });
    }
  }
});
