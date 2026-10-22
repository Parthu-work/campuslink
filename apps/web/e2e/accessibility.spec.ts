import { test, expect } from '@playwright/test';
import { PASSWORD, signIn } from './helpers';

/**
 * Phase 8 accessibility pass, beyond the axe scans in every other spec: a keyboard-only journey,
 * reduced motion, and reflow at 320 CSS px (WCAG 1.4.10, the equivalent of 400% zoom at 1280 px).
 */
const BASE = 'http://dpit.localhost:4173';

test('keyboard only: sign in, skip to content, open a page from the navigation', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Keyboard journey runs on desktop');
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Email', { exact: true }).focus();
  await page.keyboard.type('ananya@dpit.example');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/home$/);

  // After the client-side navigation, focus moves to the new page's main region.
  await expect(page.locator('main#main')).toBeFocused();

  // On a fresh page load, the first Tab reaches the skip link, which moves focus to the main region.
  await page.reload();
  await page.locator('main#main').waitFor();
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();

  // From the top of the page, Tab through the main navigation to Jobs and open it with Enter.
  await page.reload();
  await page.locator('main#main').waitFor();
  await page.waitForLoadState('networkidle');
  const jobs = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Jobs' });
  for (let i = 0; i < 40 && !(await jobs.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(jobs).toBeFocused();
  // Focus is visible: an outline or ring is drawn on the focused link.
  const ring = await jobs.evaluate((el) => {
    const s = getComputedStyle(el);
    return s.outlineStyle !== 'none' || s.boxShadow !== 'none';
  });
  expect(ring).toBe(true);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/jobs$/);

  // The command palette opens and closes from the keyboard.
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('reduced motion turns animation off', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await signIn(page, 'ananya@dpit.example');
  const scale = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--motion-scale').trim(),
  );
  expect(Number(scale)).toBe(0);
  await ctx.close();
});

test('content reflows at 320 CSS px without horizontal scrolling', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await ctx.newPage();
  await signIn(page, 'ananya@dpit.example');
  const overflowing: string[] = [];
  for (const path of [
    '/home',
    '/people',
    '/jobs',
    '/roadmaps',
    '/events',
    '/progress',
    '/messages',
    '/settings/data',
  ]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (wide) overflowing.push(path);
  }
  // Job detail overflowed before the revamp (audit A11Y-4).
  await page.goto(`${BASE}/jobs`);
  await page.locator('a[href^="/jobs/"]:not([href="/jobs/tracker"]):not([href="/jobs/new"])').first().click();
  await page.waitForURL(/\/jobs\/[a-f0-9]{24}$/);
  await page.waitForLoadState('networkidle');
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1))
    overflowing.push('/jobs/:id');
  expect(overflowing).toEqual([]);
  await ctx.close();

  // So did the alumni Mentoring dashboard.
  const alumni = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const mentorPage = await alumni.newPage();
  await signIn(mentorPage, 'rahul@dpit.example');
  await mentorPage.goto(`${BASE}/mentor`);
  await mentorPage.waitForLoadState('networkidle');
  expect(await mentorPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(
    false,
  );
  await alumni.close();
});
