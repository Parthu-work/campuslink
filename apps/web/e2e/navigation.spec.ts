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

/**
 * When a test here fails, record where the app was: an intermittent case once left a tapped job
 * link focused with the URL unchanged, and this tells a pending navigation (progress bar, requests
 * still open) from one that completed and came back (history length).
 */
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const state = await page
    .evaluate(() => ({
      url: location.href,
      historyLength: history.length,
      historyState: history.state as unknown,
      navigationPending: !!document.querySelector('.nav-progress'),
      active: document.activeElement?.outerHTML.slice(0, 160),
      open: performance
        .getEntriesByType('resource')
        .filter((e) => (e as PerformanceResourceTiming).responseEnd === 0)
        .map((e) => e.name),
    }))
    .catch((error: unknown) => ({ error: String(error) }));
  await testInfo.attach('app-state.json', {
    body: JSON.stringify(state, null, 2),
    contentType: 'application/json',
  });
});

/** Taps a bottom tab. After scrolling down the bars are hidden; focusing a tab brings them back. */
const tapTab = async (page: Page, name: string) => {
  const tab = mainTabs(page).getByRole('link', { name, exact: true });
  await tab.focus();
  await expect(page.locator('html')).toHaveAttribute('data-chrome', 'shown');
  await tab.click();
};

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
    await tapTab(page, 'Jobs');
    await page.waitForURL(/\/jobs$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);

    // ...and Home, tapped again, is where it was left.
    await tapTab(page, 'Home');
    await page.waitForURL(/\/home$/);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeGreaterThan(y - 30);

    // Tapping the tab you're on goes back to the top.
    await tapTab(page, 'Home');
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

test('the shell never remounts while moving between screens', async ({ page, isMobile }) => {
  await signIn(page, 'ananya@dpit.example');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.first()).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __shell: Element[] };
    w.__shell = [...document.querySelectorAll('header, nav[aria-label="Main"], main#main')];
  });
  const links = isMobile ? mainTabs(page) : nav.first();
  for (const name of ['Jobs', 'Mentors', 'Home']) {
    await links.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await page.goBack();
  await expect(page).toHaveURL(/\/mentors$/);
  const same = await page.evaluate(() => {
    const w = window as unknown as { __shell: Element[] };
    return w.__shell.every((el) => el.isConnected);
  });
  expect(same).toBe(true);
});

test.describe('scroll-aware chrome and tab memory (phones)', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone chrome');

  test('bars slide away while reading and come back on the way up', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
    await expect(page.getByRole('feed', { name: 'For you' }).getByRole('article').first()).toBeVisible();
    const html = page.locator('html');
    await page.mouse.move(180, 400);
    await page.mouse.wheel(0, 600);
    await expect(html).toHaveAttribute('data-chrome', 'hidden');
    await expect(html).toHaveAttribute('data-scrolled', 'true');
    // Still in the accessibility tree while hidden.
    await expect(mainTabs(page).getByRole('link', { name: 'Jobs' })).toHaveCount(1);
    await page.mouse.wheel(0, -120);
    await expect(html).toHaveAttribute('data-chrome', 'shown');
  });

  test('a tab remembers the screen you left it on; tapping it again goes to its root', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
    await tapTab(page, 'Jobs');
    await page.waitForURL(/\/jobs$/);
    const job = page.locator('a[href^="/jobs/"]:not([href="/jobs/tracker"]):not([href="/jobs/new"])').first();
    await job.click();
    await page.waitForURL(/\/jobs\/[a-f0-9]{24}$/);
    const jobUrl = page.url();
    await tapTab(page, 'Home');
    await page.waitForURL(/\/home$/);
    await tapTab(page, 'Jobs');
    await expect(page).toHaveURL(jobUrl);
    await expect(mainTabs(page).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
    await tapTab(page, 'Jobs');
    await expect(page).toHaveURL(/\/jobs$/);
  });
});

test('Back closes an open sheet instead of leaving the screen', async ({ page, isMobile }) => {
  await signIn(page, 'ananya@dpit.example');
  await page.goto(`${BASE}/jobs`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Search' }).click();
  else await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog');
  await expect(palette).toBeVisible();
  await page.goBack();
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/\/jobs$/);
  // Closing from the UI leaves no extra history entry behind.
  if (isMobile) await page.getByRole('button', { name: 'Search' }).click();
  else await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  // The palette's entry is gone from history before the member's next Back.
  await expect
    .poll(() => page.evaluate(() => (history.state as { usr?: { dialog?: string } } | null)?.usr?.dialog))
    .toBeUndefined();
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
});
