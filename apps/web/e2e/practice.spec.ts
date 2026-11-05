import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 2, G4: a student does today's practice set; faculty add a question to the bank. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a student does today\x27s practice set and sees the summary', async ({ page }, info) => {
  test.slow();
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/practice`);
  await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Today\x27s practice' })).toBeVisible();
  await expectNoA11yViolations(page);

  // A database kept from an earlier local run may already have today's set done.
  const review = page.getByRole('link', { name: 'Look back at today\x27s answers' });
  if (await review.isVisible()) await review.click();
  else await page.getByRole('button', { name: /Start today.s set|Continue/ }).click();
  await expect(page.getByRole('progressbar', { name: 'Progress' })).toBeVisible();

  for (let i = 0; i < 12; i++) {
    if (await page.getByRole('heading', { name: 'Set finished' }).isVisible()) break;
    if (i === 0) await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Show the answer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Here is the answer' })).toBeVisible();
    if (i === 0) await expectNoA11yViolations(page);
    await page.getByRole('button', { name: /Next question|See how you did/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Set finished' })).toBeVisible();
  await expect(page.getByText(/of \d+ right/)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('link', { name: 'Back to practice' }).click();
  await expect(page.getByText('Done for today. Come back tomorrow.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Your accuracy by topic' })).toBeVisible();
});

test('faculty add a practice question to the bank', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  const marker = `(${info.project.name} ${Date.now()})`;
  await signIn(page, `faculty@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/admin/practice`);
  await expect(page.getByRole('tab', { name: 'To review' })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Add question' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Question', { exact: true }).fill(`What is 20% of 150? ${marker}`);
  await d.getByLabel('Option 1', { exact: true }).fill('30');
  await d.getByLabel('Option 2', { exact: true }).fill('20');
  await d.getByLabel('Option 3', { exact: true }).fill('15');
  await d.getByLabel('Option 4', { exact: true }).fill('35');
  await d.getByLabel('Explanation').fill('20% is a fifth, and 150 / 5 = 30.');
  await expectNoA11yViolations(page);
  await d.getByRole('button', { name: 'Add question' }).click();
  await expect(d).toBeHidden();

  await page.getByRole('tab', { name: 'In use' }).click();
  await expect(page.getByText(marker)).toBeVisible();
});
