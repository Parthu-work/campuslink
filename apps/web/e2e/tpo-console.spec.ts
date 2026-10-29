import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Build B6: targeted, pinned announcements and onboarding progress for the placement cell. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('an announcement for ECE is pinned for its audience and hidden from other branches', async ({
  page,
  browser,
}, info) => {
  const host = hostFor(info.project.name);
  const text = `E2E ECE notice ${info.project.name} ${Date.now()}`;
  await signIn(page, `faculty@${host}.example`, host);
  await page.getByRole('button', { name: 'Share something useful with your college…' }).click();
  await page.getByLabel('Text').fill(text);
  await page.getByText('Mark as an official college announcement').click();
  await page.getByRole('group', { name: 'Branches' }).getByRole('button', { name: 'ECE' }).click();
  await page.getByLabel('Pin to the top of For you').selectOption({ label: 'For 3 days' });
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Posted')).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: text });
  await expect(card.getByText('Pinned')).toBeVisible();
  await expect(card.getByText('For ECE')).toBeVisible();

  // Ananya is in CSE: the announcement is not hers.
  const ctx = await browser.newContext();
  const student = await ctx.newPage();
  await signIn(student, `ananya@${host}.example`, host);
  await expect(student.getByRole('feed', { name: 'For you' })).toBeVisible();
  await expect(student.getByText(text)).toHaveCount(0);
  await ctx.close();
});

test('the placement cell sees onboarding progress by class', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `tpo@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/admin/onboarding`);
  const table = page.getByRole('region', { name: 'Progress by class' });
  await expect(table.getByRole('columnheader', { name: 'On the list' })).toBeVisible();
  await expect(table.getByRole('cell', { name: /ECE · \d{4}/ }).first()).toBeVisible();
  await expectNoA11yViolations(page);
});
