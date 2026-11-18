import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 3, U6b: the mentor's queue, and a session's own page with its agenda and shared notes. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a request accepted from the mentor’s queue becomes a session page with its agenda and shared notes', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const host = hostFor(info.project.name);
  const base = `http://${host}.localhost:4173`;
  const goal = `a core design role (${info.project.name} ${Date.now() % 100000})`;

  // Student: a 1:1 call with Arjun, through the three steps.
  await signIn(page, `vikram@${host}.example`, host);
  await page.goto(`${base}/mentors?view=browse`);
  await page.getByPlaceholder('Search by name, company or topic').fill('Arjun');
  await page.getByRole('link', { name: /Arjun Naidu/ }).click();
  await page.getByRole('button', { name: 'Request mentorship' }).click();
  const sheet = page.getByRole('dialog', { name: /Ask Arjun for help/ });
  await sheet.getByRole('radio', { name: /1:1 video call/ }).click();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByLabel('What are you working towards?').fill(goal);
  await sheet.getByLabel('What would help most?').fill('which GATE topics matter most for PSUs');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('radiogroup', { name: 'Time' }).getByRole('radio').first().click();
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible();

  // Mentor: the queue leads the dashboard; Decline offers the kind replies; Accept is one tap.
  const mentorCtx = await browser.newContext();
  const mentor = await mentorCtx.newPage();
  await signIn(mentor, `arjun@${host}.example`, host);
  await mentor.goto(`${base}/mentor`);
  await expect(mentor.getByRole('heading', { name: 'Requests waiting' })).toBeVisible();
  await expect(mentor.getByText(/^This week: \d+ of 5 requests$/)).toBeVisible();
  const row = mentor.getByRole('listitem').filter({ hasText: goal });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^Decline Vikram Shetty’s request/ }).click();
  await expect(mentor.getByRole('dialog').getByText('Fully booked')).toBeVisible();
  await mentor.keyboard.press('Escape');
  await expectNoA11yViolations(mentor);
  await row.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(mentor.getByRole('listitem').filter({ hasText: goal })).toHaveCount(0);

  // The session's page: Join, what it is for, and notes both of them share.
  // From the accepted request (it carries the goal) to its session's own page.
  await mentor.goto(`${base}/mentorship`);
  await mentor
    .getByRole('listitem')
    .filter({ hasText: goal })
    .first()
    .getByRole('link', { name: 'View session' })
    .click();
  await expect(
    mentor.getByRole('heading', { level: 1, name: '1:1 video call with Vikram Shetty' }),
  ).toBeVisible();
  await expect(mentor.getByRole('heading', { name: 'What it’s for' })).toBeVisible();
  await expect(mentor.getByText(`Goal: ${goal}`)).toBeVisible();
  const url = mentor.url();
  await mentor.getByRole('textbox', { name: 'Shared notes' }).fill('Bring your GATE mock scores.');
  await mentor.getByRole('button', { name: 'Save notes' }).click();
  await expect(mentor.getByText(/^Last saved by you,/)).toBeVisible();
  await expectNoA11yViolations(mentor);
  await mentorCtx.close();

  await page.goto(url);
  await expect(page.getByRole('textbox', { name: 'Shared notes' })).toHaveValue(
    'Bring your GATE mock scores.',
  );
  await expect(page.getByText(/^Last saved by Arjun Naidu,/)).toBeVisible();
});
