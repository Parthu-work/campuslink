import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';
import { adminSignIn } from './admin';

/**
 * Prompt 2, G12 (ADR 0014): a college joins the network, a student finds an alumnus of the other
 * demo college and asks for help, the alumnus shares a contact, and a placed student's verified
 * offer becomes a credential anyone can check. Mobile runs MRCE → DPIT, desktop DPIT → MRCE.
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');
const otherOf = (host: string) => (host === 'mrce' ? 'dpit' : 'mrce');

async function switchOn(page: Page, host: string) {
  await adminSignIn(page, host, `admin@${host}.example`);
  await page.goto(`http://${host}.localhost:4173/admin/network`);
  await expect(page.getByRole('heading', { name: 'What the college takes part in' })).toBeVisible();
  const terms = page.getByLabel(/I accept the network terms/);
  if (await terms.isVisible()) await terms.check();
  for (const name of ['Alumni discovery across colleges', 'Employer access', 'Verified credentials']) {
    const sw = page.getByRole('switch', { name });
    if ((await sw.getAttribute('aria-checked')) !== 'true') {
      await sw.click();
      await expect(sw).toHaveAttribute('aria-checked', 'true');
    }
  }
}

async function beFound(page: Page, host: string) {
  await page.goto(`http://${host}.localhost:4173/network?tab=settings`);
  const sw = page.getByRole('switch', { name: 'Be found by other colleges' });
  await expect(sw).toBeEnabled();
  if ((await sw.getAttribute('aria-checked')) !== 'true') {
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
  }
}

test('a college joins the network and a student asks an alumnus of another college for help', async ({
  page,
  browser,
}, info) => {
  const host = hostFor(info.project.name);
  const other = otherOf(host);
  await switchOn(page, host);
  await expectNoA11yViolations(page);
  await page.context().clearCookies();
  await switchOn(page, other);
  await page.context().clearCookies();

  // The alumnus of the other college opts in.
  const alumContext = await browser.newContext(info.project.use as BrowserContextOptions);
  const alum = await alumContext.newPage();
  await signIn(alum, `rahul@${other}.example`, other);
  await beFound(alum, other);
  await expectNoA11yViolations(alum);

  // The student opts in, finds Rahul and asks.
  await signIn(page, `ananya@${host}.example`, host);
  await beFound(page, host);
  await page.goto(`http://${host}.localhost:4173/network`);
  await expect(page.getByRole('heading', { level: 1, name: 'Network' })).toBeVisible();
  await page.getByLabel('Name, role or skill').fill('Rahul');
  await page.getByRole('search').getByRole('button', { name: 'Search' }).click();
  const card = page
    .getByRole('list', { name: 'Alumni of other colleges' })
    .getByRole('listitem')
    .filter({ hasText: 'Rahul' })
    .first();
  await expect(card).toBeVisible();
  await expectNoA11yViolations(page);
  await card.getByRole('button', { name: 'Ask for help' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('A short note (optional)').fill('DEMO: could you look at my project list?');
  await expectNoA11yViolations(page);
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(dialog).toBeHidden();

  // The alumnus accepts and shares an email address with this one student.
  await alum.goto(`http://${other}.localhost:4173/network?tab=intros`);
  const intro = alum.getByRole('listitem').filter({ hasText: 'DEMO: could you look at my project list?' });
  await intro.getByRole('button', { name: 'Accept' }).click();
  await alum.getByRole('dialog').getByRole('button', { name: 'Accept' }).click();
  await expect(intro.getByText('Accepted')).toBeVisible();
  await alumContext.close();

  await page.goto(`http://${host}.localhost:4173/network?tab=intros&box=sent`);
  await expect(page.getByText('Shared with you:')).toBeVisible();
  await expect(page.getByRole('link', { name: `rahul@${other}.example` })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('a verified offer becomes a credential that anyone can check', async ({ page, browser }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `vikram@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/network?tab=credentials`);
  const get = page.getByRole('button', { name: 'Get credential' }).first();
  await expect(get).toBeVisible();
  await expectNoA11yViolations(page);
  await get.click();
  const link = page.getByRole('link', { name: 'Open the check page' }).first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href')) ?? '';
  expect(href).toMatch(new RegExp(`/${host}/verify/[A-Za-z0-9_-]{22}$`));

  // Anyone, not signed in, on the root host.
  const anonContext = await browser.newContext(info.project.use as BrowserContextOptions);
  const anon = await anonContext.newPage();
  const res = await anon.goto(href.replace(/^https?:\/\/[^/]+/, 'http://localhost:4173'));
  expect(res?.status()).toBe(200);
  await expect(anon.getByText('Valid: signed by the college and not revoked')).toBeVisible();
  const html = await anon.content();
  expect(html).not.toContain(`vikram@${host}.example`);
  expect(html).not.toContain('LPA');
  await expectNoA11yViolations(anon);

  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await expect(page.getByText('Revoked').first()).toBeVisible();
  await anon.reload();
  await expect(anon.getByText('Revoked by the college or the holder')).toBeVisible();
  await anonContext.close();
});
