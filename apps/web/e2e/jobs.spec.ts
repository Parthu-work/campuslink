import { test, expect } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/**
 * Phase 5 done-criteria: an alumna posts an opening; a student finds it in Job Radar, saves it,
 * applies and tracks it; asks an alumnus at a company for a referral; the alumnus refers.
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test.describe('jobs and referrals', () => {
  test('post, find, save, apply and track', async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    const title = `E2E Platform Engineer ${info.project.name}`;

    // Alumna posts an opening.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const alum = await ctx.newPage();
    await signIn(alum, `sneha@${host}.example`, host);
    await alum.goto(`${base}/jobs/new`);
    await expect(alum.getByRole('heading', { name: 'Post an opening', level: 1 })).toBeVisible();
    await alum.getByLabel('Role title').fill(title);
    await alum.getByLabel('Company').fill('Kestrel Analytics (demo)');
    await alum.getByLabel('Location').fill('Hyderabad');
    await alum.getByLabel('Apply link').fill('https://example.com/demo-careers/e2e');
    await alum
      .getByLabel('Description')
      .fill('E2E: run our data platform on Kubernetes; freshers with Linux basics welcome.');
    await alum.getByLabel('Skills').fill('Kubernetes');
    await alum.keyboard.press('Enter');
    await expectNoA11yViolations(alum);
    await alum.getByRole('button', { name: 'Post opening' }).click();
    await expect(alum.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await ctx.close();

    // Student finds it, saves, applies and tracks.
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/jobs`);
    await expect(page.getByRole('heading', { name: 'Job Radar', level: 1 })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByPlaceholder('Search role, company or skill').fill('E2E Platform');
    await page.getByRole('link', { name: title }).first().click();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await page
      .getByRole('button', { name: `Save ${title}` })
      .first()
      .click();
    await expect(page.getByText('Saved to My applications')).toBeVisible();
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('link', { name: /Apply/ }).click(),
    ]);
    await popup.close();
    await page.getByRole('button', { name: 'Mark as applied' }).click();
    await expectNoA11yViolations(page);
    await page.goto(`${base}/jobs/tracker`);
    await expect(page.getByRole('heading', { name: 'Applied' })).toBeVisible();
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('ask an alumnus for a referral; they refer', async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/jobs?q=Backend Developer`);
    await page.getByRole('link', { name: 'DEMO: Backend Developer (freshers)' }).first().click();
    await expect(page.getByRole('heading', { name: 'Alumni at Nimbus Labs (demo)' })).toBeVisible();
    await page.getByRole('button', { name: /Ask for referral Rahul Varma/ }).click();
    await page
      .getByLabel('Why you’re a good fit')
      .fill('E2E: I built a Spring Boot library system and practise DSA daily; final-year CSE.');
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Request sent to Rahul Varma')).toBeVisible();

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const rahul = await ctx.newPage();
    await signIn(rahul, `rahul@${host}.example`, host);
    await rahul.goto(`${base}/referrals`);
    const req = rahul.getByRole('listitem').filter({ hasText: 'Spring Boot library system' });
    await expect(req).toBeVisible();
    await expectNoA11yViolations(rahul);
    await req.getByRole('button', { name: 'Respond' }).click();
    await rahul.getByLabel('Note (optional)').fill('E2E: submitted, watch your email.');
    await rahul.getByRole('button', { name: 'I’ve referred them' }).click();
    await expect(rahul.getByText('Marked as referred')).toBeVisible();
    await ctx.close();

    await page.goto(`${base}/referrals?box=sent`);
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Nimbus Labs' }).getByText('Referred'),
    ).toBeVisible();
    await expect(page.getByText('E2E: submitted, watch your email.')).toBeVisible();
  });

  test('the placement cell sees job sources and the verified starter boards', async ({ page }, info) => {
    const host = hostFor(info.project.name);
    await signIn(page, `tpo@${host}.example`, host);
    await page.goto(`http://${host}.localhost:4173/admin/job-sources`);
    await expect(page.getByRole('heading', { name: 'Verified starter boards' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Add a job source' }).click();
    await expect(page.getByLabel('Board name')).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
