import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Build B5: a mentor's track record and public reviews are on their card and page. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a mentor page shows the track record and what mentees say', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/mentors?view=browse`);
  await page.getByPlaceholder('Search by name, company or topic').fill('Rahul');
  const tile = page.getByRole('link', { name: /Rahul/ }).first();
  await expect(tile.getByText(/sessions? done/)).toBeVisible();
  await tile.click();
  const record = page.getByRole('list', { name: 'Track record' });
  await expect(record.getByText(/sessions? done/)).toBeVisible();
  await expect(record.getByText(/^Next free:/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What mentees say' })).toBeVisible();
  await expect(page.getByText('DEMO: Specific, practical resume feedback in thirty minutes.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Options for this review' })).toBeVisible();
  await expectNoA11yViolations(page);
});
