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

  // Edit, save, and the change shows in the preview: beside the editor on a wide screen (prompt 3,
  // U7), in a sheet on a phone.
  const wide = info.project.name === 'desktop';
  await page.getByLabel('Headline').fill('Final-year CSE student, backend');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  if (!wide) await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByLabel('Résumé preview').getByText('Final-year CSE student, backend')).toBeVisible();
  if (!wide) await page.keyboard.press('Escape');

  // A point gets an inline suggestion under it, with Keep mine to leave it as it is.
  if (!wide)
    for (const step of ['Education', 'Experience', 'Projects'])
      await page.getByRole('button', { name: step, exact: true }).click();
  await page.getByRole('button', { name: 'Add to Projects' }).click();
  const project = page.getByLabel('Project', { exact: true }).last();
  await project.fill('Library management app');
  const point = page.getByLabel('Point 1', { exact: true }).last();
  await point.fill('Worked on a REST API that served 200 students every day');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.getByRole('button', { name: 'Improve' }).last().click();
  const suggestion = page.getByRole('group', { name: 'Improve this point' });
  await expect(suggestion.getByRole('button', { name: 'Keep mine' })).toBeVisible();
  await expectNoA11yViolations(page);
  await suggestion.getByRole('button', { name: 'Keep mine' }).click();
  await expect(suggestion).toHaveCount(0);

  // The checklist and a score that moves as the student types; the check reads the saved PDF.
  if (wide)
    await page.getByRole('group', { name: 'Résumé views' }).getByRole('button', { name: 'Check' }).click();
  else
    for (const step of ['Skills', 'Certificates and awards', 'Check'])
      await page.getByRole('button', { name: step, exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Your score as you edit' })).toBeVisible();
  await page.getByRole('button', { name: 'Run the check' }).click();
  await expect(page.getByText(/^Last check: \d+/)).toBeVisible();
  await expectNoA11yViolations(page);

  // The download is a PDF.
  const download = page.waitForEvent('download');
  if (!wide) await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Download PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);

  // Back on the list, it carries its score, and deleting it removes it.
  await page.goto(`http://${host}.localhost:4173/resume`);
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.getByRole('button', { name: `Delete ${title}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
});
