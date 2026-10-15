import { test, expect } from '@playwright/test';
import { generate } from 'otplib';
import { expectNoA11yViolations, PASSWORD, signIn } from './helpers';

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
    const brand = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
    );
    expect(brand).toBe('#22b07d');
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
  test('creates an account and asks to confirm the email', async ({ page }) => {
    await page.goto('/sign-up');
    await expectNoA11yViolations(page);
    await page.getByLabel('Full name').fill('E2E Student');
    await page.getByLabel('Email', { exact: true }).fill(`e2e-${Date.now()}@dpit.example`);
    await page.getByLabel('Password', { exact: true }).fill('saffron-orbit-meadow-77');
    await page.getByText('I am 18 or older.').click();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' }).first()).toBeVisible();
  });

  test('blocks under-18 sign-ups on the client too', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByLabel('Full name').fill('Young Person');
    await page.getByLabel('Email', { exact: true }).fill('young@dpit.example');
    await page.getByLabel('Password', { exact: true }).fill('saffron-orbit-meadow-77');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('You must be 18 or older to join')).toBeVisible();
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
    await page.goto(`http://${host}.localhost:4173/sign-in`);
    await page.getByLabel('Email', { exact: true }).fill(`admin@${host}.example`);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Turn on two-factor authentication' })).toBeVisible();
    const secret = (await page.locator('code').innerText()).replace(/\s/g, '');
    await page.getByLabel('Enter your 6-digit code 1').click();
    await page.keyboard.type(await generate({ secret }));
    await page.getByRole('button', { name: 'Turn on 2FA' }).click();
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await page.getByRole('button', { name: 'I’ve saved these codes' }).click();

    await page.goto(`http://${host}.localhost:4173/admin`);
    await expect(page.getByText('Srinivas Murthy')).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByText('auth.mfa_enabled')).toBeVisible();
  });

  test('settings: preferences and privacy are keyboard reachable and accessible', async ({ page }) => {
    await signIn(page, 'rahul@dpit.example');
    await page.goto('/settings/privacy');
    await expect(page.getByRole('heading', { name: 'Your consent choices' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto('/settings/preferences');
    await page.getByRole('button', { name: 'Light' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectNoA11yViolations(page);
  });
});
