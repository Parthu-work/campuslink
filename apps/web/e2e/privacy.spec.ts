import { test, expect } from '@playwright/test';
import { expectNoA11yViolations, PASSWORD, signIn } from './helpers';

/** Phase 8: a member downloads their data, schedules deletion, signs back in and cancels it. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('export my data, schedule deletion and cancel it', async ({ page }, info) => {
  test.setTimeout(90_000);
  const host = hostFor(info.project.name);
  const base = `http://${host}.localhost:4173`;
  const email = `arjun@${host}.example`;
  await signIn(page, email, host);
  await page.goto(`${base}/settings/data`);
  await expect(page.getByRole('heading', { name: 'Download your data' })).toBeVisible();
  await expectNoA11yViolations(page);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download my data' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe('my-data.json');

  await page.getByRole('button', { name: 'Delete my account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await expectNoA11yViolations(page);
  await dialog.getByRole('button', { name: 'Delete my account' }).click();
  await page.waitForURL(/sign-in/);

  await signIn(page, email, host);
  await expect(page.getByRole('alert').filter({ hasText: 'scheduled for deletion' })).toBeVisible();
  await page.getByRole('link', { name: 'Cancel deletion' }).click();
  await page.getByRole('button', { name: 'Cancel deletion' }).click();
  await expect(page.getByText('Deletion cancelled. Welcome back.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible();
});
