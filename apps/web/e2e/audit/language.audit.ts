import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser } from '@playwright/test';
import { signIn } from '../helpers';
import { settle, truncations, type Truncation } from './probes';
import { TELUGU } from './screens';

/**
 * Prompt 3, U11 (X5): no meaning cut short at 360 px in any language; U13 adds 1440 px (the
 * sidebar's account button cut the member's own name there). Every screen in `TELUGU` (a student's)
 * and the placement cell's own screens, in English, Telugu and Hindi, light theme, DPIT: titles,
 * names and buttons drawn with an ellipsis and longer than their box (`truncations`).
 * Writes `data-after/truncation-360.json` and `truncation-1440.json`; fails while any is left.
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

const WIDTHS = [360, 1440] as const;
type Width = (typeof WIDTHS)[number];
const DEVICE = {
  360: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;

async function scan(
  browser: Browser,
  account: string,
  screens: { slug: string; path: string }[],
  width: Width,
) {
  const found: Truncation[] = [];
  for (const lang of LANGS) {
    const ctx = await browser.newContext({ ...DEVICE[width], baseURL: 'http://dpit.localhost:4173' });
    const page = await ctx.newPage();
    await signIn(page, `${account}@dpit.example`, 'dpit');
    await page.evaluate((l) => localStorage.setItem('cl:lang', l), lang);
    for (const s of screens) {
      await page.goto(s.path);
      await settle(page);
      found.push(...(await truncations(page, `${account}-${s.slug}-${lang}-${width}`)));
    }
    await ctx.close();
  }
  return found;
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(0);

const all: Record<Width, Truncation[]> = { 360: [], 1440: [] };

for (const width of WIDTHS) {
  test(`a student’s screens at ${width} px`, async ({ browser }) => {
    all[width].push(...(await scan(browser, 'ananya', TELUGU, width)));
  });

  test(`the placement cell’s screens at ${width} px`, async ({ browser }) => {
    all[width].push(...(await scan(browser, 'tpo', STAFF, width)));
  });
}

test('nothing that carries meaning is cut short', () => {
  for (const width of WIDTHS)
    writeFileSync(join(DATA, `truncation-${width}.json`), `${JSON.stringify(all[width], null, 1)}\n`);
  expect([...all[360], ...all[1440]].map((x) => `${x.screen}: ${x.role} "${x.text}"`)).toEqual([]);
});
