import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 2, G3: a student practises an HR interview by typing and reads the report; faculty see the bank. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');
const ANSWER =
  'In my third year our team missed a demo deadline. My task was the backend, so I split the work into daily goals, fixed the slow queries myself, and we shipped two days later. I learned to raise problems early.';

test('a student practises an HR interview and reads the report', async ({ page }, info) => {
  test.slow();
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/interviews`);
  await expect(page.getByRole('heading', { level: 1, name: 'Mock interviews' })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('radio', { name: /^HR/ }).click();
  await page.getByLabel('Length').selectOption('5');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Tell me about yourself.' })).toBeVisible();
  await expectNoA11yViolations(page);

  // Answer every question (and any follow-up) by typing until the report appears.
  for (let i = 0; i < 10; i++) {
    if (await page.getByRole('heading', { name: 'How it went' }).isVisible()) break;
    await page.getByLabel('Your answer').fill(ANSWER);
    await page.getByRole('button', { name: 'Submit answer' }).click();
    // Saved: the box is cleared for the next question, or the report is shown.
    await expect(async () => {
      const report = await page.getByRole('heading', { name: 'How it went' }).isVisible();
      expect(report || (await page.getByLabel('Your answer').inputValue()) === '').toBe(true);
    }).toPass();
  }
  await expect(page.getByRole('heading', { name: 'How it went' })).toBeVisible();
  await expect(page.getByText(/not a pass or fail/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Book a mock interview' })).toBeVisible();
  await expectNoA11yViolations(page);

  // The practice shows in the history.
  await page.goto(`http://${host}.localhost:4173/interviews`);
  await expect(page.getByText('Done').first()).toBeVisible();
});

test('faculty open the interview question bank and add a question', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `faculty@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/admin/interview-questions`);
  await expect(page.getByRole('tab', { name: 'To review' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Add a question' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Topic').fill('Testing');
  await d
    .getByLabel('Question')
    .fill(`What is the difference between unit and integration tests? (${info.project.name})`);
  await d
    .getByLabel('What a good answer covers')
    .fill('Scope, speed, what each catches, one example of each.');
  await d.getByRole('button', { name: 'Add a question' }).click();
  await page.getByRole('tab', { name: 'In the bank' }).click();
  await expect(page.getByText(`(${info.project.name})`)).toBeVisible();
});
