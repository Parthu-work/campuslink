import { expect, test } from '@playwright/test';
import { adminSignIn } from './admin';
import { expectNoA11yViolations, signIn } from './helpers';

/** Build B1: a college switches a feature off and it disappears everywhere, saved links included. */
test('switching Study off hides it from members and its pages say so', async ({ browser, page }, info) => {
  // Each project uses its own college, so the two runs never switch the same feature.
  const host = info.project.name === 'mobile' ? 'mrce' : 'dpit';
  test.setTimeout(120_000); // may wait for a fresh TOTP step

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await adminSignIn(admin, host, `admin@${host}.example`);
  await admin.goto(`http://${host}.localhost:4173/admin/features`);
  const study = admin.getByRole('switch', { name: 'Study' });
  await expect(study).toHaveAttribute('aria-checked', 'true');
  await expect(admin.getByText('Subjects, notes and videos, and the study assistant.')).toBeVisible();
  await expectNoA11yViolations(admin);
  await study.click();
  await expect(study).toHaveAttribute('aria-checked', 'false');

  try {
    // The student uses the project's device (a phone, or a desktop browser).
    await signIn(page, `ananya@${host}.example`, host);
    // Not in the tabs, the menu or the command palette.
    await expect(page.getByRole('link', { name: 'Study', exact: true })).toHaveCount(0);
    // A saved link says the college has switched it off, rather than failing.
    await page.goto(`http://${host}.localhost:4173/study`);
    await expect(page.getByRole('heading', { name: 'Your college has switched this off' })).toBeVisible();
    await expectNoA11yViolations(page);
  } finally {
    await study.click();
    await expect(study).toHaveAttribute('aria-checked', 'true');
    await adminCtx.close();
  }
});
