import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations } from './helpers';

/** Build B2: a student joins with only a phone; a minor waits for their guardian. */
const BASE = 'http://dpit.localhost:4173';
let seq = 0;
const newNumber = () => `9${String(Date.now()).slice(-8)}${++seq % 10}`;

/** Reads the newest code the console WhatsApp/SMS provider "sent" to a number (like Mailpit for email). */
/** The console provider's outbox, read from the page (the browser resolves *.localhost). */
const outbox = (page: Page, e164: string) =>
  page.evaluate(
    async (to) =>
      (
        (await (await fetch(`/api/v1/dev/outbox?to=${encodeURIComponent(to)}`)).json()) as {
          data: { params: string[] }[];
        }
      ).data,
    e164,
  );

async function codeFor(page: Page, e164: string, count = 1): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const items = await outbox(page, e164);
    if (items.length >= count) return items[0]?.params[0] ?? '';
    await page.waitForTimeout(250);
  }
  throw new Error(`no code for ${e164}`);
}

async function signUpByPhone(page: Page, number: string, year: number) {
  await page.goto(`${BASE}/sign-up`);
  await expect(page.getByRole('button', { name: 'Mobile number', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Full name').fill('Phone Student (demo)');
  await page.getByLabel('Mobile number').fill(number);
  await page.getByLabel('Month').selectOption({ label: 'June' });
  await page.getByLabel('Year').selectOption(String(year));
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText(/We sent a 6-digit code on WhatsApp/)).toBeVisible();
  await expectNoA11yViolations(page);
  const code = await codeFor(page, `+91${number}`);
  // The sixth digit sends the form.
  await page.getByLabel('6-digit code 1').fill(code[0] ?? '');
  for (let i = 1; i < 6; i++) await page.getByLabel(`6-digit code ${i + 1}`).fill(code[i] ?? '');
}

test('an adult joins with only a mobile number and lands on Home', async ({ page }) => {
  const number = newNumber();
  await signUpByPhone(page, number, new Date().getFullYear() - 20);
  await page.waitForURL(/\/home$/);
  await expect(page.getByText('Your account is read-only for now')).toBeVisible();
});

test('a 16-year-old waits for their guardian, with the reason and the next step', async ({ page }) => {
  const number = newNumber();
  await signUpByPhone(page, number, new Date().getFullYear() - 16);
  await expect(page.getByRole('heading', { name: 'Your guardian’s consent' })).toBeVisible();
  // Not on the college's list yet: their record (and the guardian's number) comes first.
  await expect(page.getByRole('heading', { name: 'First, confirm your college record' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto(`${BASE}/home`);
  await expect(page.getByRole('heading', { name: 'Your guardian’s consent' })).toBeVisible();
});

test('signing in by phone sends a code and opens the app', async ({ page }) => {
  const number = newNumber();
  await signUpByPhone(page, number, new Date().getFullYear() - 22);
  await page.waitForURL(/\/home$/);
  await page.context().clearCookies();
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Mobile number').fill(number);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  // The second code (the first one was for sign-up).
  const code = await codeFor(page, `+91${number}`, 2);
  for (let i = 0; i < 6; i++) await page.getByLabel(`6-digit code ${i + 1}`).fill(code[i] ?? '');
  await page.waitForURL(/\/home$/);
});

test('a minor on the college list joins, and their guardian consents with a code', async ({ page }, info) => {
  // The seed has this fictional first-year in both colleges; each project uses its own college.
  const host = info.project.name === 'mobile' ? 'mrce' : 'dpit';
  const base = `http://${host}.localhost:4173`;
  await page.goto(`${base}/sign-up`);
  await page.getByLabel('Full name').fill('Demo Minor Student');
  await page.getByLabel('Mobile number').fill('9000000016');
  await page.getByLabel('Month').selectOption({ label: 'January' });
  await page.getByLabel('Year').selectOption(String(new Date().getFullYear() - 16));
  await page.getByRole('button', { name: 'Send code' }).click();
  const code = await codeFor(page, '+919000000016');
  for (let i = 0; i < 6; i++) await page.getByLabel(`6-digit code ${i + 1}`).fill(code[i] ?? '');
  // Matched to the record by the proved number, so the guardian's number is known.
  await expect(page.getByRole('heading', { name: 'For your parent or guardian to read' })).toBeVisible();
  await page.getByRole('button', { name: 'తెలుగు' }).click();
  await expect(page.locator('ul[lang="te"]')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: /Send the code to/ }).click();
  const guardianCode = await codeFor(page, '+919000000061');
  for (let i = 0; i < 6; i++) await page.getByLabel(`6-digit code ${i + 1}`).fill(guardianCode[i] ?? '');
  await page.waitForURL(/\/home$/);
  await expect(page.getByRole('heading', { name: 'Your guardian’s consent' })).toHaveCount(0);
});
