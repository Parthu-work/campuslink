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
  // Prompt 3, U9c: four numbers for the period, each with its change, then one chart per question.
  for (const label of ['Mentorship sessions', 'Students referred', 'Jobs posted', 'Events held'])
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  await expect(
    page
      .getByText(
        /^((Up|Down) \d+ on|Same as|Was (under 5|\d+) for) the 6 months before$|^No earlier figure yet$/,
      )
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole('figure', { name: 'Are mentorship sessions happening every month?' }),
  ).toBeVisible();
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectNoA11yViolations(page);
  }
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
  // Prompt 3, U9: one table pattern on the platform too. Traction sorts by every column.
  const active = table.getByRole('columnheader', { name: 'Active, 7 days' });
  await expect(active).toHaveAttribute('aria-sort', 'descending');
  await table.getByRole('columnheader', { name: 'College' }).getByRole('button').click();
  await expect(table.getByRole('columnheader', { name: 'College' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expectNoA11yViolations(page);

  // Colleges: a row opens the college's panel with its one action (it asks before suspending).
  await page.goto('http://admin.localhost:4173/platform');
  await expect(page.getByRole('heading', { name: 'Colleges', level: 1 })).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'mrce' }).getByRole('button').first().click();
  const panel = page.getByRole('dialog', { name: 'Musi Riverfront College of Engineering' });
  await expect(panel.getByRole('button', { name: 'Suspend college' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press('Escape');

  // Support: the reports from every college as the same table.
  await page.goto('http://admin.localhost:4173/platform/support');
  await expect(page.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible();
  await expectNoA11yViolations(page);
});
