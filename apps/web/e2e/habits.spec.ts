import { expect, test, type BrowserContextOptions } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 2, G7: the weekly Next Step, circles, peer mentoring and study groups. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a student sees this week\x27s Next Step on Home and opens it', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/home`);
  const card = page.getByRole('heading', { name: 'Your next step this week' });
  await expect(card).toBeVisible();
  await page.getByRole('link', { name: 'Open', exact: true }).click();
  await page.waitForURL(/\/next-step$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Your next step this week' })).toBeVisible();
  await expect(page.getByText('An alumnus to ask')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('faculty create a circle; a student joins it and asks inside it', async ({ browser }, info) => {
  const host = hostFor(info.project.name);
  const name = `Robotics club ${info.project.name} ${Date.now() % 100000}`;
  // Two people at once: each in its own context, with this project's device settings.
  const staffContext = await browser.newContext(info.project.use as BrowserContextOptions);
  const staff = await staffContext.newPage();
  await signIn(staff, `faculty@${host}.example`, host);
  await staff.goto(`http://${host}.localhost:4173/circles`);
  await expect(staff.getByRole('heading', { level: 1, name: 'Circles' })).toBeVisible();
  await staff.getByRole('button', { name: 'New circle' }).click();
  const d = staff.getByRole('dialog');
  await d.getByLabel('Name').fill(name);
  await d.getByLabel('Kind').selectOption('club');
  await expectNoA11yViolations(staff);
  await d.getByRole('button', { name: 'Create' }).click();
  await expect(d).toBeHidden();
  await staffContext.close();

  const studentContext = await browser.newContext(info.project.use as BrowserContextOptions);
  const page = await studentContext.newPage();
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/circles?tab=discover`);
  await page.getByRole('link', { name }).click();
  await expect(page.getByText('Join to see what the circle posts, asks and plans.')).toBeVisible();
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible();
  await page.getByRole('tab', { name: 'Questions' }).click();
  await page.getByLabel('Ask the circle').fill('Who has a spare servo motor for the line follower?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('Sent. It appears once a moderator approves it.')).toBeVisible();
  await expectNoA11yViolations(page);
  await studentContext.close();
});

test('a student opens peer mentoring and starts a study group', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/peers`);
  await expect(page.getByRole('heading', { level: 1, name: 'Peer mentoring' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Senior buddy', exact: true })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto(`http://${host}.localhost:4173/study-groups`);
  await page.getByRole('button', { name: 'New group' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByLabel('Subject').locator('option').nth(1)).toBeAttached();
  await d.getByLabel('Subject').selectOption({ index: 1 });
  await d.getByLabel('Group name').fill(`Automata revision ${info.project.name}`);
  await d.getByRole('button', { name: 'Start' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `Automata revision ${info.project.name}` }),
  ).toBeVisible();
  await page.getByLabel('Add a question').fill('Prove that the language of balanced brackets is not regular');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Prove that the language of balanced brackets is not regular')).toBeVisible();
  await expectNoA11yViolations(page);
});
