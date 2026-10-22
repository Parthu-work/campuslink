import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Revamp phase 2 (audit TR-3, NB-3, PW-1): back restores the exact scroll position, each tab keeps
 * its own place, new screens start at the top, re-tapping a tab scrolls to the top, and the first
 * paint follows the device theme.
 */
const BASE = 'http://dpit.localhost:4173';

const scrollTo = async (page: Page, y: number) => {
  await page.evaluate((target) => window.scrollTo(0, target), y);
  await page.waitForTimeout(150);
  return page.evaluate(() => window.scrollY);
};

const mainTabs = (page: Page) => page.getByRole('navigation', { name: 'Main' }).last();

test('Home → post → back lands on the same post', async ({ page }) => {
  await signIn(page, 'ananya@dpit.example');
  const feed = page.getByRole('feed', { name: 'For you' });
  await expect(feed.getByRole('article').first()).toBeVisible();
  const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const y = await scrollTo(page, Math.min(900, Math.max(0, max - 50)));
  // Open a post that is on screen right now.
  const comments = page.getByRole('link', { name: /comment/i });
  const count = await comments.count();
  let opened = false;
  for (let i = 0; i < count && !opened; i++) {
    const link = comments.nth(i);
    const box = await link.boundingBox();
    if (box && box.y > 80 && box.y < (page.viewportSize()?.height ?? 700) - 120) {
      await link.click();
      opened = true;
    }
  }
  expect(opened).toBe(true);
  await page.waitForURL(/\/posts\//);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  await page.goBack();
  await page.waitForURL(/\/home$/);
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeGreaterThan(y - 30);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(30);
});

test('Jobs (scrolled) → job → back returns to the same place', async ({ page }) => {
  await signIn(page, 'ananya@dpit.example');
  await page.goto(`${BASE}/jobs`);
  const jobLinks = page.locator('a[href^="/jobs/"]:not([href="/jobs/tracker"]):not([href="/jobs/new"])');
  await expect(jobLinks.first()).toBeVisible();
  const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const y = await scrollTo(page, Math.min(700, Math.max(0, max - 50)));
  const visible = jobLinks.filter({ visible: true });
  let target = visible.first();
  for (let i = 0; i < (await visible.count()); i++) {
    const box = await visible.nth(i).boundingBox();
    if (box && box.y > 80 && box.y < (page.viewportSize()?.height ?? 700) - 120) {
      target = visible.nth(i);
      break;
    }
  }
  await target.click();
  await page.waitForURL(/\/jobs\/[a-f0-9]{24}$/);
  await page.goBack();
  await page.waitForURL(/\/jobs$/);
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeGreaterThan(y - 30);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(30);
});

test.describe('tabs (phones)', () => {
  test.skip(({ isMobile }) => !isMobile, 'Bottom tabs are a phone surface');

  test('each tab keeps its own scroll; re-tapping scrolls to the top', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
    await expect(page.getByRole('feed', { name: 'For you' }).getByRole('article').first()).toBeVisible();
    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const y = await scrollTo(page, Math.min(600, Math.max(0, max - 50)));
    expect(y).toBeGreaterThan(100);

    // A new screen starts at the top...
    await mainTabs(page).getByRole('link', { name: 'Jobs' }).click();
    await page.waitForURL(/\/jobs$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);

    // ...and Home, tapped again, is where it was left.
    await mainTabs(page).getByRole('link', { name: 'Home' }).click();
    await page.waitForURL(/\/home$/);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeGreaterThan(y - 30);

    // Tapping the tab you're on goes back to the top.
    await mainTabs(page).getByRole('link', { name: 'Home' }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeLessThan(5);
  });
});

test('the first paint follows the device theme, and a saved choice applies before the app loads', async ({
  browser,
}) => {
  // The HTML is the same for every college; the API is not involved.
  const html = await (await fetch('http://127.0.0.1:4173/')).text();
  expect(html).not.toMatch(/<html[^>]*data-theme/);
  expect(html).toMatch(/<meta name="theme-color" media="\(prefers-color-scheme: light\)"/);
  expect(html).toMatch(/<meta name="theme-color" media="\(prefers-color-scheme: dark\)"/);

  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  await page.evaluate(() => localStorage.setItem('cl:theme', 'dark'));
  // Block the app bundle: only the tiny boot script can set the theme now.
  await page.route(/\/assets\/.*\.js$/, (r) => r.abort());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await ctx.close();
});
