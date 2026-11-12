import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, test } from '@playwright/test';
import { signIn } from '../helpers';

/**
 * Lighthouse 12.8.2 (the audit's version, fetched with npx and not a dependency) on the same pages
 * as the audit plus Study, in Lighthouse's default mobile emulation and simulated throttling.
 * Each run gets its own Chromium, signed in afresh where the page needs it, which Lighthouse drives
 * through its debugging port; "cold" runs clear the service worker, Cache Storage and HTTP cache
 * first, "warm" ones visit the page once.
 * Writes `data-after/lighthouse/<name>.json.gz` and `lighthouse-summary.json`.
 * Run: `pnpm --filter @campuslink/web audit:lighthouse` (needs PW_CHROMIUM_PATH or Playwright's Chromium).
 */
const OUT = join(process.env.AUDIT_OUT ?? '../../docs/design/revamp', 'data-after', 'lighthouse');
/**
 * npx itself. On Windows it is a .cmd file, which Node runs only through a shell (and then every
 * argument would need quoting), so run npm's own script with this Node instead.
 */
const NPX =
  process.platform === 'win32'
    ? [process.execPath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')]
    : ['npx'];
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
  // Prompt 2 (G13 re-audit).
  { name: 'companies-cold', path: '/companies', signedIn: true },
  { name: 'copilot-cold', path: '/copilot', signedIn: true },
  { name: 'resume-cold', path: '/resume', signedIn: true },
  { name: 'practice-cold', path: '/practice', signedIn: true },
  { name: 'readiness-cold', path: '/readiness', signedIn: true },
  { name: 'profile-edit-cold', path: '/profile', signedIn: true },
  { name: 'profile-view-cold', path: '/people', signedIn: true },
  { name: 'home-warm', path: '/home', signedIn: true, warm: true },
  { name: 'jobs-warm', path: '/jobs', signedIn: true, warm: true },
  { name: 'landing', path: '/', signedIn: false },
  { name: 'sign-in', path: '/sign-in', signedIn: false },
];

/**
 * A browser for one run, signed in as the demo student and primed (warm) or emptied (cold), left open
 * for Lighthouse to drive through its debugging port. Chrome is started here, Playwright connects
 * only to prepare it and then lets go, so Lighthouse has the tab to itself. (Lighthouse launching its
 * own Chrome on a prepared profile lost the session on Windows; a Playwright-owned browser closed
 * Lighthouse's tab under it.)
 */
let nextPort = 9330;
async function browserFor(run: (typeof RUNS)[number]) {
  const dir = mkdtempSync(join(tmpdir(), 'lh-'));
  const port = nextPort++;
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      RESOLVE,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const close = async () => {
    chrome.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const browser = await connect(port);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    if (run.signedIn) {
      await signIn(page, 'ananya@dpit.example');
      if (run.path === '/people') {
        // The profile view: a member's page (the first one in the directory).
        await page.goto(`${BASE}/people`);
        const href = await page.locator('main a[href^="/people/"]').first().getAttribute('href');
        run.path = href ?? '/people';
      }
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
    } else if (run.signedIn) {
      await page.evaluate(async () => {
        for (const r of (await navigator.serviceWorker?.getRegistrations()) ?? []) await r.unregister();
        for (const k of await caches.keys()) await caches.delete(k);
      });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.clearBrowserCache');
    }
    // Nothing of ours keeps running beside the measured tab, and Playwright lets go of the browser.
    await page.goto('about:blank');
    await browser.close();
  } catch (e) {
    await close();
    throw e;
  }
  return { port, close };
}

/** Playwright over the debugging port, once Chrome is listening on it. */
async function connect(port: number) {
  for (let i = 0; ; i++)
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (e) {
      if (i >= 40) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
}

const display = (a: Record<string, { displayValue?: string; score?: number | null }>, id: string) =>
  a[id]?.displayValue ?? null;

test.setTimeout(0);

test('lighthouse', async () => {
  const summary: Record<string, unknown>[] = [];
  // Lighthouse occasionally fails to record a trace (NO_NAVSTART): each page gets three tries, and
  // a page that still fails is recorded as such while the others carry on.
  // LH_RUNS=landing,sign-in measures only those pages (a quick check); the summary then holds only those.
  const only = process.env.LH_RUNS?.split(',');
  for (const run of RUNS.filter((r) => !only || only.includes(r.name)))
    for (let attempt = 1; attempt <= 3; attempt++)
      try {
        await audit(run);
        break;
      } catch (e) {
        if (attempt === 3) summary.push({ name: run.name, error: String(e).split('\n')[0] });
      }
  writeFileSync(join(resolve(OUT), 'lighthouse-summary.json'), `${JSON.stringify(summary, null, 1)}\n`);

  async function audit(run: (typeof RUNS)[number]) {
    const browser = await browserFor(run);
    const out = join(tmpdir(), `lh-${run.name}.json`);
    try {
      execFileSync(
        NPX[0] ?? 'npx',
        [
          ...NPX.slice(1),
          '-y',
          'lighthouse@12.8.2',
          `${BASE}${run.path}`,
          '--quiet',
          '--output=json',
          `--output-path=${out}`,
          `--port=${browser.port}`,
          '--only-categories=performance,accessibility,best-practices',
          '--disable-storage-reset',
        ],
        { stdio: 'inherit', timeout: 240_000 },
      );
      const lhr = JSON.parse(readFileSync(out, 'utf8')) as {
        finalDisplayedUrl: string;
        categories: Record<string, { score: number | null }>;
        audits: Record<
          string,
          { displayValue?: string; score?: number | null; details?: { items?: Record<string, unknown>[] } }
        >;
      };
      // A signed-in page measured as the sign-in screen is a failed run, not a result.
      if (run.signedIn && new URL(lhr.finalDisplayedUrl).pathname === '/sign-in')
        throw new Error(`${run.name} ended on the sign-in page`);
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
      await browser.close();
      rmSync(out, { force: true });
    }
  }
});
