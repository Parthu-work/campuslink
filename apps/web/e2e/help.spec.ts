import { test, expect } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';
import { adminSignIn } from './admin';

/**
 * Build B14: a member reads a guide and reports a problem, the college's desk answers it, and the
 * legal pages and grievance officer are reachable. (Publishing new legal details is covered by the
 * API suite: here it would ask every other spec's members to accept it again.)
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test.describe('help, support and legal pages', () => {
  test('a member reports a problem and the college answers it', async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    const subject = `E2E: cannot change my number (${info.project.name} ${Date.now() % 100000})`;
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/help`);
    await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('link', { name: /Getting started/ }).click();
    await expect(page.getByRole('heading', { name: 'Getting started', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Signing in' })).toBeVisible();
    await page.goto(`${base}/help`);
    await page.getByRole('button', { name: 'Report a problem' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report a problem' });
    await dialog.getByLabel('What is it about?').selectOption('account');
    await expect(dialog.getByText('This goes to your college’s admins.')).toBeVisible();
    await dialog.getByLabel('In a few words').fill(subject);
    await dialog
      .getByLabel('What happened')
      .fill('The change-number screen says my code expired every time.');
    await expectNoA11yViolations(page);
    await dialog.getByRole('button', { name: 'Send' }).click();
    await page.waitForURL(/\/help\/reports\/[a-f0-9]{24}$/);
    await expect(page.getByRole('heading', { name: subject, level: 1 })).toBeVisible();
    await expect(page.getByText('Waiting for a reply')).toBeVisible();

    // The college's desk answers it.
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();
    await adminSignIn(admin, host, `admin@${host}.example`);
    await admin.goto(`${base}/admin/support`);
    await expect(admin.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible();
    await admin.getByRole('button', { name: new RegExp(subject.replace(/[()]/g, '\\$&')) }).click();
    const sheet = admin.getByRole('dialog');
    await sheet.getByLabel('Your reply').fill('E2E: please try again now.');
    await sheet.getByRole('button', { name: 'Send reply' }).click();
    await expect(sheet.getByText('E2E: please try again now.')).toBeVisible();
    await expectNoA11yViolations(admin);
    await ctx.close();

    await page.reload();
    await expect(page.getByText('E2E: please try again now.')).toBeVisible();
    await expect(page.getByText('Answered').first()).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.getByText('Closed').first()).toBeVisible();
  });

  test('the privacy policy is public, and Settings shows the grievance officer', async ({ page }, info) => {
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    await page.goto(`${base}/legal/privacy`);
    await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your rights' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('link', { name: 'Terms of use' }).click();
    await expect(page.getByRole('heading', { name: 'Terms of use', level: 1 })).toBeVisible();
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/settings/privacy`);
    await expect(page.getByRole('heading', { name: 'Grievance officer' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
