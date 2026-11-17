import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { signIn } from '../helpers';

/**
 * The landing's product pictures (prompt 3, U4): the demo student's real screens on the seeded demo
 * college, never a mock-up. Home at 360 × 780 for the phone frame, and the top of three screens for
 * the sections (find a senior, a drive, a career path), in both themes and all three languages,
 * written as webp to `public/landing/` (the landing labels them "Demo data").
 * Run against a freshly seeded database: `pnpm --filter @campuslink/web audit:landing-shots`.
 */
const OUT = join(process.cwd(), 'public', 'landing');
const BASE = 'http://dpit.localhost:4173';
const THEMES = ['light', 'dark'] as const;
const LANGS = ['en', 'te', 'hi'] as const;
/** CSS pixels of each crop; captured at 2× (sizes match SHOT_SIZE in features/landing/landing.tsx). */
const CROP = { width: 360, height: 440 };

/** PNG to webp in a blank page (no app CSP), at a quality that keeps UI text crisp. */
async function toWebp(converter: Page, png: Buffer) {
  const b64 = await converter.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')?.drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.82).split(',')[1] ?? '';
  }, png.toString('base64'));
  return Buffer.from(b64, 'base64');
}

/** A screen settled: its heading, its data, and no animation half-way. */
async function open(page: Page, path: string) {
  await page.goto(`${BASE}${path}`);
  await page.locator('main h1').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
}

test.setTimeout(0);

test('landing shots', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const converter = await (await browser.newContext()).newPage();
  for (const theme of THEMES) {
    const ctx = await browser.newContext({
      viewport: { width: 360, height: 780 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await ctx.addInitScript((t) => {
      localStorage.setItem('cl:theme', t);
      localStorage.setItem('cl:motion', 'reduce');
    }, theme);
    const page = await ctx.newPage();
    await signIn(page, 'ananya@dpit.example');
    // The first drive on the student's list (a real one from the seed).
    await open(page, '/placements');
    const drive = await page.locator('main a[href^="/placements/"]').first().getAttribute('href');
    if (!drive) throw new Error('No drive in the seeded list');
    for (const lang of LANGS) {
      await page.evaluate((l) => localStorage.setItem('cl:lang', l), lang);
      const save = async (name: string, png: Buffer) =>
        writeFileSync(join(OUT, `${name}-${theme}-${lang}.webp`), await toWebp(converter, png));
      await page.setViewportSize({ width: 360, height: 780 });
      await open(page, '/home');
      await save('home', await page.screenshot());
      // The crops: a tall screen, so each part sits clear of the top and bottom bars unscrolled.
      await page.setViewportSize({ width: 360, height: 1400 });
      for (const [name, path, from] of [
        // The first suggested senior, as the student sees them.
        ['mentors', '/mentors', (p: Page) => p.locator('main .touch-pan-y').first()],
        // The drive's header and roles.
        ['drives', drive, (p: Page) => p.locator('main').first()],
        // Progress, the pace and the first phase of the journey.
        [
          'paths',
          '/roadmaps/sde-dsa',
          (p: Page) => p.locator('main header').first().locator(':scope > div').nth(1),
        ],
      ] as const) {
        await open(page, path);
        const box = await from(page).boundingBox();
        if (!box) throw new Error(`Nothing to crop on ${path}`);
        const y = Math.max(0, Math.round(box.y) - 12);
        await save(name, await page.screenshot({ clip: { x: 0, y, ...CROP } }));
      }
    }
    await ctx.close();
  }
});
