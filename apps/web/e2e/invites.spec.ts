import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/**
 * Build B4: the placement cell invites people on the college's list; one tap on the link, a code
 * to the number on record, and they are a verified member. Class join codes work the same way
 * with a roll number. Each project uses its own college (the demo records are single use).
 */
let host = 'dpit';
let phones = { link: '+919000000107', code: '+919000000108' };
test.beforeEach(async ({ page: _page }, info) => {
  host = info.project.name === 'mobile' ? 'mrce' : 'dpit';
  // Seed order: dpit is college 0, mrce college 1 (apps/api/src/scripts/seed.ts › demoInvitePhones).
  phones =
    host === 'mrce'
      ? { link: '+919000000117', code: '+919000000118' }
      : { link: '+919000000107', code: '+919000000108' };
});
const base = () => `http://${host}.localhost:4173`;
const gradYear = String(new Date().getFullYear() + 2);

/** The console WhatsApp/SMS outbox, newest first, read from the page (the browser resolves *.localhost). */
const outbox = (page: Page, e164: string) =>
  page.evaluate(
    async (to) =>
      (
        (await (await fetch(`/api/v1/dev/outbox?to=${encodeURIComponent(to)}`)).json()) as {
          data: { template: string; params: string[] }[];
        }
      ).data,
    e164,
  );

async function waitFor(page: Page, e164: string, match: (m: { template: string }) => boolean) {
  for (let i = 0; i < 40; i++) {
    const hit = (await outbox(page, e164)).find(match);
    if (hit) return hit;
    await page.waitForTimeout(250);
  }
  throw new Error(`nothing for ${e164}`);
}

/** Birth month, consents as they are, send the code, type the code: the member lands on Home. */
async function finishJoining(page: Page, e164: string) {
  await page.getByLabel('Month').selectOption({ label: 'March' });
  await page.getByLabel('Year').selectOption(String(new Date().getFullYear() - 20));
  await expectNoA11yViolations(page);
  const before = (await outbox(page, e164)).length;
  await page.getByRole('button', { name: 'Send my code' }).click();
  await expect(page.getByText(/We sent a 6-digit code/)).toBeVisible();
  let code = '';
  for (let i = 0; i < 40 && !code; i++) {
    const items = await outbox(page, e164);
    if (items.length > before) code = items[0]?.params[0] ?? '';
    else await page.waitForTimeout(250);
  }
  for (let i = 0; i < 6; i++) await page.getByLabel(`6-digit code ${i + 1}`).fill(code[i] ?? '');
  await page.waitForURL(/\/home$/);
  // Verified from the start: no read-only banner.
  await expect(page.getByText('Your account is read-only for now')).toBeHidden();
}

test('the TPO sends invites on WhatsApp; the link makes a verified member in one go', async ({ page }) => {
  await signIn(page, `tpo@${host}.example`, host);
  await page.goto(`${base()}/admin/onboarding`);
  await expect(page.getByRole('heading', { name: 'Not joined yet' })).toBeVisible();
  await page.getByLabel('Branch').first().selectOption('ECE');
  await page.getByLabel('Graduation year').first().fill(gradYear);
  await expect(page.getByRole('cell', { name: 'Demo Invite Student' })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Send invites on WhatsApp' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Send invites' })).toBeDisabled();
  await dialog.getByText(/agreed to hear from the college on WhatsApp/).click();
  await dialog.getByRole('button', { name: 'Send invites' }).click();
  await expect(page.getByText(/sent, .* skipped/)).toBeVisible();

  const invite = await waitFor(page, phones.link, (m) => m.template === 'cl_invite_student');
  const link = invite.params[2] ?? '';
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  await page.context().clearCookies();
  await page.goto(link.replace(/^https?:\/\/[^/]+/, base()));
  await expect(page.getByRole('heading', { name: /Hi Demo, join/ })).toBeVisible();
  await expect(page.getByText(/send a code to the mobile number your college has/)).toBeVisible();
  await finishJoining(page, phones.link);
  // Used: the same link now explains itself instead of working twice.
  await page.context().clearCookies();
  await page.goto(link.replace(/^https?:\/\/[^/]+/, base()));
  await expect(page.getByRole('heading', { name: 'This invite no longer works' }).first()).toBeVisible();
});

test('a class join code and a roll number get a student in; the poster carries the QR code', async ({
  page,
}) => {
  await signIn(page, `tpo@${host}.example`, host);
  await page.goto(`${base()}/admin/onboarding`);
  await page.getByRole('button', { name: 'New join code' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Branch').selectOption('ECE');
  await dialog.getByLabel('Graduation year').fill(gradYear);
  await dialog.getByRole('button', { name: 'Create code' }).click();
  const toast = page.getByText(/Join code [2-9A-HJ-NP-Z]{8} is ready/);
  await expect(toast).toBeVisible();
  const code = /([2-9A-HJ-NP-Z]{8})/.exec((await toast.textContent()) ?? '')?.[1] ?? '';
  await page
    .getByRole('row', { name: new RegExp(code) })
    .getByRole('link', { name: 'Poster' })
    .click();
  await expect(page.getByRole('img', { name: 'QR code of the join link' })).toBeVisible();
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.context().clearCookies();
  await page.goto(`${base()}/join/${code}`);
  await expect(page.getByText(/Class code for students of ECE/)).toBeVisible();
  await page.getByLabel('Roll number').fill(`24${host.slice(0, 2).toUpperCase()}1A0522`);
  await finishJoining(page, phones.code);
});
