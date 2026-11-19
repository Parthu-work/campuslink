import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Prompt 3, U12: the audit's defects, each with a test. Items already covered elsewhere: A8 (the
 * landing's join button names the phone, `landing.spec`), A10 (a session within 15 minutes is
 * Home's Today card with Join, `today-pick.test.ts`), A19 (Today replaced the overview's tiles,
 * `today.spec`).
 */
const BASE = 'http://dpit.localhost:4173';
/** The phone's bottom tabs (found by their place, not their name: the name is translated). */
const tabs = (page: Page) => page.locator('nav.chrome-bottom');

test('A2: a screen deep inside a space lights that space’s tab, and only that one', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'mobile',
    'The bottom tabs are a phone’s (the rail is tested in navigation)',
  );
  await signIn(page, 'ananya@dpit.example');
  const owners: [string, string][] = [
    ['/roadmaps/sde-dsa', 'Learn'],
    ['/study', 'Learn'],
    ['/resume', 'Career'],
    ['/placements', 'Career'],
    ['/sessions', 'Mentors'],
    ['/events', 'Home'],
    ['/settings/preferences', 'You'],
  ];
  for (const [path, tab] of owners) {
    await page.goto(`${BASE}${path}`);
    await expect(tabs(page).getByRole('link', { name: tab, exact: true }), path).toHaveAttribute(
      'aria-current',
      /^(page|true)$/,
    );
    await expect(tabs(page).locator('[aria-current]'), path).toHaveCount(1);
  }
});

test('2: the bottom tabs’ labels are whole at 360 px in English, Telugu and Hindi', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile', 'The bottom tabs are a phone’s');
  await page.setViewportSize({ width: 360, height: 780 });
  await signIn(page, 'ananya@dpit.example');
  for (const lang of ['en', 'te', 'hi']) {
    await page.evaluate((l) => localStorage.setItem('cl:lang', l), lang);
    await page.goto(`${BASE}/home`);
    const cut = await tabs(page).evaluate((nav) =>
      Array.from(nav.querySelectorAll<HTMLElement>('a *'))
        .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim())
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.textContent),
    );
    expect(cut, lang).toEqual([]);
  }
});

test('A13: the map opens with the next step whole inside its frame', async ({ page }) => {
  await signIn(page, 'ananya@dpit.example');
  await page.goto(`${BASE}/roadmaps/sde-dsa`);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const frame = page.getByRole('region', { name: 'Roadmap steps and how they connect' });
  const next = frame.getByRole('button', { name: /, Next$/ });
  await expect(next).toBeVisible();
  await page.waitForTimeout(300);
  const [f, n] = [await frame.boundingBox(), await next.boundingBox()];
  expect(f && n).toBeTruthy();
  if (!f || !n) return;
  expect(n.x).toBeGreaterThanOrEqual(f.x - 1);
  expect(n.y).toBeGreaterThanOrEqual(f.y - 1);
  expect(n.x + n.width).toBeLessThanOrEqual(f.x + f.width + 1);
  expect(n.y + n.height).toBeLessThanOrEqual(f.y + f.height + 1);
});

test('A15: the mentor deck’s tip names what the right arrow does: request', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'The deck is the phone’s Match');
  await signIn(page, 'ananya@dpit.example');
  await page.goto(`${BASE}/mentors`);
  const deck = page.getByRole('region', { name: /suggestions left/ });
  await expect(deck).toHaveAttribute('aria-label', /right arrow to request\.$/);
});

test('A18: the Ask button, before there is a question, stays readable', async ({ page }) => {
  await signIn(page, 'ananya@dpit.example');
  await page.goto(`${BASE}/ask?scope=career`);
  const send = page.getByRole('main').getByRole('button', { name: 'Ask', exact: true });
  await expect(send).toBeDisabled();
  // Not faded to half: a neutral fill with a readable icon (3:1 or more for a control).
  const style = await send.evaluate((el) => {
    const s = getComputedStyle(el);
    return { opacity: s.opacity, bg: s.backgroundColor, color: s.color };
  });
  expect(style.opacity).toBe('1');
  const ratio = await page.evaluate(({ bg, color }) => {
    // Any CSS colour (the theme's are oklch) to sRGB, through a canvas.
    const rgb = (c: string) => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return [0, 0, 0];
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
    };
    const lum = (c: string) => {
      const [r, g, b] = rgb(c).map((v) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    const [a, b] = [lum(bg), lum(color)].sort((x, y) => y - x);
    return ((a ?? 0) + 0.05) / ((b ?? 0) + 0.05);
  }, style);
  expect(ratio).toBeGreaterThanOrEqual(3);
});
