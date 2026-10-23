import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { adminSignIn } from './admin';
import { expectNoA11yViolations, signIn } from './helpers';

const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');
const SYLLABUS = [
  'UNIT - I: Finite Automata: Alphabet, strings and languages; DFA, NFA',
  'UNIT - II Regular Expressions',
  '1. Pumping lemma for regular languages',
].join('\n');

test.describe('study', () => {
  test('faculty create a subject from a pasted syllabus; a student finds it', async ({ page }, info) => {
    test.setTimeout(90_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    const name = `E2E Automata ${info.project.name} ${Date.now() % 100000}`;
    await signIn(page, `faculty@${host}.example`, host);
    await page.goto(`${base}/study`);
    await expect(page.getByRole('heading', { name: 'Study', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'New subject' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New subject' });
    await dialog.getByLabel('Subject name').fill(name);
    await dialog.getByLabel('Code').fill(`E2E${Date.now() % 100000}`);
    await dialog.getByRole('button', { name: 'Create subject' }).click();
    await page.waitForURL(/\/study\/[a-f0-9]{24}$/);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Add the syllabus' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit syllabus' });
    await sheet.getByLabel('Paste the syllabus').fill(SYLLABUS);
    await sheet.getByRole('button', { name: 'Suggest units and topics' }).click();
    await expect(sheet.getByLabel('Unit 1', { exact: true })).toHaveValue('Finite Automata');
    await expect(sheet.getByLabel('Topic 1 of unit 2')).toHaveValue('Pumping lemma for regular languages');
    await expectNoA11yViolations(page);
    await sheet.getByRole('button', { name: 'Save syllabus' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: /Finite Automata/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // The library's topic filter lists DFA too: look in the syllabus.
    await expect(
      page.getByRole('region', { name: 'Syllabus' }).getByText('DFA', { exact: true }),
    ).toBeVisible();
    // The library's filters and tab row must not widen the page on phones. (A phone widens its
    // layout to fit, so compare with the emulated screen, not innerWidth.)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 0,
    );
    await expectNoA11yViolations(page);

    // Every branch and batch: Ananya (CSE 2027) takes it.
    await page.context().clearCookies();
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/study`);
    await expect(page.getByRole('button', { name: 'New subject' })).toHaveCount(0);
    await page.getByPlaceholder('Search by name or code').fill(name);
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Syllabus' }).getByText('Pumping lemma for regular languages'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit subject' })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test('an admin turns on the demo assistant; students see it is a demo', async ({ page }, info) => {
    test.setTimeout(120_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    await adminSignIn(page, host, `admin@${host}.example`);
    await page.goto(`${base}/admin/ai`);
    await expect(page.getByRole('heading', { name: 'AI study assistant' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('radio', { name: /Demo \(built in\)/ }).click();
    await page.getByLabel('Embedding provider').selectOption('mock');
    const chatbot = page.getByRole('switch', { name: 'Study chatbot' });
    if ((await chatbot.getAttribute('aria-checked')) !== 'true') await chatbot.click();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('All changes saved')).toBeVisible();
    await expect(page.getByText('On (demo)')).toBeVisible();
    // The data notice explains what would leave the college, before any external provider is used.
    await expect(page.getByText('What leaves your college')).toBeVisible();
    // Semantic search with the demo embeddings: the index panel reports every passage's vector.
    await expect(page.getByRole('heading', { name: 'Search index' })).toBeVisible();
    await expect(page.getByText(/passages? can be found by meaning/).first()).toBeVisible();
    await expectNoA11yViolations(page);

    await page.context().clearCookies();
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/study`);
    await expect(page.getByText('Demo assistant')).toBeVisible();
  });

  test('faculty upload notes and a PDF; students read, search and open the right page', async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    const name = `E2E Library ${info.project.name} ${Date.now() % 100000}`;
    await signIn(page, `faculty@${host}.example`, host);
    await page.goto(`${base}/study`);
    await page.getByRole('button', { name: 'New subject' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New subject' });
    await dialog.getByLabel('Subject name').fill(name);
    await dialog.getByLabel('Code').fill(`LIB${Date.now() % 100000}`);
    await dialog.getByRole('button', { name: 'Create subject' }).click();
    await page.waitForURL(/\/study\/[a-f0-9]{24}$/);
    const subjectUrl = page.url();

    await page.getByRole('button', { name: 'Add material' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add material' });
    await sheet.locator('input[type="file"][multiple]').setInputFiles([
      {
        name: 'demo-lecture.pdf',
        mimeType: 'application/pdf',
        buffer: readFileSync('e2e/fixtures/demo-lecture.pdf'),
      },
      {
        name: 'demo-notes.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('# Demo notes\n\nA context-free grammar has productions (demo text).\n'),
      },
    ]);
    await expect(sheet.getByText('demo-lecture.pdf')).toBeVisible();
    await expectNoA11yViolations(page);
    await sheet.getByText('I have the right to share these files').click();
    await sheet.getByRole('button', { name: 'Upload 2 files' }).click();
    await expect(sheet.getByRole('status').filter({ hasText: 'Ready' })).toHaveCount(2, { timeout: 60_000 });
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('link', { name: 'demo lecture' })).toBeVisible();
    await page.getByRole('link', { name: 'demo lecture' }).click();
    await page.waitForURL(/\/m\/[a-f0-9]{24}/);
    await expect(page.getByRole('group', { name: 'Page 1 of 2' })).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder('Search in this PDF').fill('pumping');
    await expect(page.getByText('Found on pages:')).toBeVisible();
    await expectNoA11yViolations(page);

    // Ananya (CSE 2027) takes every-branch subjects: she finds the passage and lands on its page.
    await page.context().clearCookies();
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(subjectUrl);
    await page.getByPlaceholder('Search this subject’s material').fill('pumping lemma');
    const hit = page.getByRole('link', { name: /demo lecture/ });
    await expect(hit).toBeVisible();
    await hit.click();
    await page.waitForURL(/page=2/);
    await expect(page.getByRole('group', { name: 'Page 2 of 2' })).toBeVisible({ timeout: 20_000 });
    await expectNoA11yViolations(page);
  });

  test('a student asks the assistant, follows a citation to the page, and uses slash commands', async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    // Faculty share a lecture (the demo assistant was turned on above).
    await signIn(page, `faculty@${host}.example`, host);
    await page.goto(`${base}/study`);
    await page.getByRole('button', { name: 'New subject' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New subject' });
    await dialog.getByLabel('Subject name').fill(`E2E Chat ${info.project.name} ${Date.now() % 100000}`);
    await dialog.getByLabel('Code').fill(`CHT${Date.now() % 100000}`);
    await dialog.getByRole('button', { name: 'Create subject' }).click();
    await page.waitForURL(/\/study\/[a-f0-9]{24}$/);
    const subjectUrl = page.url();
    await page.getByRole('button', { name: 'Add material' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add material' });
    await sheet.locator('input[type="file"][multiple]').setInputFiles([
      {
        name: 'demo-lecture.pdf',
        mimeType: 'application/pdf',
        buffer: readFileSync('e2e/fixtures/demo-lecture.pdf'),
      },
    ]);
    await sheet.getByText('I have the right to share these files').click();
    await sheet.getByRole('button', { name: 'Upload 1 file' }).click();
    await expect(sheet.getByRole('status').filter({ hasText: 'Ready' })).toHaveCount(1, { timeout: 60_000 });

    // Ananya asks from the subject page; the answer cites page 2.
    await page.context().clearCookies();
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(subjectUrl);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const chat = page.getByRole('dialog', { name: 'Study assistant' });
    const box = chat.getByRole('combobox', { name: 'Your question' });
    await box.fill('What does the pumping lemma help show?');
    await box.press('Enter');
    const source = chat.getByRole('link', { name: /demo lecture/i }).first();
    await expect(source).toBeVisible({ timeout: 20_000 });
    await expect(chat.getByText('Answers are generated by AI', { exact: false })).toBeVisible();
    await expectNoA11yViolations(page);
    await source.click();
    await page.waitForURL(/\/m\/[a-f0-9]{24}\?page=2/);
    await expect(page.getByRole('group', { name: 'Page 2 of 2' })).toBeVisible({ timeout: 20_000 });

    // The full-screen assistant: the command menu is keyboard-operable; /help and /quiz work.
    await page.goto(`${base}/study/chat`);
    const input = page.getByRole('combobox', { name: 'Your question' });
    await input.fill('/he');
    await expect(page.getByRole('listbox', { name: 'Commands' })).toBeVisible();
    await expect(page.getByRole('option', { name: /\/help/ })).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(input).toHaveValue('/help ');
    await input.press('Enter');
    await expect(page.getByRole('button', { name: /\/videos/ })).toBeVisible();
    await input.fill('/quiz pumping lemma regular languages');
    await input.press('Enter');
    const check = page.getByRole('button', { name: 'Check my answers' });
    await expect(check).toBeVisible({ timeout: 20_000 });
    for (const group of await page.getByRole('radiogroup').all())
      await group.getByRole('radio').first().click();
    for (const field of await page.getByRole('textbox', { name: /Your answer to question/ }).all())
      await field.fill('demo');
    await check.click();
    await expect(page.getByText(/You got \d+ of \d+/)).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
