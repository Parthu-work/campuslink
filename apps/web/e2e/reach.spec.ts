import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 2, G9: the calendar feed, the college picker and single sign-on's messages. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a member gets a calendar link that calendars can read, and turns it off', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/settings/notifications`);
  const card = page.getByRole('region', { name: 'Calendar feed' });
  await expect(card).toBeVisible();
  // A repeated run starts with the feed off.
  const off = card.getByRole('button', { name: 'Turn off' });
  if (await off.isVisible()) {
    await off.click();
    await expect(card.getByRole('button', { name: 'Get my calendar link' })).toBeVisible();
  }
  await card.getByRole('button', { name: 'Get my calendar link' }).click();
  const field = card.getByRole('textbox', { name: 'Calendar feed' });
  await expect(field).toHaveValue(/\/api\/v1\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
  await expect(card.getByRole('link', { name: 'Add to Google Calendar' })).toBeVisible();
  await expectNoA11yViolations(page);
  const url = await field.inputValue();
  const ics = await page.request.get(url);
  expect(ics.status()).toBe(200);
  expect(ics.headers()['content-type']).toContain('text/calendar');
  expect(await ics.text()).toContain('BEGIN:VCALENDAR');
  await card.getByRole('button', { name: 'Turn off' }).click();
  await expect(card.getByRole('button', { name: 'Get my calendar link' })).toBeVisible();
  expect((await page.request.get(url)).status()).toBe(404);
});

test('the bare domain asks for the college and opens it', async ({ page }) => {
  await page.goto('http://localhost:4173/?pick=1');
  await expect(page.getByRole('heading', { name: 'Find your college' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByLabel('College address').fill('dpit');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.waitForURL(/^http:\/\/dpit\.localhost:4173\//);
  // An address no college lives at still says so, with the way back to the picker.
  await page.goto('http://nowhere.localhost:4173/');
  await expect(page.getByRole('heading', { name: 'No college lives at this address' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find your college' })).toHaveAttribute(
    'href',
    /localhost:4173\/\?pick=1$/,
  );
});

test('the sign-in page explains a single sign-on that came back refused', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await page.goto(`http://${host}.localhost:4173/sign-in#sso_error=domain`);
  await expect(page.getByRole('alert')).toContainText('Use your college account');
  // The demo colleges have no single sign-on set up: no buttons.
  await expect(page.getByRole('link', { name: /Continue with/ })).toHaveCount(0);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expectNoA11yViolations(page);
});
