import { test, expect, type Page, type Route } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Revamp phase 1 (audit ST-0, PW-8): a screen whose code can't load never takes the app down, a
 * stale deploy reloads once (never in a loop), and signing in from two tabs at once never signs
 * the member out.
 */
test.use({ serviceWorkers: 'block' });

const shellIsAlive = async (page: Page) => {
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
};

/** Signs in and waits for the shell, so later steps act on a fully booted app. */
async function ready(page: Page) {
  await signIn(page, 'ananya@dpit.example');
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
}

async function openEvents(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Events' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Main' })
      .first()
      .getByRole('link', { name: 'Events' })
      .click();
  }
}

test('a blocked screen chunk shows a friendly state inside the shell and reloads only once', async ({
  page,
  isMobile,
}) => {
  await ready(page);
  let loads = 0;
  page.on('load', () => (loads += 1));
  // Simulates a deploy that removed the old chunk files: every request for the Events code 404s.
  await page.route(/\/assets\/events-[^/]+\.js$/, (route) => route.fulfill({ status: 404, body: '' }));
  await openEvents(page, !!isMobile);
  await expect(page.getByRole('heading', { name: 'A newer version is ready' })).toBeVisible({
    timeout: 15_000,
  });
  await shellIsAlive(page);
  // One automatic reload at most, then the member decides.
  expect(loads).toBeLessThanOrEqual(1);
  await page.waitForTimeout(1500);
  expect(loads).toBeLessThanOrEqual(1);

  // Once the files are back, Reload opens the screen.
  await page.unroute(/\/assets\/events-[^/]+\.js$/);
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible();
});

test("a screen whose data can't load says so inside the shell, and Retry recovers (ST-2)", async ({
  page,
  isMobile,
}) => {
  await ready(page);
  let fail = true;
  await page.route(/\/api\/v1\/events(\?|$)/, (r: Route) =>
    fail
      ? r.fulfill({ status: 503, body: '{"ok":false,"error":{"code":"INTERNAL","message":"down"}}' })
      : r.fallback(),
  );
  await openEvents(page, isMobile);
  await expect(page.getByRole('alert').getByText('Couldn’t open this screen')).toBeVisible({
    timeout: 15_000,
  });
  await shellIsAlive(page);
  fail = false;
  await page.getByRole('alert').getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a link to something deleted says it is not found, inside the shell', async ({ page }) => {
  await ready(page);
  await page.goto('http://dpit.localhost:4173/events/0123456789abcdef01234567');
  await expect(page.getByText('We couldn’t find that page.')).toBeVisible();
  await shellIsAlive(page);
});

test('offline, an unvisited screen shows the offline state and the shell keeps working', async ({
  page,
  context,
  isMobile,
}) => {
  await ready(page);
  if (isMobile) {
    // This test is about a screen: let the shell's own sheet load first (the next test covers it).
    await page.getByRole('button', { name: /Account menu/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  await context.setOffline(true);
  await openEvents(page, !!isMobile);
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible({ timeout: 15_000 });
  await shellIsAlive(page);
  // Navigation still works for screens already loaded.
  await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await context.setOffline(false);
});

test('a shell menu whose code cannot load offline leaves the shell working and arrives once back online', async ({
  page,
  context,
  isMobile,
}) => {
  // Hold the account menu's code until the connection drops, then fail it.
  const menu = /\/assets\/account-menu-[^/]+\.js$/;
  const held: Route[] = [];
  await page.route(menu, (route) => void held.push(route));
  await ready(page);
  await context.setOffline(true);
  await expect.poll(() => held.length, { timeout: 10_000 }).toBeGreaterThan(0);
  for (const route of held) await route.abort('internetdisconnected');
  await page.waitForTimeout(300);
  await shellIsAlive(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.unroute(menu);
  await context.setOffline(false);
  await page.getByRole('button', { name: /Account menu/ }).click();
  if (isMobile) await expect(page.getByRole('dialog').getByRole('link', { name: 'Events' })).toBeVisible();
  else await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
});

test('two tabs opening at once share the session instead of revoking it (PW-8)', async ({ context }) => {
  const first = await context.newPage();
  await signIn(first, 'ananya@dpit.example');
  // Both tabs boot (and refresh) at the same moment with the same refresh cookie.
  const second = await context.newPage();
  const third = await context.newPage();
  await Promise.all([
    first.reload(),
    second.goto('http://dpit.localhost:4173/jobs'),
    third.goto('http://dpit.localhost:4173/mentors'),
  ]);
  await expect(first).toHaveURL(/\/home$/);
  await expect(second).toHaveURL(/\/jobs$/);
  await expect(third).toHaveURL(/\/mentors$/);
  // The session survived: a later reload still signs in silently.
  await second.reload();
  await expect(second).toHaveURL(/\/jobs$/);
  await expect(second.getByRole('heading', { level: 1 })).toBeVisible();
});

test('closing a tab while it refreshes does not strand the session (PW-8)', async ({ context }) => {
  const first = await context.newPage();
  await signIn(first, 'ananya@dpit.example');
  // A slow phone network: the refresh is still in flight when the tab goes away.
  const closing = await context.newPage();
  const cdp = await context.newCDPSession(closing);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 1200,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  const refreshStarted = closing.waitForRequest(/\/api\/v1\/auth\/refresh$/);
  void closing.goto('http://dpit.localhost:4173/home').catch(() => undefined);
  await refreshStarted;
  await closing.close();
  await first.waitForTimeout(2500);
  // A new tab (and a reload of the old one) still signs in silently.
  const next = await context.newPage();
  await next.goto('http://dpit.localhost:4173/jobs');
  await expect(next).toHaveURL(/\/jobs$/);
  await expect(next.getByRole('heading', { level: 1 })).toBeVisible();
  await first.reload();
  await expect(first).toHaveURL(/\/home$/);
});
