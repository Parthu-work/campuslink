import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Build B7: a placement drive from draft to a selection, and a reported offer verified. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');
const local = (ms: number) => {
  const d = new Date(Date.now() + ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const DAY = 86_400_000;

async function toast(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible();
}

test('the placement cell runs a drive from draft to a selection the student sees', async ({
  page,
  browser,
}, info) => {
  test.slow();
  const host = hostFor(info.project.name);
  const company = `E2E Corp ${info.project.name} (demo)`;
  await signIn(page, `tpo@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/admin/placements/new`);
  await page.getByLabel('Company', { exact: true }).fill(company);
  await page.getByLabel('Drive title').fill('Graduate engineer drive');
  await page.getByLabel('Drive date').fill(local(7 * DAY));
  await page.getByLabel('Registration closes').fill(local(3 * DAY));
  await page.getByLabel('Role', { exact: true }).fill('Graduate Engineer');
  await page.getByLabel('CTC up to (lakh a year)').fill('9');
  await page
    .getByRole('group', { name: /Branches/ })
    .getByRole('button', { name: 'CSE', exact: true })
    .click();
  // No résumé and no questions: students register in one tap.
  await page.getByRole('switch', { name: 'Ask for a résumé' }).click();
  await page.getByRole('button', { name: 'Add a round' }).click();
  await page.getByLabel('Round', { exact: true }).fill('Coding test');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await toast(page, 'Drive created as a draft');
  await expect(page.getByRole('heading', { name: 'Graduate engineer drive' })).toBeVisible();
  await page.getByRole('button', { name: 'Open registration' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Open registration' }).click();
  await toast(page, /Registration is open/);
  await expectNoA11yViolations(page);

  // Ananya (CSE) is eligible: the drive is under For you, with its countdown, and (prompt 3,
  // U7) registers from the card in one tap.
  const ctx = await browser.newContext();
  const student = await ctx.newPage();
  await signIn(student, `ananya@${host}.example`, host);
  await student.goto(`http://${host}.localhost:4173/placements`);
  const card = student.getByRole('listitem').filter({ hasText: company });
  await expect(card.getByText('You are eligible')).toBeVisible();
  await expect(card.locator('time')).toHaveText(/^Closes in /);
  await expectNoA11yViolations(student);
  await card.getByRole('button', { name: `Register for ${company}, Graduate engineer drive` }).click();
  await toast(student, `Registered for ${company}`);
  await expect(card.getByText('Registered', { exact: true })).toBeVisible();
  await card.getByRole('link', { name: company }).click();
  await expect(student.getByText('You are registered')).toBeVisible();

  // The cell starts the drive, enters the round result and records the selection.
  await page.reload();
  await page.getByRole('button', { name: 'Start the drive' }).click();
  await toast(page, 'The drive has started');
  await page.getByLabel('Coding test result for Ananya K').selectOption('cleared');
  await page.getByRole('button', { name: 'Save 1 result' }).click();
  await toast(page, /Results saved/);
  await page.getByLabel('Final result for Ananya K').selectOption('selected');
  const dialog = page.getByRole('dialog', { name: 'Record Ananya K’s offer' });
  await expect(dialog.getByLabel('CTC (lakh a year)')).toHaveValue('9');
  await dialog.getByRole('button', { name: 'Record selection' }).click();
  await toast(page, /Ananya K selected/);

  // The student sees the round result and the verified offer.
  await student.reload();
  await expect(student.getByText('Cleared')).toBeVisible();
  await expect(student.getByText('You were selected')).toBeVisible();
  await student.getByRole('link', { name: 'See your offer' }).click();
  const offer = student.getByRole('listitem').filter({ hasText: company });
  await expect(offer.getByText('Verified')).toBeVisible();
  await expect(offer.getByText('₹9 LPA')).toBeVisible();
  await ctx.close();
});

test('an offer a student reports with proof is verified by the placement cell', async ({
  page,
  browser,
}, info) => {
  const host = hostFor(info.project.name);
  const company = `Offcampus Co ${info.project.name} (demo)`;
  await signIn(page, `vikram@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/placements?tab=offers`);
  await page.getByRole('button', { name: 'Report an offer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report an offer' });
  await dialog.getByLabel('Company').fill(company);
  await dialog.getByLabel('Role', { exact: true }).fill('Analyst');
  await dialog.getByLabel('CTC (lakh a year)').fill('5.5');
  await dialog.getByLabel('How you got it').selectOption('off_campus');
  await dialog.locator('input[type=file]').setInputFiles('e2e/fixtures/demo-lecture.pdf');
  await expect(dialog.getByText('demo-lecture.pdf')).toBeVisible();
  await expectNoA11yViolations(page);
  await dialog.getByRole('button', { name: 'Send for verification' }).click();
  await toast(page, /The placement cell will verify it/);
  const card = page.getByRole('listitem').filter({ hasText: company });
  await expect(card.getByText('Waiting for verification')).toBeVisible();

  const ctx = await browser.newContext();
  const tpo = await ctx.newPage();
  await signIn(tpo, `tpo@${host}.example`, host);
  await tpo.goto(`http://${host}.localhost:4173/admin/offers`);
  await tpo.getByRole('row').filter({ hasText: company }).getByRole('button', { name: 'Review' }).click();
  await tpo.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
  await toast(tpo, 'Offer verified');
  await ctx.close();

  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: company }).getByText('Verified')).toBeVisible();
});

test('a student reads their record in one row and sees drives for a path they follow', async ({
  page,
}, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/placements`);
  // Prompt 3, U7: the record as the college gave it, one row; nothing on the screen asks for marks.
  await expect(page.getByText('CGPA 8.2 · 0 backlogs')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add your marks' })).toHaveCount(0);
  await page.getByRole('button', { name: 'View your academic record' }).click();
  const sheet = page.getByRole('dialog', { name: 'Your academic record' });
  await expect(sheet.getByText('From the college')).toBeVisible();
  await expect(sheet.getByText('Something wrong? Ask the placement cell to correct it.')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press('Escape');

  // The seeded software engineer drive is open: the path that leads to the role lists it.
  await page.goto(`http://${host}.localhost:4173/roadmaps/sde-dsa`);
  const drives = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Drives for this role' }) });
  await expect(drives.getByRole('link', { name: /Nimbus Labs/ })).toBeVisible();
  await expect(drives.getByText('Software Engineer', { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
});
