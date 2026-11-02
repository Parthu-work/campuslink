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

export async function signIn(page: Page, email: string, host = 'dpit') {
  await page.goto(`http://${host}.localhost:4173/sign-in`);
  await chooseEmailSignIn(page);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/home$/);
}
