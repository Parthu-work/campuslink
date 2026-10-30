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
    .locator(':scope > a, :scope > div > button')
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label') ?? e.querySelector('.truncate')?.textContent ?? ''),
    );
};

test.describe('landing route after sign-in', () => {
  for (const [email, path] of [
    ['ananya@dpit.example', '/home'],
    ['rahul@dpit.example', '/home'],
    ['faculty@dpit.example', '/home'],
    ['tpo@dpit.example', '/home'],
  ] as const) {
    test(`${email} lands on ${path}`, async ({ page }) => {
      await signInAs(page, email);
      await page.waitForURL(new RegExp(`${path}$`));
      await expect(page.getByText('We couldn’t find that page')).toHaveCount(0);
    });
  }

  test('a college admin lands on Home after 2FA', async ({ page }) => {
    await adminSignIn(page, 'dpit', 'admin@dpit.example');
    await expect(page).toHaveURL(/\/home$/);
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

test.describe('role-aware bottom tabs (phones)', () => {
  test.skip(({ isMobile }) => !isMobile, 'Bottom tabs are a phone surface');

  test('students and alumni get their own tabs with Create in the middle', async ({ page }) => {
    // Ananya graduates next year: Placements takes the last tab (B7); Jobs is in the menu.
    await signIn(page, 'ananya@dpit.example');
    expect(await bottomTabs(page)).toEqual(['Home', 'Study', 'Create', 'Mentors', 'Placements']);
    await page.context().clearCookies();

    await signIn(page, 'rahul@dpit.example');
    expect(await bottomTabs(page)).toEqual(['Home', 'Requests', 'Create', 'Mentors', 'Jobs']);
  });

  test('profile, settings and sign out live behind the avatar; Back closes the sheet', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
    await page.getByRole('button', { name: /Account menu/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Your account' });
    await expect(sheet.getByRole('link', { name: 'Profile' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/home$/);
  });

  test('Create opens the actions this member may take', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
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

test.describe('desktop rail', () => {
  test.skip(({ isMobile }) => !!isMobile, 'The rail is a desktop surface');

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
  ]) {
    test(`every rail item is reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, 'ananya@dpit.example');
      const rail = page.getByRole('navigation', { name: 'Main' }).first();
      await expect(rail.getByRole('link', { name: 'Home' })).toBeVisible();
      const links = rail.getByRole('link');
      const count = await links.count();
      expect(count).toBeGreaterThan(10);
      for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeInViewport();
      }
      // The account menu stays on screen without scrolling.
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
