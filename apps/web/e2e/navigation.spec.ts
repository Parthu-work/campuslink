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

    // A new screen starts at the top (Ananya is in her final year: Placements is her last tab)...
    await tapTab(page, 'Placements');
    await page.waitForURL(/\/placements$/);
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
    // The shell's own bars, not a screen's PageHeader (which is a <header> inside <main>).
    w.__shell = [...document.querySelectorAll('header:not(main header), nav[aria-label="Main"], main#main')];
  });
  const links = isMobile ? mainTabs(page) : nav.first();
  // On phones Ananya (final year) has Placements as a tab; the desktop rail lists Jobs.
  for (const name of [isMobile ? 'Placements' : 'Jobs', 'Mentors', 'Home']) {
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
    await expect(mainTabs(page).getByRole('link', { name: 'Placements' })).toHaveCount(1);
    await page.mouse.wheel(0, -120);
    await expect(html).toHaveAttribute('data-chrome', 'shown');
  });

  test('restoring a scrolled position on Back keeps the bars (only the member’s scrolling hides them)', async ({
    page,
  }) => {
    await signIn(page, 'ananya@dpit.example');
    const feed = page.getByRole('feed', { name: 'For you' });
    await expect(feed.getByRole('article').first()).toBeVisible();
    const html = page.locator('html');
    await page.mouse.move(180, 400);
    await page.mouse.wheel(0, 500);
    await expect(html).toHaveAttribute('data-chrome', 'hidden');
    const y = await page.evaluate(() => window.scrollY);
    // Open a post on screen, in the app (a full page load would have nothing to restore).
    const posts = page.locator('main a[href^="/posts/"]');
    for (let i = 0; i < (await posts.count()); i++) {
      const box = await posts.nth(i).boundingBox();
      if (box && box.y > 80 && box.y < 650) {
        await posts.nth(i).click();
        break;
      }
    }
    await page.waitForURL(/\/posts\//);
    await expect(html).toHaveAttribute('data-chrome', 'shown');
    await page.waitForTimeout(1300); // past the window in which scrolling still counts as the member's
    await page.goBack();
    await page.waitForURL(/\/home$/);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeGreaterThan(y - 60);
    await expect(html).not.toHaveAttribute('data-chrome', 'hidden');
    await mainTabs(page).getByRole('link', { name: 'Placements' }).click({ timeout: 3000 });
    await expect(page).toHaveURL(/\/placements$/);
  });

  test('a tab remembers the screen you left it on; tapping it again goes to its root', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
    await tapTab(page, 'Placements');
    await page.waitForURL(/\/placements$/);
    await page.locator('main a[href^="/placements/"]').first().click();
    await page.waitForURL(/\/placements\/[a-f0-9]{24}$/);
    const driveUrl = page.url();
    await tapTab(page, 'Home');
    await page.waitForURL(/\/home$/);
    await tapTab(page, 'Placements');
    await expect(page).toHaveURL(driveUrl);
    await expect(mainTabs(page).getByRole('link', { name: 'Placements' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await tapTab(page, 'Placements');
    await expect(page).toHaveURL(/\/placements$/);
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

test('a screen with a tab row below the fold opens at the top', async ({ page }) => {
  await signIn(page, 'ananya@dpit.example');
  await page.goto(`${BASE}/study`);
  await page
    .getByRole('link', { name: /Formal Languages and Automata Theory/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('tablist').first()).toBeAttached();
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
});

test.describe('pull to refresh (phones)', () => {
  test.skip(({ isMobile }) => !isMobile, 'A touch gesture');

  /** A one-finger drag down the screen through DevTools touch events; `held` runs before release. */
  const pull = async (page: Page, to: number, held: () => Promise<void> = async () => undefined) => {
    const cdp = await page.context().newCDPSession(page);
    const at = (y: number) => [{ x: 180, y }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(220) });
    for (let y = 230; y <= to; y += 15) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y) });
    }
    await held();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };

  test('pulling down at the top refreshes the screen; a short pull and a form do not', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
    await expect(page.getByRole('feed', { name: 'For you' }).getByRole('article').first()).toBeVisible();
    const indicator = page.locator('.pull-indicator');
    await expect(indicator).toBeAttached({ timeout: 10_000 }); // it loads after the first idle period
    let reads = 0;
    page.on('request', (r) => {
      if (/\/api\/v1\/feed\?tab=/.test(r.url())) reads += 1;
    });

    // A short pull springs back without refreshing.
    await pull(page, 280, () => expect(indicator).toHaveAttribute('data-phase', 'pulling'));
    await expect(indicator).toHaveAttribute('data-phase', 'idle');
    await page.waitForTimeout(300);
    expect(reads).toBe(0);

    // A long one refreshes the feed in place, then the ring goes away.
    await pull(page, 560);
    await expect(page.getByRole('status').filter({ hasText: 'Refreshing…' })).toBeAttached();
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(indicator).toHaveAttribute('data-phase', 'idle');
    expect(page.url()).toMatch(/\/home$/);
    await expect(page.getByRole('feed', { name: 'For you' }).getByRole('article').first()).toBeVisible();

    // A form opts out: nothing moves, nothing refetches under someone typing.
    await page.goto(`${BASE}/profile`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(indicator).toBeAttached({ timeout: 10_000 });
    await pull(page, 560, () => expect(indicator).toHaveAttribute('data-phase', 'idle'));
    await expect(page.getByRole('status').filter({ hasText: 'Refreshing…' })).toHaveCount(0);
  });
});
