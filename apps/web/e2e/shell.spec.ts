import { test, expect, type Page } from '@playwright/test';
import { PASSWORD, signIn, chooseEmailSignIn } from './helpers';
import { adminSignIn } from './admin';

/**
 * Revamp phase 1: every role lands on its own home, navigation is role-aware, the desktop rail
 * scrolls on its own with the account menu always visible, and deep links survive sign-in.
 */
const BASE = 'http://dpit.localhost:4173';

async function signInAs(page: Page, email: string) {
  await page.goto(`${BASE}/sign-in`);
  await chooseEmailSignIn(page);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

const bottomTabs = async (page: Page) => {
  await expect(page.getByRole('navigation', { name: 'Main' }).last().getByRole('link').first()).toBeVisible();
  return page
    .getByRole('navigation', { name: 'Main' })
    .last()
    .getByRole('link')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
};

test.describe('landing route after sign-in (prompt 3, U2)', () => {
  for (const [email, path] of [
    // Final year: Career, which opens on Placements.
    ['ananya@dpit.example', '/placements'],
    ['rahul@dpit.example', '/home'],
    // Staff start in Today.
    ['faculty@dpit.example', '/admin'],
    ['tpo@dpit.example', '/admin'],
  ] as const) {
    test(`${email} lands on ${path}`, async ({ page }) => {
      await signInAs(page, email);
      await page.waitForURL(new RegExp(`${path}$`));
      await expect(page.getByText('We couldn’t find that page')).toHaveCount(0);
    });
  }

  test('a college admin lands on Today after 2FA', async ({ page }) => {
    await adminSignIn(page, 'dpit', 'admin@dpit.example');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('the platform admin lands on the console, not "page not found" (IA-10)', async ({ page }) => {
    await adminSignIn(page, 'admin', 'superadmin@campuslink.example');
    await expect(page).toHaveURL(/\/platform$/);
    await expect(page.getByText('We couldn’t find that page')).toHaveCount(0);
  });

  test('a deep link survives sign-in (IA-8)', async ({ page }) => {
    await page.goto(`${BASE}/jobs?type=internship`);
    await page.waitForURL(/\/sign-in$/);
    await chooseEmailSignIn(page);
    await page.getByLabel('Email', { exact: true }).fill('ananya@dpit.example');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(/\/jobs\?type=internship$/);
  });
});

test.describe('five spaces as bottom tabs (phones)', () => {
  test.skip(({ isMobile }) => !isMobile, 'Bottom tabs are a phone surface');

  test('students, alumni and staff each get their five spaces', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
    expect(await bottomTabs(page)).toEqual(['Home', 'Learn', 'Mentors', 'Career', 'You']);
    await page.context().clearCookies();

    await signIn(page, 'rahul@dpit.example');
    expect(await bottomTabs(page)).toEqual(['Home', 'Mentoring', 'Jobs', 'Community', 'You']);
    await page.context().clearCookies();

    await signIn(page, 'tpo@dpit.example', 'dpit', true);
    expect(await bottomTabs(page)).toEqual(['Today', 'Students', 'Placements', 'Content', 'College']);
  });

  test('profile, settings, help and sign out live behind the avatar; Back closes the sheet', async ({
    page,
  }) => {
    await signIn(page, 'ananya@dpit.example');
    await page.getByRole('button', { name: /Account menu/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Your account' });
    await expect(sheet.getByRole('link', { name: 'Profile' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Help' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/home$/);
  });

  test('Create floats on Home only, and opens the actions this member may take', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
    await page.goto(`${BASE}/mentors`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create' })).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Main' }).last().getByRole('link', { name: 'Home' }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    const sheet = page.getByRole('dialog', { name: 'Create something' });
    await expect(sheet.getByRole('link', { name: /Ask a question/ })).toBeVisible();
    await expect(sheet.getByRole('link', { name: /Write a post/ })).toHaveCount(0);
    await sheet.getByRole('link', { name: /Ask a question/ }).click();
    await expect(page.getByRole('dialog', { name: 'Ask a question' })).toBeVisible();
    // Back from the form returns to where Create was opened, not to the sheet.
    await page.goBack();
    await expect(page).toHaveURL(/\/home$/);
  });
});

test.describe('desktop sidebar (prompt 3, U2)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'The sidebar is a desktop surface');

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
  ]) {
    test(`the sidebar fits without scrolling at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, 'ananya@dpit.example');
      const bar = page.getByRole('navigation', { name: 'Main' }).first();
      // Create, Search and the five spaces: never more than seven entries at the top level.
      const top = await bar.locator(':scope > div > button, :scope > div > ul > li > a').count();
      expect(top).toBeLessThanOrEqual(7);
      // The open space (Home, which has the most sections) lists them under it; nothing scrolls.
      await expect(bar.getByRole('link', { name: 'Events', exact: true })).toBeVisible();
      // Its list area has room for everything: nothing to scroll.
      const list = bar.locator(':scope > div').first();
      const fits = await list.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
      expect(fits).toBe(true);
      const links = bar.getByRole('link');
      for (let i = 0; i < (await links.count()); i++) await expect(links.nth(i)).toBeInViewport();
      // The account menu stays on screen.
      const account = page.getByRole('button', { name: /Account menu/ });
      await expect(account).toBeInViewport();
      await account.click();
      await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
    });
  }
});

test('the landing page shows no people or invented social proof (D3)', async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const name of ['Rahul Varma', 'Sneha Reddy', 'Meghana Sharma']) {
    await expect(page.getByText(name)).toHaveCount(0);
  }
  await expect(page.locator('[aria-label*="alumni" i]')).toHaveCount(0);
});
