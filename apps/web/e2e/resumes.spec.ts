import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 2, G2: a student builds a résumé from their profile, checks it, downloads it and deletes it. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a student builds, checks and downloads a résumé', async ({ page }, info) => {
  test.slow();
  const host = hostFor(info.project.name);
  const title = `E2E ${info.project.name}`;
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/resume`);
  await expect(page.getByRole('heading', { level: 1, name: 'Résumé' })).toBeVisible();
  await expectNoA11yViolations(page);

  // A new résumé starts prefilled from the profile.
  await page.getByRole('button', { name: 'New résumé' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(title);
  await dialog.getByRole('radio', { name: /Compact/ }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByLabel('Full name')).not.toHaveValue('');
  await expectNoA11yViolations(page);

  // Edit, save, and the change shows in the preview.
  await page.getByLabel('Headline').fill('Final-year CSE student, backend');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.getByLabel('Résumé preview').getByText('Final-year CSE student, backend')).toBeVisible();

  // The check reads the saved PDF.
  await page.getByRole('tab', { name: 'Check' }).click();
  await page.getByRole('button', { name: 'Run the check' }).click();
  await expect(page.getByText(/out of 100/).first()).toBeVisible();
  await expectNoA11yViolations(page);

  // The download is a PDF.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);

  // Back on the list, it carries its score, and deleting it removes it.
  await page.goto(`http://${host}.localhost:4173/resume`);
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.getByRole('button', { name: `Delete ${title}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
});
