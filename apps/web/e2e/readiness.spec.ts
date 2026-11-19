import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 2, G5: a student reads their readiness; the placement cell reads the board and its weights. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a student sees their score, what it is made of and their next steps', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/readiness`);
  await expect(page.getByRole('heading', { level: 1, name: 'Readiness' })).toBeVisible();
  // Prompt 3, U7: the score as a large ring, the next steps once (no deficit headline).
  await expect(page.getByRole('progressbar', { name: 'Your readiness score' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /^\d+ steps? adds? \d+ more$|^Your next steps$/ }),
  ).toBeVisible();
  await expect(page.getByText(/^You’re at/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'What your score is made of' })).toBeVisible();
  // Practice (G4) counts: its row shows points like every other part.
  const practice = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Practice' }) });
  await expect(practice.getByText(/^\d+ of \d+$/)).toBeVisible();
  await expect(page.getByText(/Other students and employers never do/)).toBeVisible();
  await expectNoA11yViolations(page);
});

test('the placement cell reads the board and opens the weights', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `tpo@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/admin/readiness`);
  await expect(page.getByRole('heading', { name: 'Distribution' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs help' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Average points by part' })).toBeVisible();
  // Prompt 3, U9c: four numbers, each against the board a week ago; a fresh board has none yet.
  await expect(page.getByText(/^Ready \(\d+ or above\)$/)).toBeVisible();
  await expect(page.getByText('Median score', { exact: true })).toBeVisible();
  await expect(page.getByText('No earlier figure yet').first()).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Weights' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('heading', { name: 'How the score is made' })).toBeVisible();
  await expect(d.getByLabel('Résumé')).toHaveValue('25');
  await expectNoA11yViolations(page);
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toHaveCount(0);
});

test('faculty read the board but cannot change weights, nudge or export', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `faculty@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/admin/readiness`);
  await expect(page.getByRole('heading', { name: 'Distribution' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Weights' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
});
