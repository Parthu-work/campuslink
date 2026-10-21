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

export async function signIn(page: Page, email: string, host = 'dpit') {
  await page.goto(`http://${host}.localhost:4173/sign-in`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/home$/);
}
