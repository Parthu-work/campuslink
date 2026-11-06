import { expect, test, type BrowserContextOptions } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 2, G8: opt-in public pages, inviting the batch and the parent digest. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a placed student publishes a public page, anyone with the link opens it, and it goes on take-down', async ({
  page,
  browser,
}, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `vikram@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/share`);
  await expect(page.getByRole('heading', { level: 1, name: 'Share' })).toBeVisible();
  const card = page.getByRole('listitem').filter({ hasText: 'Placed at' });
  await expect(card).toBeVisible();
  // A repeated run starts from an unpublished page.
  const takeDown = card.getByRole('button', { name: 'Take down' });
  if (await takeDown.isVisible()) {
    await takeDown.click();
    await expect(card.getByRole('button', { name: 'Publish' })).toBeVisible();
  }
  await card.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'First name only' }).click();
  await expectNoA11yViolations(page);
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText('Published')).toBeVisible();
  const href = await card.getByRole('link', { name: 'Open page' }).getAttribute('href');
  expect(href).toMatch(/\/p\/[a-z0-9-]+$/);

  // Someone who is not signed in, on another device.
  const anonContext = await browser.newContext(info.project.use as BrowserContextOptions);
  const anon = await anonContext.newPage();
  const res = await anon.goto(href ?? '');
  expect(res?.status()).toBe(200);
  await expect(anon.getByRole('heading', { level: 1 })).toContainText('Placed at');
  const html = await anon.content();
  expect(html).toContain('og:image');
  expect(html).toContain('noindex');
  expect(html).not.toContain('LPA');
  expect(html).not.toContain(`vikram@${host}.example`);

  await card.getByRole('button', { name: 'Take down' }).click();
  await expect(card.getByRole('button', { name: 'Publish' })).toBeVisible();
  expect((await anon.goto(href ?? ''))?.status()).toBe(404);
  await anonContext.close();
});

test('an alumnus sees their batch; a student can set up the parent update', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `rahul@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/share`);
  await expect(page.getByRole('heading', { name: 'Invite your batch' })).toBeVisible();
  await expect(page.getByText('Your college has not turned on invites from members yet.')).toBeVisible();
  // The parent update is a student's.
  await expect(page.getByRole('heading', { name: 'Monthly update for a parent' })).toHaveCount(0);
  await expectNoA11yViolations(page);

  await page.context().clearCookies();
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/share`);
  await expect(page.getByRole('heading', { name: 'Monthly update for a parent' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Invite your batch' })).toHaveCount(0);
  await page.getByLabel('Parent’s WhatsApp number').fill('+919848012345');
  await page.getByLabel('Their language').selectOption('te');
  await page.getByRole('button', { name: 'Send the code' }).click();
  await expect(page.getByText('Enter the code your parent received')).toBeVisible();
  await expect(page.getByText(/ending 2345/)).toBeVisible();
  await expectNoA11yViolations(page);
  // Not confirmed: cancelling deletes the number.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Send the code' })).toBeVisible();
});
