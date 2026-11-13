import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Five spaces (prompt 3, U2): a deep link lights the space that owns it, whatever was pressed
 * before; the tab labels fit untruncated in every language; one inbox; search reaches companies.
 */
const BASE = 'http://dpit.localhost:4173';

/** Expects the space whose tab (phone) or sidebar entry (desktop) is lit to be `space`. */
const expectLit = async (page: Page, isMobile: boolean, space: string, what = '') => {
  const lit = isMobile
    ? page.locator('nav.chrome-bottom > a[aria-current]')
    : page.locator('nav.app-rail > div > ul > li > a[aria-current]');
  await expect(lit, what).toHaveCount(1);
  await expect(lit, what).toHaveText(space);
};

/** The first link on a list screen whose address starts with `prefix` (an id from the demo data). */
const firstLink = async (page: Page, list: string, prefix: string, not: string[] = [], tab?: string) => {
  await page.goto(`${BASE}${list}`);
  if (tab)
    await page
      .getByRole('tab', { name: tab })
      .or(page.getByRole('button', { name: tab }))
      .first()
      .click();
  const sel = [`main a[href^="${prefix}"]`, ...not.map((n) => `:not([href="${n}"])`)].join('');
  const link = page.locator(sel).first();
  await expect(link).toBeAttached();
  return (await link.getAttribute('href')) ?? '';
};

test('ten deep links each light the space that owns them', async ({ page, isMobile }) => {
  await signIn(page, 'ananya@dpit.example');
  const drive = await firstLink(page, '/placements', '/placements/');
  // Ananya is in no circle yet: one she can join.
  const circle = await firstLink(page, '/circles', '/circles/', [], 'Discover');
  const thread = await firstLink(page, '/messages', '/messages/');
  const job = await firstLink(page, '/jobs', '/jobs/', ['/jobs/tracker', '/jobs/new']);
  const links: [string, string][] = [
    ['/roadmaps/sde-dsa', 'Learn'],
    [drive, 'Career'],
    ['/companies/nimbus%20labs', 'Career'],
    ['/readiness', 'Career'],
    [circle, 'Home'],
    [thread, 'Mentors'],
    ['/sessions', 'Mentors'],
    [job, 'Career'],
    ['/settings/privacy', 'You'],
  ];
  for (const [path, space] of links) {
    // A full load, as from a notification or a shared link: nothing pressed before counts.
    await page.goto(`${BASE}${path}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectLit(page, isMobile, space, path);
  }
  await page.context().clearCookies();

  // The tenth: a staff member's admin section is a section of one of their spaces.
  await signIn(page, 'tpo@dpit.example', 'dpit', true);
  await page.goto(`${BASE}/admin/onboarding`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectLit(page, isMobile, 'Students');
});

test('Back lights the space of the screen it returns to', async ({ page, isMobile }) => {
  await signIn(page, 'ananya@dpit.example');
  await page.goto(`${BASE}/roadmaps/sde-dsa`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const bar = page.getByRole('navigation', { name: 'Main' });
  await (isMobile ? bar.last() : bar.first())
    .getByRole('link', { name: 'Mentors', exact: true })
    .first()
    .click();
  await page.waitForURL(/\/mentors$/);
  await expectLit(page, isMobile, 'Mentors');
  await page.goBack();
  await page.waitForURL(/\/roadmaps\/sde-dsa$/);
  await expectLit(page, isMobile, 'Learn');
});

test.describe('phones', () => {
  test.skip(({ isMobile }) => !isMobile, 'Bottom tabs and the section row are phone surfaces');

  for (const lang of ['en', 'te', 'hi'] as const)
    test(`tab labels fit at 360 px without being cut (${lang})`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await signIn(page, 'ananya@dpit.example');
      await page.evaluate((l) => localStorage.setItem('cl:lang', l), lang);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      const tabs = page.locator('nav.chrome-bottom > a');
      await expect(tabs).toHaveCount(5);
      const cut = await tabs.evaluateAll((els) =>
        els
          .map((a) => {
            const label = a.lastElementChild as HTMLElement;
            const box = a.getBoundingClientRect();
            const text = label.getBoundingClientRect();
            return text.left < box.left - 0.5 || text.right > box.right + 0.5 ? label.textContent : null;
          })
          .filter(Boolean),
      );
      expect(cut).toEqual([]);
    });

  test('a space lists its sections under the top bar; the one open is marked', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
    await page.goto(`${BASE}/jobs`);
    const row = page.getByRole('navigation', { name: 'Career sections' });
    await expect(row.getByRole('link', { name: 'Jobs', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await row.getByRole('link', { name: 'Readiness', exact: true }).click();
    await page.waitForURL(/\/readiness$/);
    await expect(row.getByRole('link', { name: 'Readiness', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test('one inbox: one entry and count, notifications and messages a switch apart', async ({ page }) => {
  await signIn(page, 'ananya@dpit.example');
  const inbox = page.getByRole('link', { name: /^Inbox/ }).first();
  await expect(inbox).toBeVisible();
  await inbox.click();
  await page.waitForURL(/\/notifications$/);
  const switcher = page.getByRole('navigation', { name: 'Inbox' });
  await switcher.getByRole('link', { name: 'Messages' }).click();
  await page.waitForURL(/\/messages$/);
  await switcher.getByRole('link', { name: 'Notifications' }).click();
  await page.waitForURL(/\/notifications$/);
});

test('search reaches companies, and remembers what was opened', async ({ page, isMobile }) => {
  await signIn(page, 'ananya@dpit.example');
  if (isMobile) await page.getByRole('button', { name: 'Search' }).click();
  else await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill('nimbus');
  const company = palette.getByRole('option', { name: /Nimbus Labs/ }).first();
  await expect(company).toBeVisible();
  await company.click();
  await page.waitForURL(/\/companies\//);
  if (isMobile) await page.getByRole('button', { name: 'Search' }).click();
  else await page.keyboard.press('Control+k');
  await expect(
    palette.getByRole('group', { name: 'Recent' }).getByRole('option', { name: /Nimbus Labs/ }),
  ).toBeVisible();
});
