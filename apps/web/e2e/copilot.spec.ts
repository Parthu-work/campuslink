import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/**
 * Prompt 2, G11 (in Ask since prompt 3, U8): a student asks about their career and gets a cited
 * answer from the college's own records with a person to talk to; a prediction is refused; a
 * suggestion is a question, and the command it stands for is never shown as syntax.
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a student gets a cited answer, a refusal for a prediction, and a command result', async ({
  page,
}, info) => {
  test.slow();
  const host = hostFor(info.project.name);
  const base = `http://${host}.localhost:4173`;
  await signIn(page, `ananya@${host}.example`, host);
  // The Copilot's old address opens Ask's Career scope.
  await page.goto(`${base}/copilot`);
  await page.waitForURL(/\/ask\?scope=career$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ask' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Career', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
  await page.waitForURL(/\/ask\?scope=career&s=[a-f0-9]{24}$/);

  // A new conversation: a suggestion is a question; it reads back as one, never as "/eligible".
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.getByRole('button', { name: 'Which drives can I register for?', exact: true }).click();
  await expect(page.getByText('Drives you can register for')).toBeVisible({ timeout: 20_000 });
  const log = page.getByRole('log');
  await expect(log.getByText('Which drives can I register for?')).toBeVisible();
  await expect(page.getByText(/\/eligible/)).toHaveCount(0);
  await expectNoA11yViolations(page);

  // How answers work, in a sheet.
  await page.getByRole('button', { name: 'How answers work' }).click();
  await expect(page.getByRole('dialog', { name: 'How answers work' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The conversations are kept, for this member only, and listed together.
  await page.reload();
  await expect(log.getByText('Which drives can I register for?')).toBeVisible();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'History' }).click();
  await expect(
    page.getByRole('link', { name: /How should I prepare for the Kestrel Analytics/ }).first(),
  ).toBeVisible();
});
