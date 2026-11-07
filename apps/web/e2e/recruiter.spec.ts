import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { generate } from 'otplib';
import { chooseEmailSignIn, expectNoA11yViolations, PASSWORD } from './helpers';
import { adminSignIn } from './admin';

/**
 * Prompt 2, G12 (ADR 0014): the recruiter portal of the seeded DEMO employer, a company applying
 * on the platform host, and the platform's employer registry.
 */
const STORE = 'test-results/.employer-totp.json';
const RECRUITER = 'recruiter@demo-employer.example';

/** Recruiters must use TOTP: the first sign-in enrols (and stores the secret), later ones reuse it. */
async function recruiterSignIn(page: Page) {
  await page.goto('http://emp-demo.localhost:4173/sign-in');
  await chooseEmailSignIn(page);
  await page.getByLabel('Email', { exact: true }).fill(RECRUITER);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const enrol = page.getByRole('heading', { name: 'Turn on two-factor authentication' });
  const prompt = page.getByRole('heading', { name: 'Enter your 6-digit code' });
  await expect(enrol.or(prompt)).toBeVisible();
  const read = (): { secret: string; step: number } | null => {
    try {
      return JSON.parse(readFileSync(STORE, 'utf8')) as { secret: string; step: number };
    } catch {
      return null;
    }
  };
  const saved = read();
  const remember = (secret: string) => {
    mkdirSync('test-results', { recursive: true });
    writeFileSync(STORE, JSON.stringify({ secret, step: Math.floor(Date.now() / 30_000) }));
  };
  if (await enrol.isVisible()) {
    const secret = (await page.locator('code').innerText()).replace(/\s/g, '');
    remember(secret);
    await page.getByLabel('Enter your 6-digit code 1').click();
    await page.keyboard.type(await generate({ secret }));
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await page.getByRole('button', { name: 'I’ve saved these codes' }).click();
  } else {
    if (!saved) throw new Error('No stored TOTP secret for the demo recruiter; reseed the database');
    while (Math.floor(Date.now() / 30_000) <= saved.step) await page.waitForTimeout(1000);
    remember(saved.secret);
    await page.getByLabel('Enter your 6-digit code 1').click();
    await page.keyboard.type(await generate({ secret: saved.secret }));
  }
  await page.waitForURL(/\/recruiter$/);
}

test('the demo employer writes a posting, counts the pool and manages its recruiters', async ({ page }) => {
  await recruiterSignIn(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Recruiting' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'New posting' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill('DEMO Graduate Engineer Trainee');
  await dialog.getByLabel('Role').fill('Software Engineer');
  await dialog.getByLabel('Location').fill('Hyderabad');
  await dialog
    .getByLabel('Description')
    .fill('DEMO: build services with our team. Two rounds: coding and an interview.');
  await expectNoA11yViolations(page);
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'DEMO Graduate Engineer Trainee' }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Pool' }).click();
  await page.getByRole('button', { name: 'Count', exact: true }).click();
  await expect(page.getByText(/students$/).first()).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('tab', { name: 'Company' }).click();
  await expect(page.getByText('Demo Employer Private Limited (fictional)')).toBeVisible();
  await expect(page.getByText('Approved')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('a company applies on the platform host, and the platform reviews employers', async ({ page }) => {
  await page.goto('http://admin.localhost:4173/employers/apply');
  await expect(page.getByRole('heading', { level: 1, name: /Hire through/ })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByLabel('Company domain').fill('gmail.com');
  await page.getByLabel('GSTIN').fill('36AABCA1234B1ZZ');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Use your company’s own domain, not a mail provider.')).toBeVisible();
  await expect(page.getByText('This is not a valid GSTIN.')).toBeVisible();
  await expectNoA11yViolations(page);

  await adminSignIn(page, 'admin', 'superadmin@campuslink.example');
  await page.goto('http://admin.localhost:4173/platform/employers');
  await expect(page.getByRole('heading', { level: 1, name: 'Employers' })).toBeVisible();
  await page.getByRole('radio', { name: 'Approved' }).click();
  await expect(page.getByText('Demo Employer (demo)')).toBeVisible();
  await expectNoA11yViolations(page);
});
