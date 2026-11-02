import { expect, test } from '@playwright/test';
import { expectNoA11yViolations } from './helpers';
import { adminSignIn } from './admin';

/** Build B10: a college's billing, and the platform's plans, invoices and bank payments. */
test.describe.configure({ mode: 'serial' });

test('a college admin sees the plan, usage and invoices, downloads one and pays online', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile', 'One paying demo college; the desktop project covers it');
  await adminSignIn(page, 'dpit', 'admin@dpit.example');
  await page.goto('http://dpit.localhost:4173/admin/billing');
  await expect(page.getByRole('heading', { name: 'Placement', level: 2 })).toBeVisible();
  await expect(page.getByText('Seats in use')).toBeVisible();
  const invoices = page.getByRole('region', { name: 'Invoices' });
  await expect(invoices.getByRole('cell', { name: 'Paid', exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    invoices
      .getByRole('button', { name: /^Download invoice/ })
      .first()
      .click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  // The stub provider's page pays at once and comes back here.
  await page.getByRole('button', { name: /^Pay invoice .* online$/ }).click();
  await expect(page).toHaveURL(/\/admin\/billing\?paid=1$/);
  await expect(page.getByRole('status').filter({ hasText: 'Thank you' })).toBeVisible();
  await expect(invoices.getByRole('cell', { name: 'Issued', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pay invoice/ })).toHaveCount(0);
});

test('the platform drafts, issues and records a bank payment for a college', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'One platform admin; the desktop project covers it');
  await adminSignIn(page, 'admin', 'superadmin@campuslink.example');
  await page.goto('http://admin.localhost:4173/platform/billing');
  await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
  const colleges = page.getByRole('region', { name: 'Colleges' });
  await expect(colleges.getByRole('cell', { name: /dpit/ })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('tab', { name: 'Plans' }).click();
  await expect(page.getByRole('heading', { name: 'Connect', level: 2 })).toBeVisible();
  await page.getByRole('tab', { name: 'Colleges' }).click();
  await colleges.getByRole('link', { name: 'Musi Riverfront College of Engineering' }).click();

  // Invoice details first, then a draft from the plan's suggestion, issued and paid.
  await page.getByLabel('Legal name').fill('MRCE Demo Trust (demo)');
  await page.getByLabel('Address').fill('2 Demo Street, Hyderabad, Telangana 500002 (fictional)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Add the college’s legal name')).toHaveCount(0);
  await page.getByRole('button', { name: 'New invoice' }).click();
  const draft = page.getByRole('dialog', { name: 'New invoice' });
  await draft.getByLabel('Description').fill('Pilot extension (demo)');
  await draft.getByLabel('Unit price (₹)').fill('5000');
  await draft.getByRole('button', { name: 'Save draft' }).click();
  const invoices = page.getByRole('region', { name: 'Invoices' });
  await invoices.getByRole('button', { name: 'Issue' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Issue' }).click();
  await expect(invoices.getByRole('cell', { name: 'Issued', exact: true }).first()).toBeVisible();
  await invoices.getByRole('button', { name: 'Record payment' }).first().click();
  const pay = page.getByRole('dialog');
  await pay.getByLabel('UTR or bank reference').fill(`E2EUTR${Date.now()}`);
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('region', { name: 'Payments' })).toBeVisible();
  await expect(invoices.getByRole('cell', { name: 'Paid', exact: true }).first()).toBeVisible();
  await expectNoA11yViolations(page);
});

test('a pilot college’s billing fits a phone, with no invoices yet', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'Phone width');
  await adminSignIn(page, 'mrce', 'admin@mrce.example');
  await page.goto('http://mrce.localhost:4173/admin/billing');
  await expect(page.getByRole('heading', { name: 'Pilot', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No invoices yet' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await expectNoA11yViolations(page);
});
