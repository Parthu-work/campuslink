import { test, expect } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';
import { adminSignIn } from './admin';

test.describe('landing', () => {
  test('applies each college’s branding and passes axe in both themes', async ({ page }) => {
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('your classrooms');
      await expect(page.getByText('Deccan Plateau Institute of Technology').first()).toBeVisible();
      await expectNoA11yViolations(page);
    }
    await page.goto('http://mrce.localhost:4173/');
    await expect(page.getByText('Musi Riverfront College of Engineering').first()).toBeVisible();
    // The palette is generated from the college's own hue (ADR 0008): MRCE's emerald is 162.8°.
    const brand = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
    );
    const hue = Number(/^oklch\([\d.]+ [\d.]+ ([\d.]+)\)$/.exec(brand)?.[1]);
    expect(Math.abs(hue - 162.8)).toBeLessThan(1);
  });

  test('switches to Telugu and respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('button', { name: 'తెలుగు' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'te');
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--motion-scale').trim(),
      ),
    ).toBe('0');
  });

  test('unknown subdomains get a clear message', async ({ page }) => {
    await page.goto('http://nowhere.localhost:4173/');
    await expect(page.getByRole('heading', { name: 'No college lives at this address' })).toBeVisible();
  });
});

test.describe('sign-up', () => {
  test('creates an account by email and asks to confirm it', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByRole('button', { name: 'Email', exact: true }).click();
    await expectNoA11yViolations(page);
    await page.getByLabel('Full name').fill('E2E Student');
    await page.getByLabel('Email', { exact: true }).fill(`e2e-${Date.now()}@dpit.example`);
    await page.getByLabel('Password', { exact: true }).fill('saffron-orbit-meadow-77');
    await page.getByLabel('Month').selectOption({ label: 'April' });
    await page.getByLabel('Year').selectOption('2000');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' }).first()).toBeVisible();
  });

  test('asks for the birth month on the client too', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByRole('button', { name: 'Email', exact: true }).click();
    await page.getByLabel('Full name').fill('Young Person');
    await page.getByLabel('Email', { exact: true }).fill('young@dpit.example');
    await page.getByLabel('Password', { exact: true }).fill('saffron-orbit-meadow-77');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Choose the month and year you were born')).toBeVisible();
  });
});

test.describe('signed-in journeys', () => {
  test('an unverified student gets a read-only home and keeps the session on reload', async ({ page }) => {
    await signIn(page, 'newbie@dpit.example');
    await expect(page.getByText('Your account is read-only for now')).toBeVisible();
    await expectNoA11yViolations(page);
    await page.reload();
    await expect(page.getByText('Your account is read-only for now')).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByText('You don’t have access to this page.')).toBeVisible();
    // A page that verification unlocks says so and offers the way forward (audit IA-7).
    await page.goto('/mentors');
    await expect(page.getByRole('heading', { name: 'Verify your account to open this' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Verify now' })).toBeVisible();
  });

  test('a session on one college does not exist on another (host-only cookies)', async ({ page }) => {
    await signIn(page, 'ananya@dpit.example');
    await expect(page.getByRole('heading', { name: 'Hi, Ananya' })).toBeVisible();
    await page.goto('http://mrce.localhost:4173/home');
    await expect(page).toHaveURL(/mrce\.localhost:4173\/sign-in/);
  });

  test('a college admin must enrol in 2FA, then can manage people and branding', async ({ page }, info) => {
    // Each project enrols a different admin (the seed has one per college).
    const host = info.project.name === 'mobile' ? 'mrce' : 'dpit';
    test.setTimeout(90_000); // may wait for a fresh TOTP step
    // Enrols on first sign-in (or answers the TOTP prompt if another spec enrolled first).
    await adminSignIn(page, host, `admin@${host}.example`);

    // Admin opens on what is waiting; the sections are a side menu (desktop) or a list (phones).
    await page.goto(`http://${host}.localhost:4173/admin`);
    await expect(page.getByRole('heading', { name: 'What’s waiting' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Active members/ })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('link', { name: 'Members', exact: true }).click();
    await page.waitForURL(/\/admin\/users$/);
    await expect(page.getByText('Srinivas Murthy')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
    await expectNoA11yViolations(page);
    if (info.project.name === 'mobile') await page.getByRole('link', { name: 'Overview' }).click();
    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByText('auth.mfa_enabled')).toBeVisible();

    // Branding: a logo replaces the monogram everywhere, and removing it brings the monogram back.
    await page.goto(`http://${host}.localhost:4173/admin/branding`);
    await page.getByLabel('Upload logo').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect(page.getByText('Logo updated')).toBeVisible();
    // The shell's crest (decorative, so no alt text) on the rail or the phone top bar.
    await expect(page.locator('img[alt=""][src^="/api/v1/tenant/logo"]:visible').first()).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Remove logo' }).click();
    await expect(page.getByText(/Logo removed/)).toBeVisible();
    await expect(page.locator('img[src^="/api/v1/tenant/logo"]')).toHaveCount(0);
  });

  test('settings: preferences and privacy are keyboard reachable and accessible', async ({ page }) => {
    await signIn(page, 'rahul@dpit.example');
    await page.goto('/settings/privacy');
    await expect(page.getByRole('heading', { name: 'Your consent choices' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto('/settings/preferences');
    await page.getByRole('radio', { name: 'Light' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectNoA11yViolations(page);
  });
});
