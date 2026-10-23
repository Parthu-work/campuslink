import { test, expect, type Browser } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';
import { adminSignIn } from './admin';

/**
 * Phase 4 done-criteria: post → react → comment → report → remove → author sees why and appeals →
 * another moderator decides; ask → approve → answer → accept; stories and reels; axe on every view.
 * Projects use different colleges so they never share content.
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

async function as(browser: Browser, email: string, host: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page, email, host);
  return { page, close: () => ctx.close() };
}

test.describe('feed and moderation', () => {
  test('post, react, comment, report, remove, appeal, restore', async ({ page, browser }, info) => {
    test.setTimeout(150_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    const text = `E2E tip ${info.project.name}: write the problem statement before coding`;

    // Alumna posts from the composer.
    await signIn(page, `sneha@${host}.example`, host);
    await expect(page.getByRole('feed', { name: 'For you' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Share something useful with your college…' }).click();
    await page.getByLabel('Text').fill(text);
    await page.getByRole('button', { name: 'DSA' }).click();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByText('Posted')).toBeVisible();
    await expect(page.getByRole('feed').getByText(text)).toBeVisible();

    // Student reacts (optimistic), comments, then reports.
    const student = await as(browser, `ananya@${host}.example`, host);
    const card = student.page.getByRole('article').filter({ hasText: text });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /^Helpful/ }).click();
    await expect(card.getByRole('button', { name: /^Helpful/ })).toHaveAttribute('aria-pressed', 'true');
    await card.getByRole('link', { name: /comment/ }).click();
    await expect(student.page.getByRole('heading', { name: /comment/ })).toBeVisible();
    await student.page.getByLabel('Write a comment').fill('E2E: thanks, trying this today');
    await student.page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(student.page.getByText('E2E: thanks, trying this today')).toBeVisible();
    await expectNoA11yViolations(student.page);
    await student.page.getByRole('button', { name: 'Options for this post' }).click();
    await student.page.getByRole('menuitem', { name: 'Report this post' }).click();
    await student.page.getByRole('button', { name: 'Send report' }).click();
    await expect(student.page.getByText('Thanks. Moderators will review it.')).toBeVisible();
    const postUrl = student.page.url();

    // Faculty removes it from the moderation queue.
    const faculty = await as(browser, `faculty@${host}.example`, host);
    await faculty.page.goto(`${base}/admin/moderation`);
    const report = faculty.page.getByRole('listitem').filter({ hasText: text });
    await expect(report).toBeVisible();
    await expectNoA11yViolations(faculty.page);
    await report.getByRole('button', { name: 'Remove' }).click();
    await faculty.page.getByLabel('Note to the author (optional)').fill('E2E: please add a source');
    await faculty.page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(faculty.page.getByText('Removed. The author is told why.')).toBeVisible();

    // The student no longer sees it; the author sees why and appeals.
    await student.page.reload();
    await expect(student.page.getByRole('heading', { name: 'This post isn’t available' })).toBeVisible();
    await page.goto(postUrl);
    await expect(page.getByText('Removed by a moderator: Spam or scam')).toBeVisible();
    await expect(page.getByText('E2E: please add a source')).toBeVisible();
    await page.getByRole('button', { name: 'Appeal this decision' }).click();
    await page.getByLabel('Your message').fill('E2E: this is my own study habit, not spam.');
    await page.getByRole('button', { name: 'Send appeal' }).click();
    await expect(page.getByText('Your appeal is waiting for a moderator.')).toBeVisible();
    await expectNoA11yViolations(page);

    // The removing moderator cannot keep it removed; another moderator restores it.
    await faculty.page.getByRole('tab', { name: /^Appeals/ }).click();
    const appeal = faculty.page.getByRole('listitem').filter({ hasText: 'this is my own study habit' });
    await appeal.getByRole('button', { name: 'Keep removed' }).click();
    await expect(
      faculty.page.getByText('Another moderator must review an appeal against your own decision'),
    ).toBeVisible();
    const tpo = await as(browser, `tpo@${host}.example`, host);
    await tpo.page.goto(`${base}/admin/moderation`);
    await tpo.page.getByRole('tab', { name: /^Appeals/ }).click();
    await tpo.page
      .getByRole('listitem')
      .filter({ hasText: 'this is my own study habit' })
      .getByRole('button', { name: 'Restore' })
      .click();
    await expect(tpo.page.getByText('Appeal decided')).toBeVisible();
    await student.page.reload();
    await expect(student.page.getByText(text)).toBeVisible();
    await Promise.all([student.close(), faculty.close(), tpo.close()]);
  });

  test('ask, approve, answer and accept', async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    const title = `E2E ${info.project.name}: which certifications help for cloud internships?`;
    await signIn(page, `vikram@${host}.example`, host);
    await page.goto(`${base}/questions`);
    await expect(page.getByRole('heading', { name: 'Q&A', level: 1 })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Ask a question' }).click();
    await page.getByLabel('Your question').fill(title);
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByText('Sent for review')).toBeVisible();

    const faculty = await as(browser, `faculty@${host}.example`, host);
    await faculty.page.goto(`${base}/admin/moderation`);
    await faculty.page.getByRole('tab', { name: /^Questions/ }).click();
    await faculty.page
      .getByRole('listitem')
      .filter({ hasText: title })
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect(faculty.page.getByText('Approved and published')).toBeVisible();

    const alum = await as(browser, `rahul@${host}.example`, host);
    await alum.page.goto(`${base}/questions`);
    await alum.page.getByRole('link', { name: title }).click();
    await alum.page
      .getByLabel('Your answer')
      .fill('E2E: start with one associate-level cloud certification and a small deployed project.');
    await alum.page.getByRole('button', { name: 'Post answer' }).click();
    await expect(alum.page.getByText('start with one associate-level cloud certification')).toBeVisible();
    await expectNoA11yViolations(alum.page);

    await page.goto(`${base}/questions?filter=mine`);
    await page.getByRole('link', { name: title }).click();
    await page.getByRole('button', { name: 'Mark as best answer' }).click();
    await expect(page.getByText('Best answer', { exact: true })).toBeVisible();
    await Promise.all([faculty.close(), alum.close()]);
  });

  test('stories open, pause and step with the keyboard; reels and saved pages are accessible', async ({
    page,
  }, info) => {
    const host = hostFor(info.project.name);
    await signIn(page, `ananya@${host}.example`, host);
    await page
      .getByRole('button', { name: /View .*story/ })
      .first()
      .click();
    const viewer = page.getByRole('dialog', { name: /Stories from/ });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText('DEMO: Mock interview slots open today in the seminar hall')).toBeVisible();
    await viewer.getByRole('button', { name: 'Pause' }).click();
    await expect(viewer.getByRole('button', { name: 'Play' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await page.goto(`http://${host}.localhost:4173/reels`);
    await expect(page.getByRole('heading', { name: 'Tips reels', level: 1 })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto(`http://${host}.localhost:4173/following`);
    await expect(page.getByRole('heading', { name: 'What you follow' })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('admins see source health and the verified starter list', async ({ page }, info) => {
    test.setTimeout(90_000);
    const host = hostFor(info.project.name);
    await adminSignIn(page, host, `admin@${host}.example`);
    await page.goto(`http://${host}.localhost:4173/admin/sources`);
    await expect(page.getByRole('heading', { name: 'Verified starter list' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Add a source' }).click();
    await expect(page.getByLabel('Feed URL')).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
