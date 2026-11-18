import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 3, U6a: finding a senior and asking. Each project uses its own college. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('the match: ranked seniors with reasons in words, filters, and Request opens the three-step sheet', async ({
  page,
}, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/mentors`);
  await expect(page.getByRole('heading', { level: 1, name: 'Mentors' })).toBeVisible();

  if (info.project.name === 'desktop') {
    // The list beside the selected senior; strength in words, the reasons first.
    const why = page.getByRole('region', { name: 'Why this match' });
    await expect(why).toBeVisible();
    await expect(why.getByText(/^(Strong match|Good match|Some overlap)/)).toBeVisible();
    const count = page.getByText(/^\d+ seniors?$/);
    const before = Number((await count.innerText()).split(' ')[0]);
    // A filter narrows the ranked list (its options come from the list).
    const company = page.getByRole('combobox', { name: 'Company' });
    const option = (await company.locator('option').allInnerTexts())[1] ?? '';
    await company.selectOption({ label: option });
    await expect(count).not.toHaveText(`${before} seniors`);
    // The list's rows (each one a button), not the reasons beside them.
    const rows = page
      .getByRole('main')
      .getByRole('listitem')
      .filter({ has: page.getByRole('button') });
    for (const text of await rows.allInnerTexts()) expect(text).toContain(option);
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(count).toHaveText(`${before} seniors`);
    // Choosing a row shows that senior; Request opens the sheet in place.
    await rows.nth(1).click();
    await page.getByRole('button', { name: 'Request', exact: true }).click();
  } else {
    // One card at a time: Not now and Request, no ambiguous "Interested".
    await expect(page.getByRole('button', { name: /^Not now: / })).toBeVisible();
    await expect(page.getByRole('button', { name: /Interested/ })).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: /^Request / }).click();
  }
  const sheet = page.getByRole('dialog', { name: /^Ask .+ for help$/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('What you need')).toBeVisible();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  // Your goal: two short answers, each with an example.
  await expect(sheet.getByLabel('What are you working towards?')).toBeVisible();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(
    sheet
      .getByRole('alert')
      .or(sheet.getByText(/A little more, please/))
      .first(),
  ).toBeVisible();
  await sheet.getByLabel('What are you working towards?').fill('a data analyst role by next summer');
  await sheet.getByLabel('What would help most?').fill('which projects to show first');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(sheet.getByRole('region', { name: /^What .+ will see$/ })).toContainText(
    'Goal: a data analyst role by next summer',
  );
  await expectNoA11yViolations(page);
});

test('a career path shows seniors who work as what it leads to, and Ask opens their request', async ({
  page,
}, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/roadmaps/sde-dsa`);
  await expect(page.getByRole('heading', { level: 2, name: 'Seniors on this path' })).toBeVisible();
  const ask = page.getByRole('link', { name: /^Ask / }).first();
  await expect(ask).toHaveAttribute('href', /^\/mentors\/[a-f0-9]{24}\?ask=request$/);
  await expect(page.getByText(/^Works as .*Software Engineer/i).first()).toBeVisible();
  await ask.click();
  await expect(page.getByRole('dialog', { name: /^Ask .+ for help$/ })).toBeVisible();
});
