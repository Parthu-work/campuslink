import { test, expect } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/**
 * Phase 6 done-criteria: a student explores the Career Galaxy, opens a roadmap and marks progress
 * with a weekly goal; an alumnus drafts and submits a roadmap; a faculty reviewer publishes it.
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test.describe('roadmaps', () => {
  test('explore the galaxy, open a roadmap and mark progress', async ({ page }, info) => {
    test.setTimeout(90_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/roadmaps`);
    await expect(page.getByRole('heading', { name: 'Roadmaps', level: 1 })).toBeVisible();
    // Seeded progress: Ananya follows the SDE roadmap.
    await expect(page.getByRole('heading', { name: 'My roadmaps' })).toBeVisible();
    await page.getByRole('button', { name: 'Galaxy', exact: true }).click();
    await expect(page.getByRole('group', { name: /Career Galaxy/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Backend Developer, 10 steps/ })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByPlaceholder('Search roadmaps').fill('Backend');
    await page.getByRole('link', { name: 'Backend Developer' }).first().click();
    await expect(page.getByRole('heading', { name: 'Backend Developer', level: 1 })).toBeVisible();
    await expect(page.getByText('From the researched library')).toBeVisible();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByRole('button', { name: /One server-side language/ }).click();
    const dialog = page.getByRole('dialog', { name: 'One server-side language' });
    await expect(dialog.getByRole('link', { name: /Python/ }).first()).toBeVisible();
    await expectNoA11yViolations(page);
    await dialog.getByRole('button', { name: 'Mark as done' }).click();
    await expect(dialog.getByRole('button', { name: 'Mark as not done' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('1 of 10 done')).toBeVisible();
    await page.getByLabel('Weekly goal').selectOption('2');
    await expect(page.getByText('Weekly goal saved')).toBeVisible();
    await expect(page.getByText('This week: 1 of 2.')).toBeVisible();
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    await expect(page.getByRole('button', { name: /One server-side language, Skill, Done/ })).toBeVisible();
    await expectNoA11yViolations(page);
    // Students can't edit or review.
    await expect(page.getByRole('link', { name: 'Suggest an edit' })).toHaveCount(0);
  });

  test('draft, submit, review and publish', async ({ browser }, info) => {
    test.setTimeout(120_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    const title = `E2E Placement Prep ${info.project.name}`;

    const authorCtx = await browser.newContext();
    const author = await authorCtx.newPage();
    await signIn(author, `rahul@${host}.example`, host);
    await author.goto(`${base}/roadmaps/new`);
    await expect(author.getByRole('heading', { name: 'New roadmap', level: 1 })).toBeVisible();
    await author.getByLabel('Title', { exact: true }).fill(title);
    await author
      .getByLabel(/^Summary/)
      .fill('E2E demo roadmap: a short path to placement readiness, used only by the automated tests.');
    await author.getByRole('button', { name: 'Add link' }).first().click();
    await author.getByRole('button', { name: 'Add link' }).first().click();
    await author.getByLabel('Link 1 title').first().fill('E2E demo source one');
    await author.getByLabel('Link 1 address').first().fill('https://example.org/e2e-one');
    await author.getByLabel('Link 2 title').first().fill('E2E demo source two');
    await author.getByLabel('Link 2 address').first().fill('https://example.org/e2e-two');
    await author.getByLabel('Step title').fill('Build a placement project');
    await author
      .getByLabel('What to learn and why it matters')
      .fill('Build and publish one small project end to end.');
    await author.getByLabel('Type').selectOption('project');
    await expect(author.getByText('Ready for review.')).toBeVisible();
    await expectNoA11yViolations(author);
    await author.getByRole('button', { name: 'Save and submit' }).click();
    await expect(author.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(author.getByText('Version 1 is waiting for review.')).toBeVisible();
    await authorCtx.close();

    const reviewerCtx = await browser.newContext();
    const reviewer = await reviewerCtx.newPage();
    await signIn(reviewer, `faculty@${host}.example`, host);
    await reviewer.goto(`${base}/roadmaps/review`);
    await expect(reviewer.getByRole('heading', { name: 'Review roadmaps', level: 1 })).toBeVisible();
    await expectNoA11yViolations(reviewer);
    await reviewer.getByRole('link', { name: `${title} · v1` }).click();
    await expect(reviewer.getByText('First version, with 1 step.')).toBeVisible();
    await reviewer.getByRole('button', { name: 'Approve and publish' }).click();
    await expect(reviewer.getByText('Published', { exact: true }).first()).toBeVisible();
    await expectNoA11yViolations(reviewer);
    await reviewerCtx.close();

    const studentCtx = await browser.newContext();
    const student = await studentCtx.newPage();
    await signIn(student, `vikram@${host}.example`, host);
    await student.goto(`${base}/roadmaps?q=${encodeURIComponent('E2E Placement')}`);
    await student.getByRole('button', { name: 'List', exact: true }).click();
    await student.getByRole('link', { name: title }).click();
    await expect(student.getByText('By Rahul', { exact: false })).toBeVisible();
    await studentCtx.close();
  });
});
