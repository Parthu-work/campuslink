import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 2, G6: quick asks, certificates, giving, batch pages and the public certificate check. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a student sends a quick ask to alumni', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/alumni`);
  await expect(page.getByRole('heading', { level: 1, name: 'Alumni' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Quick asks' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'New quick ask' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('radio', { name: 'A quick introduction' }).click();
  await d.getByLabel('Company').fill('Nimbus Labs');
  await d
    .getByLabel('What you need', { exact: true })
    .fill(`An introduction to the hiring team, please (${info.project.name}).`);
  await expectNoA11yViolations(page);
  await d.getByRole('button', { name: 'Send' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByText(`(${info.project.name}).`)).toBeVisible();
});

test('an alumnus sees certificates, giving and LinkedIn import', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `rahul@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/alumni?tab=certificates`);
  await expect(page.getByRole('tab', { name: 'Certificates', selected: true })).toBeVisible();
  await expect(page.getByText(/^Academic year \d{4}-\d{2}$/).first()).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('tab', { name: 'Giving' }).click();
  await expect(page.getByText(/You pay the college directly/)).toBeVisible();
  await page.getByRole('tab', { name: 'LinkedIn import' }).click();
  await expect(page.getByRole('button', { name: 'Choose the file' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('the placement cell publishes a fund and opens recognition', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `tpo@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/admin/giving`);
  await page.getByRole('button', { name: 'New fund' }).first().click();
  const d = page.getByRole('dialog');
  const title = `Lab fund ${info.project.name} (demo)`;
  await d.getByLabel('Name').fill(title);
  await d.getByLabel('About this fund').fill('New oscilloscopes for the electronics lab (demo).');
  await d.getByLabel('College payment link').fill('https://rzp.io/l/demo-lab-fund');
  await expectNoA11yViolations(page);
  await d.getByRole('button', { name: 'Save changes' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByText(title)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto(`http://${host}.localhost:4173/admin/recognition`);
  await expect(page.getByRole('heading', { name: 'Alumnus of the month' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('a batch page and the public certificate check', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await page.goto(`http://${host}.localhost:4173/verify-certificate/${'0'.repeat(32)}`);
  await expect(page.getByText('No certificate has this code')).toBeVisible();
  await expectNoA11yViolations(page);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/batch/2018/CSE`);
  await expect(page.getByRole('heading', { level: 1, name: 'Class of 2018, CSE' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where the batch works' })).toBeVisible();
  await expectNoA11yViolations(page);
});
