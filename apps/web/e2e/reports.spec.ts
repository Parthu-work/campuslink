import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Build B8: a member reports higher studies, the placement cell verifies it, and reports read it. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a student reports higher studies and the placement cell verifies it', async ({
  page,
  browser,
}, info) => {
  const host = hostFor(info.project.name);
  const institution = `Demo Graduate School ${info.project.name}`;
  await signIn(page, `vikram@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/outcomes`);
  await expect(page.getByRole('heading', { name: 'Your outcomes', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Add higher studies' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add higher studies' });
  await dialog.getByLabel('Institution').fill(institution);
  await dialog.getByLabel('Programme').fill('M.Tech CSE');
  await dialog.getByLabel('Admitted through').selectOption('GATE');
  await expectNoA11yViolations(page);
  await dialog.getByRole('button', { name: 'Send for verification' }).click();
  await expect(page.getByText('Sent. The placement cell will verify it.').first()).toBeVisible();
  const card = page.getByRole('listitem').filter({ hasText: institution });
  await expect(card.getByText('Waiting for verification')).toBeVisible();

  const ctx = await browser.newContext();
  const tpo = await ctx.newPage();
  await signIn(tpo, `tpo@${host}.example`, host);
  await tpo.goto(`http://${host}.localhost:4173/admin/offers`);
  await tpo
    .getByRole('group', { name: 'What to verify' })
    .getByRole('button', { name: 'Higher studies' })
    .click();
  await tpo.getByRole('row').filter({ hasText: institution }).getByRole('button', { name: 'Review' }).click();
  await tpo.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
  await expect(tpo.getByText('Verified').first()).toBeVisible();
  await ctx.close();

  await page.reload();
  await expect(
    page.getByRole('listitem').filter({ hasText: institution }).getByText('Verified'),
  ).toBeVisible();
});

test('the principal’s reports: this batch at a glance, a report and its downloads', async ({
  page,
}, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `tpo@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/admin/reports?gradYear=2026`);
  await expect(page.getByText('Placement %').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Top recruiters' })).toBeVisible();
  await expect(page.getByText('Kestrel Analytics (demo)')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('link', { name: /Placement, higher studies and entrepreneurship/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Placement, higher studies and entrepreneurship (SAR)' }),
  ).toBeVisible();
  await expect(page.getByText(/has not been checked against the framework/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'P = (x + y + z) / N' })).toBeVisible();
  await expectNoA11yViolations(page);
  const [summary] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download Excel' }).click(),
  ]);
  expect(summary.suggestedFilename()).toMatch(/^nba-sar-placement-2025-26\.xlsx$/);
  const [evidence] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Evidence workbook' }).click(),
  ]);
  expect(evidence.suggestedFilename()).toMatch(/evidence\.xlsx$/);
});
