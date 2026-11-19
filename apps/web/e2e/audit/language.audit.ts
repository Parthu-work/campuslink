import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser } from '@playwright/test';
import { signIn } from '../helpers';
import { settle, truncations, type Truncation } from './probes';
import { TELUGU } from './screens';

/**
 * Prompt 3, U11 (X5): no meaning cut short at 360 px in any language. Every screen in `TELUGU` (a
 * student's) and the placement cell's own screens, in English, Telugu and Hindi, light theme, DPIT:
 * titles, names and buttons drawn with an ellipsis and longer than their box (`truncations`).
 * Writes `data-after/truncation-360.json`; fails while any is left.
 * Run: `pnpm --filter @campuslink/web exec playwright test -c e2e/audit/playwright.config.ts language`.
 */
const OUT = process.env.AUDIT_OUT ?? 'audit-out';
const DATA = join(OUT, 'data-after');
mkdirSync(DATA, { recursive: true });

const LANGS = ['en', 'te', 'hi'] as const;
const STAFF: { slug: string; path: string }[] = [
  { slug: 'staff-today', path: '/admin' },
  { slug: 'staff-analytics', path: '/admin/analytics' },
  { slug: 'staff-readiness', path: '/admin/readiness' },
  { slug: 'staff-reports', path: '/admin/reports?gradYear=2026' },
  { slug: 'staff-placements', path: '/admin/placements' },
];

async function scan(browser: Browser, account: string, screens: { slug: string; path: string }[]) {
  const found: Truncation[] = [];
  for (const lang of LANGS) {
    const ctx = await browser.newContext({
      viewport: { width: 360, height: 780 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      baseURL: 'http://dpit.localhost:4173',
    });
    const page = await ctx.newPage();
    await signIn(page, `${account}@dpit.example`, 'dpit');
    await page.evaluate((l) => localStorage.setItem('cl:lang', l), lang);
    for (const s of screens) {
      await page.goto(s.path);
      await settle(page);
      found.push(...(await truncations(page, `${account}-${s.slug}-${lang}-360`)));
    }
    await ctx.close();
  }
  return found;
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(0);

const all: Truncation[] = [];

test('a student’s screens', async ({ browser }) => {
  all.push(...(await scan(browser, 'ananya', TELUGU)));
});

test('the placement cell’s screens', async ({ browser }) => {
  all.push(...(await scan(browser, 'tpo', STAFF)));
});

test('nothing that carries meaning is cut short', () => {
  writeFileSync(join(DATA, 'truncation-360.json'), `${JSON.stringify(all, null, 1)}\n`);
  expect(all.map((x) => `${x.screen}: ${x.role} "${x.text}"`)).toEqual([]);
});
