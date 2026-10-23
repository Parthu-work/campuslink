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

test('staging: study material is processed by the worker (the API only queues it)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill('faculty@dpit.example');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/home$/);
  await page.goto('/study');
  await page.getByRole('button', { name: 'New subject' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New subject' });
  await dialog.getByLabel('Subject name').fill(`Staging demo ${Date.now() % 100000}`);
  await dialog.getByLabel('Code').fill(`STG${Date.now() % 100000}`);
  await dialog.getByRole('button', { name: 'Create subject' }).click();
  await page.waitForURL(/\/study\/[a-f0-9]{24}$/);
  await page.getByRole('button', { name: 'Add material' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add material' });
  await sheet.locator('input[type="file"][multiple]').setInputFiles({
    name: 'staging-demo-notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Demo notes\n\nA finite automaton reads its input one symbol at a time (demo text).\n',
    ),
  });
  await sheet.getByText('I have the right to share these files').click();
  await sheet.getByRole('button', { name: 'Upload 1 file' }).click();
  // Scanned by ClamAV and stored in S3 by the API, then extracted and chunked by the worker.
  await expect(sheet.getByRole('status').filter({ hasText: 'Ready' })).toHaveCount(1, { timeout: 120_000 });
});
