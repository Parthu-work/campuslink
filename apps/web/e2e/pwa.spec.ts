import { test, expect } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Phase 8: the PWA installs (manifest with PNG and maskable icons, a service worker) and shows an offline banner. */
test('installable, registers its worker and reports offline', async ({ page, context }) => {
  await page.goto('/sign-in');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    return href
      ? ((await (await fetch(href)).json()) as { name: string; icons: { sizes: string; purpose: string }[] })
      : null;
  });
  // Each college installs under its own name (audit PW-3).
  expect(manifest?.name).toBe('Deccan Plateau Institute of Technology');
  expect(manifest?.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', purpose: 'any' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]),
  );
  const touchIcon = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href;
    return href ? (await fetch(href)).headers.get('content-type') : null;
  });
  expect(touchIcon).toContain('image/png');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);

  await context.setOffline(true);
  const banner = page.getByRole('status').filter({ hasText: 'You’re offline' });
  await expect(banner).toBeVisible();
  await expectNoA11yViolations(page);
  await context.setOffline(false);
  await expect(banner).toBeHidden();
});

/** The production CSP (served by vite preview from deploy/nginx) blocks nothing the app needs. */
test('the app runs under the production CSP without violations', async ({ page }) => {
  test.setTimeout(90_000);
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto('/sign-in');
  expect(res?.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(res?.headers()['x-frame-options']).toBe('DENY');
  await signIn(page, 'ananya@dpit.example', 'dpit');
  for (const path of [
    '/home',
    '/people',
    '/messages',
    '/jobs',
    '/roadmaps',
    '/events',
    '/progress',
    '/mentors',
    '/sessions',
    '/settings/data',
  ]) {
    await page.goto(`http://dpit.localhost:4173${path}`);
    await page.waitForLoadState('networkidle');
  }
  expect(violations).toEqual([]);
});
