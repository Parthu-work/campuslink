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
    await expect(page.getByText('DFA', { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);

    // Every branch and batch: Ananya (CSE 2027) takes it.
    await page.context().clearCookies();
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/study`);
    await expect(page.getByRole('button', { name: 'New subject' })).toHaveCount(0);
    await page.getByPlaceholder('Search by name or code').fill(name);
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('Pumping lemma for regular languages')).toBeVisible();
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
    const chatbot = page.getByRole('switch', { name: 'Study chatbot' });
    if ((await chatbot.getAttribute('aria-checked')) !== 'true') await chatbot.click();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('All changes saved')).toBeVisible();
    await expect(page.getByText('On (demo)')).toBeVisible();
    // The data notice explains what would leave the college, before any external provider is used.
    await expect(page.getByText('What leaves your college')).toBeVisible();

    await page.context().clearCookies();
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/study`);
    await expect(page.getByText('Demo assistant')).toBeVisible();
  });
});
