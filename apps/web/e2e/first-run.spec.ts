import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

const BASE = 'http://dpit.localhost:4173';

/** Prompt 3, U4: "Set up your CampusLink" on a student's Home, each item from real data. */
test('a student’s set-up checklist: done items say what changed, one tap opens the rest, and it hides', async ({
  page,
}) => {
  await signIn(page, 'ananya@dpit.example');
  const checklist = page.getByRole('region', { name: 'Set up your CampusLink' });
  await expect(page.getByRole('heading', { name: 'Set up your CampusLink' })).toBeVisible();
  // The seed: Ananya follows a path and has asked a senior, but has not picked a goal.
  await expect(checklist.getByText(/^Following /)).toBeVisible();
  await expect(checklist.getByText(/^You asked /)).toBeVisible();
  await expect(checklist.getByText(/of [34] done$/)).toBeVisible();
  await expectNoA11yViolations(page);

  // One tap: the goals sheet opens on Mentors (nothing is saved here).
  await checklist.getByRole('link', { name: /Pick your goal/ }).click();
  await expect(page).toHaveURL(/\/mentors\?goals=1$/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  // Hidden on this device, also after a reload.
  await page.goto(`${BASE}/home`);
  await page.getByRole('button', { name: 'Hide set-up steps' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your CampusLink' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Set up your CampusLink' })).toHaveCount(0);
});

test('an unverified member sees the verify card, not the set-up checklist', async ({ page }) => {
  await signIn(page, 'newbie@dpit.example');
  await expect(page.getByText('Your account is read-only for now')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Set up your CampusLink' })).toHaveCount(0);
});
