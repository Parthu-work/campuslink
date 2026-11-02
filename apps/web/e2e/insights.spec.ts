import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';
import { adminSignIn } from './admin';

/** Build B9: the college's product tabs and the platform's cross-college traction view. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('the placement cell reads activation, retention, mentorship and placement metrics', async ({
  page,
}, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `tpo@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/admin/analytics`);
  const tabs = page.getByRole('tablist', { name: 'Analytics' });
  await tabs.getByRole('tab', { name: 'Activation' }).click();
  await expect(page.getByText('Active in their first week')).toBeVisible();
  await expect(page.getByRole('figure', { name: 'Members active each week' })).toBeVisible();
  await expectNoA11yViolations(page);
  await tabs.getByRole('tab', { name: 'Retention' }).click();
  await expect(page.getByRole('columnheader', { name: 'Week 1' })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Placements' }).click();
  await expect(page.getByText('Offers per 100 final-years')).toBeVisible();
});

test('the platform sees every college side by side', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'One platform admin; the desktop project covers it');
  await adminSignIn(page, 'admin', 'superadmin@campuslink.example');
  await page.goto('http://admin.localhost:4173/platform/traction');
  await expect(page.getByRole('heading', { name: 'Traction', level: 1 })).toBeVisible();
  const table = page.getByRole('region', { name: 'Traction' });
  await expect(table.getByRole('cell', { name: /dpit/ })).toBeVisible();
  await expect(table.getByRole('cell', { name: /mrce/ })).toBeVisible();
  await expectNoA11yViolations(page);
});
