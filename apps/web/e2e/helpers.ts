import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const PASSWORD = 'Demo-Campus-Link-2026';

export async function expectNoA11yViolations(page: Page) {
  // Let data load and entrance animations settle (axe would otherwise measure half-faded text).
  // Infinite ambient loops (the landing mesh) are ignored.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(100);
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

/** Colleges offer the mobile number first (B2); these tests sign in with email and password. */
export async function chooseEmailSignIn(page: Page) {
  const email = page.getByRole('button', { name: 'Email', exact: true });
  const field = page.getByLabel('Email', { exact: true });
  // The platform console has email sign-in only.
  await email.or(field).first().waitFor();
  if (await email.isVisible()) await email.click();
}

/**
 * Where a member starts after signing in (prompt 3, U2): Career (its first section) in the final two
 * years, Learn in the first, their first space otherwise; staff start on Today (`/admin`).
 */
export const START = /\/(home|placements|jobs|roadmaps|study|admin|platform|recruiter)$/;

/**
 * Signs in and ends on Home, where most tests begin. `stay` keeps the member on their own start
 * page instead (the tests of the start page itself).
 */
export async function signIn(page: Page, email: string, host = 'dpit', stay = false) {
  await page.goto(`http://${host}.localhost:4173/sign-in`);
  await chooseEmailSignIn(page);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(START);
  if (stay || /\/home$/.test(page.url())) return;
  // Through the app's own Home tab, not a reload: the shell and its history stay as a member's would.
  await page
    .getByRole('navigation', { name: 'Main' })
    .last()
    .getByRole('link', { name: 'Home', exact: true })
    .first()
    .click();
  await page.waitForURL(/\/home$/);
}
