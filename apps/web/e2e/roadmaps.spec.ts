import { test, expect } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/**
 * Career paths (prompt 3, U3; phase 6 before it): a student finds a path, starts it, marks the
 * next step done (and undoes it), sets a pace and opens the map; an alumnus drafts and submits a
 * path; a faculty reviewer publishes it.
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test.describe('roadmaps', () => {
  test('find a path, start it, mark a step done and undo it, set a pace', async ({ page }, info) => {
    test.setTimeout(90_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/roadmaps`);
    await expect(page.getByRole('heading', { name: 'Career paths', level: 1 })).toBeVisible();
    // Seeded progress: Ananya follows the SDE path, so it is first, with its next step.
    await expect(page.getByRole('heading', { name: 'Continue', level: 2 })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Continue/ }).first()).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByPlaceholder('Search roadmaps').fill('Backend');
    await page
      .getByRole('link', { name: /^Backend Developer/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Backend Developer', level: 1 })).toBeVisible();
    // Where it comes from is in the About sheet, not above the steps.
    await page.getByRole('button', { name: 'About this' }).click();
    await expect(page.getByRole('dialog').getByText('From the researched library')).toBeVisible();
    await page.keyboard.press('Escape');

    // Start: follows the path and opens its first step.
    await page.getByRole('button', { name: 'Start this path' }).click();
    const dialog = page.getByRole('dialog', { name: 'One server-side language' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: /Python/ }).first()).toBeVisible();
    await expectNoA11yViolations(page);
    // Mark done, then Undo from the toast.
    await dialog.getByRole('button', { name: 'Mark done' }).click();
    await expect(dialog.getByRole('button', { name: 'Mark as not done' })).toBeVisible();
    // Undo from the toast, above the open sheet (which stays open).
    const toastUndo = page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo' });
    await expect(toastUndo).toBeVisible();
    await toastUndo.click({ force: true });
    await expect(dialog.getByRole('button', { name: 'Mark done' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Mark done' }).click();
    await expect(dialog.getByRole('button', { name: 'Mark as not done' })).toBeVisible();
    // The step is in the URL: Back (the Android back gesture) closes it and stays on the path.
    await expect(page).toHaveURL(/[?&]step=/);
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Backend Developer', level: 1 })).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]step=/);
    await expect(page.getByText(/^1 of 10 steps · next: /)).toBeVisible();
    // The pace: one line, a select only while changing it.
    await page.getByRole('button', { name: 'Set your pace' }).click();
    await page.getByLabel('Hours a week').selectOption('6');
    await expect(page.getByText('Your pace: 6 h a week')).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: /(On track: |This week: )\d+ of 6 h/ }),
    ).toBeVisible();
    // The map is one tap away.
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.getByRole('button', { name: /One server-side language, Skill, Done/ })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Steps', exact: true }).click();
    // Students can't edit or review.
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Suggest an edit' })).toHaveCount(0);
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
    await student.getByRole('link', { name: title }).click();
    await expect(student.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    // Who wrote it is in the path's About sheet.
    await student.getByRole('button', { name: 'About this' }).click();
    await expect(student.getByRole('dialog').getByText('By Rahul', { exact: false })).toBeVisible();
    await studentCtx.close();
  });
});
