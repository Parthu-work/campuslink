import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/**
 * Prompt 2, G11: a student asks the Career Copilot and gets a cited answer from the college's own
 * records with a person to talk to; a prediction is refused; a command lists eligible drives.
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a student gets a cited answer, a refusal for a prediction, and a command result', async ({
  page,
}, info) => {
  test.slow();
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/copilot`);
  await expect(page.getByRole('heading', { level: 1, name: 'Career Copilot' })).toBeVisible();
  await expectNoA11yViolations(page);

  const box = page.getByLabel('Your question');
  await box.fill('How should I prepare for the Kestrel Analytics data analyst drive?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('Sources', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /Kestrel Analytics/ }).first()).toBeVisible();
  await expect(page.getByText('Talk to a person')).toBeVisible();
  await expectNoA11yViolations(page);

  await box.fill('What salary will I get at Kestrel Analytics?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText(/can’t predict salaries/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: '/eligible: drives I can register for' }).click();
  await expect(box).toHaveValue('/eligible ');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('Drives you can register for')).toBeVisible({ timeout: 20_000 });
  await expectNoA11yViolations(page);

  // The conversation is kept, for this member only.
  await page.reload();
  await expect(page.getByText('What salary will I get at Kestrel Analytics?')).toBeVisible();
});
