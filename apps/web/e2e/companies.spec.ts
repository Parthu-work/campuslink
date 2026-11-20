import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/**
 * Prompt 2, G10: company pages from the Placement Graph, and the Interview Experience Bank: a placed
 * student shares their interview, faculty publish it, and juniors read it on the company page.
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');
const COMPANY = 'Kestrel Analytics (demo)';

test('a placed student shares an interview, faculty publish it, juniors read it on the company page', async ({
  page,
}, info) => {
  test.slow();
  const host = hostFor(info.project.name);
  const marker = `${info.project.name}-${Date.now()}`;
  const question = `Walk me through a dashboard you built (${marker}).`;

  await signIn(page, `vikram@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/companies`);
  await expect(page.getByRole('heading', { level: 1, name: 'Companies' })).toBeVisible();
  await expect(page.getByRole('link', { name: COMPANY })).toBeVisible();
  // Prompt 3, U7: the first visit asks which companies the student is aiming for (private);
  // the answer puts them first, marked.
  const targets = page.getByRole('group', { name: 'Which companies are you aiming for?' });
  await expect(targets).toBeVisible();
  await expectNoA11yViolations(page);
  await targets.getByRole('button', { name: COMPANY }).click();
  await expect(targets.getByRole('button', { name: COMPANY })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Your target companies are saved').first()).toBeVisible();
  await expect(targets).toBeHidden();
  const first = page.getByRole('main').getByRole('listitem').first();
  await expect(first.getByRole('link', { name: COMPANY })).toBeVisible();
  await expect(first.getByText('Your target')).toBeVisible();

  await page.getByRole('link', { name: COMPANY }).click();
  await expect(page.getByRole('heading', { level: 1, name: COMPANY })).toBeVisible();
  await expect(page.getByText('Placed (verified)')).toBeVisible();
  // Seniors who work there and mentor, from the mentor list (the seed's Kestrel data analyst).
  const seniors = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Seniors there who mentor' }) });
  await expect(seniors.getByRole('link', { name: /^Ask / }).first()).toBeVisible();
  // The demo year (G13) clears the five-record threshold: counts, a median band per batch and pass
  // rates show; small cells read "<5"; pay appears only as a band, never an exact CTC.
  await expect(page.getByText('Median CTC band').first()).toBeVisible();
  const pay = await page.getByText(/LPA/).allInnerTexts();
  expect(pay.length).toBeGreaterThan(0);
  for (const t of pay) expect(t.trim()).toMatch(/^(Under ₹\d+ LPA|₹\d+–\d+ LPA|₹\d+ LPA and above)$/);
  await expectNoA11yViolations(page);

  await page.getByRole('link', { name: 'Share your interview' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Share your interview' })).toBeVisible();
  await page.getByLabel('Company', { exact: true }).selectOption({ label: COMPANY });
  await page.getByLabel('Role', { exact: true }).fill('Data Analyst');
  await page.getByLabel('Question 1').nth(1).fill(question);
  await page
    .getByLabel('Tips for juniors (optional)')
    .fill('Know SQL joins well and explain one project end to end.');
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your interview write-ups' })).toBeVisible();
  // The write-up's own list item (its rounds and questions are lists inside it).
  const mine = page.getByRole('listitem').filter({ hasText: marker }).first();
  await expect(mine.getByText('Waiting for review')).toBeVisible();
  await expectNoA11yViolations(page);

  await page.context().clearCookies();
  await signIn(page, `faculty@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/admin/experiences`);
  await expect(page.getByRole('tab', { name: 'To review' })).toBeVisible();
  const pending = page.getByRole('listitem').filter({ hasText: marker }).first();
  await expect(pending).toBeVisible();
  await expectNoA11yViolations(page);
  await pending.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(marker)).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, `ananya@${host}.example`, host);
  await page.goto(`http://${host}.localhost:4173/companies`);
  await page.getByRole('link', { name: COMPANY }).click();
  const published = page.getByRole('listitem').filter({ hasText: marker }).first();
  await expect(published).toBeVisible();
  // Vikram chose to show his first name.
  await expect(published.getByText(/^Vikram/)).toBeVisible();
  await expect(published.getByText('Verified offer')).toBeVisible();
  await expectNoA11yViolations(page);
});

test('a student’s first visit paints the targets question with the list, not after it', async ({
  page,
}, info) => {
  // Prompt 3, U13: the question ("Which companies are you aiming for?") arrived after the list and
  // pushed it down (Lighthouse CLS 0.29); now both wait for the student's targets and paint together.
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await page.evaluate(() => localStorage.removeItem('cl:targets-asked'));
  await page.goto(`http://${host}.localhost:4173/companies`);
  await expect(page.getByRole('link', { name: COMPANY })).toBeVisible();
  await page.waitForTimeout(1000);
  const cls = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          })[])
            if (!e.hadRecentInput) total += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => resolve(total), 300);
      }),
  );
  expect(cls).toBeLessThan(0.05);
});
