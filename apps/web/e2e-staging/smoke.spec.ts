import { test, expect } from '@playwright/test';

/** One pass over the production images and adapters (see playwright.staging.config.ts). */
const PASSWORD = 'Demo-Campus-Link-2026';
// A 4×4 PNG (DEMO avatar).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGOw3/EMjhiI4wAA/QId0ereQ8sAAAAASUVORK5CYII=',
  'base64',
);

test('staging: dependencies, headers, sign-in, upload through ClamAV and S3', async ({ page }) => {
  test.setTimeout(120_000);
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });

  const res = await page.goto('/sign-in');
  const h = res?.headers() ?? {};
  expect(h['content-security-policy']).toContain("script-src 'self' https://challenges.cloudflare.com");
  expect(h['content-security-policy']).toContain('upgrade-insecure-requests');
  expect(h['strict-transport-security']).toContain('max-age=63072000');
  expect(h['x-frame-options']).toBe('DENY');

  // Every dependency is ready, including the scanner and the bucket.
  const ready = await page.evaluate(async () => (await fetch('/api/v1/ready')).json());
  expect(ready).toMatchObject({
    ok: true,
    data: { status: 'ready', checks: { mongo: true, redis: true, clamav: true, storage: true } },
  });
  const apiHeaders = await page.evaluate(async () => {
    const r = await fetch('/api/v1/health');
    return {
      hsts: r.headers.get('strict-transport-security'),
      csp: r.headers.get('content-security-policy'),
    };
  });
  expect(apiHeaders.hsts).toContain('max-age=');
  expect(apiHeaders.csp).toContain("default-src 'none'");

  await page.getByLabel('Email', { exact: true }).fill('ananya@dpit.example');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/home$/);
  await expect(page.getByRole('feed', { name: 'For you' })).toBeVisible();

  // A photo goes through sniffing, re-encoding, ClamAV and S3, then back out through the API.
  await page.goto('/profile');
  await page
    .getByLabel('Change photo')
    .setInputFiles({ name: 'demo.png', mimeType: 'image/png', buffer: PNG });
  const avatar = page.locator('main img[src^="blob:"]').first();
  await expect(avatar).toBeVisible({ timeout: 30_000 });
  expect(await avatar.evaluate((img: HTMLImageElement) => img.naturalWidth > 0)).toBe(true);

  // The PWA installs over HTTPS.
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe('https://dpit.localhost:8443/');
  expect(violations).toEqual([]);
});
