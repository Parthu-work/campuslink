import { test, expect } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';
import { adminSignIn, lastMailSubject } from './admin';

/** Phase 2 done-criteria: import a sample CSV, map columns, verify a user, browse the directory. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test.describe('people', () => {
  test('an admin imports the sample CSV with suggested column mapping', async ({ page }, info) => {
    test.setTimeout(90_000); // may wait for a fresh TOTP step
    const host = hostFor(info.project.name);
    await adminSignIn(page, host, `admin@${host}.example`);
    await page.goto(`http://${host}.localhost:4173/admin/imports`);
    await expectNoA11yViolations(page);
    await page.getByLabel('Choose file').setInputFiles('../../docs/samples/sample-students.csv');
    await expect(page.getByRole('heading', { name: 'Match your columns' })).toBeVisible();
    await expect(page.getByLabel('Roll number *')).toHaveValue('Hall Ticket No');
    await expect(page.getByLabel('Name *')).toHaveValue('Candidate Name');
    await expectNoA11yViolations(page);
    await page.getByText('Dry run: check everything without saving').click(); // turn the dry run off
    await page.getByRole('button', { name: 'Start import' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Import finished' })).toBeVisible({
      timeout: 20_000,
    });
    const tile = (label: string) => page.locator('dl > div').filter({ hasText: label }).locator('dd');
    await expect(tile('New')).toHaveText('6');
    await expect(tile('Problems')).toHaveText('3');
    await expect(page.getByRole('button', { name: 'Download problem report' })).toBeVisible();

    // Phones reach the other sections through the overview; desktops through the side menu.
    if (info.project.name === 'mobile') await page.getByRole('link', { name: 'Overview' }).click();
    await page.getByRole('link', { name: 'College list' }).click();
    await page.getByPlaceholder('Search roll number or name').fill('25DP1A0501');
    await expect(page.getByRole('cell', { name: /Akhil Varma/ })).toBeVisible();
    await expect(page.getByText('a••••••@dpit.example')).toBeVisible();
  });

  test('an unverified student verifies with roll number + emailed code', async ({ page }, info) => {
    const host = hostFor(info.project.name);
    await signIn(page, `newbie@${host}.example`, host);
    await page.getByRole('link', { name: 'Verify now' }).click();
    await expectNoA11yViolations(page);
    await page.getByLabel('Roll number').fill(`24${host.slice(0, 2).toUpperCase()}1A0577`);
    await page.getByRole('button', { name: 'Find me' }).click();
    await expect(page.getByText(/We sent a 6-digit code to s••••••@/)).toBeVisible();
    const subject = await lastMailSubject(`sai.teja.records@${host}.example`);
    const code = /\b(\d{6})\b/.exec(subject)?.[1] ?? '';
    await page.getByLabel('Enter the code 1').click();
    await page.keyboard.type(code);
    // The sixth digit submits the code (audit FO-6), and the "You're in" moment follows.
    await expect(page.getByRole('heading', { name: 'You’re in!' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Find a mentor/ })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto(`http://${host}.localhost:4173/home`);
    await expect(page.getByText('Your account is read-only for now')).toHaveCount(0);
  });

  test('a verified student browses the directory, opens a profile and uses the command palette', async ({
    page,
  }, info) => {
    const host = hostFor(info.project.name);
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`http://${host}.localhost:4173/people`);
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    await page.getByRole('button', { name: 'Alumni', exact: true }).click();
    await expect(page.getByText('Rahul Varma')).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByPlaceholder('Search by name, company or skill').fill('Northstar');
    await expect(page.getByText('Fatima Begum')).toBeVisible();
    await expect(page.getByText('Rahul Varma')).toHaveCount(0);
    await page.getByText('Fatima Begum').click();
    await expect(page.getByRole('heading', { name: 'Fatima Begum', level: 1 })).toBeVisible();
    await page.getByRole('tab', { name: 'Contact' }).click();
    await expect(page.getByText(/Contact details are private/)).toBeVisible();
    await expectNoA11yViolations(page);

    await page.keyboard.press('Control+k');
    await page.getByPlaceholder('Search people, posts, jobs and more, or type a command…').fill('Rahul');
    await page.getByRole('option', { name: /Rahul Varma/ }).click();
    await expect(page.getByRole('heading', { name: 'Rahul Varma', level: 1 })).toBeVisible();
  });

  test('a member edits their profile and visibility', async ({ page }, info) => {
    const host = hostFor(info.project.name);
    await signIn(page, `vikram@${host}.example`, host);
    await page.goto(`http://${host}.localhost:4173/profile`);
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByLabel('Headline').fill('Final-year CSE · building a placement tracker');
    await page.getByLabel('Skills').fill('TypeScript');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Headline')).toHaveValue('Final-year CSE · building a placement tracker');
  });
});
