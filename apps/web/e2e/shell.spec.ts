import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('app shell renders with no accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const duration = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--motion-scale').trim(),
  );
  expect(duration).toBe('0');
});

test('language switcher changes to Telugu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /తెలుగు/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'te');
});
