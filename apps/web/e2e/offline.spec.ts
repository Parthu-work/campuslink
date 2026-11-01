import { test, expect, type Page } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/**
 * Build B13: the core screens open from the device's saved copy on a cold start without a
 * connection, safe writes made offline are sent on reconnect, and signing out wipes the copy.
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

/** The saved copy's keys (empty when nothing is saved, or the store does not exist yet). */
const savedKeys = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open('cl-offline');
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('queries')) return resolve([]);
          const keys = db.transaction('queries', 'readonly').objectStore('queries').getAllKeys();
          keys.onsuccess = () => resolve(keys.result.map(String));
          keys.onerror = () => resolve([]);
        };
      }),
  );

test.describe('offline and low-data mode', () => {
  test('a cold start offline shows the saved copy, and signing out wipes it', async ({
    page,
    context,
  }, info) => {
    test.setTimeout(120_000);
    const host = hostFor(info.project.name);
    await signIn(page, `ananya@${host}.example`, host);
    // The worker must control the page before the network goes away (it serves the app's code).
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(page.getByText(/Hi, Ananya/).first()).toBeVisible();
    await expect.poll(async () => (await savedKeys(page)).join(' '), { timeout: 15_000 }).toContain('["me"]');
    await expect.poll(async () => (await savedKeys(page)).join(' ')).toContain('["feed","for_you"]');
    // Other members' profiles are never saved.
    expect((await savedKeys(page)).some((k) => k.startsWith('["profile"'))).toBe(false);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText(/Hi, Ananya/).first()).toBeVisible();
    const pill = page.getByRole('status').filter({ hasText: 'You’re offline · saved' });
    await expect(pill).toBeVisible();
    await expect(page.getByText('This screen isn’t saved on your phone yet')).toHaveCount(0);
    await expectNoA11yViolations(page);

    await context.setOffline(false);
    // Back online, the session is checked again and live data replaces the saved copy.
    await expect(pill).toBeHidden({ timeout: 40_000 });
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page
      .getByRole('menuitem', { name: 'Sign out' })
      .or(page.getByRole('button', { name: 'Sign out' }))
      .first()
      .click();
    await page.waitForURL(/\/sign-in/);
    await expect.poll(() => savedKeys(page)).toEqual([]);
  });

  test('an RSVP made offline is sent when the connection is back', async ({ page, context }, info) => {
    test.setTimeout(90_000);
    const host = hostFor(info.project.name);
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`http://${host}.localhost:4173/events`);
    await page.getByRole('link', { name: 'DEMO: AMA on backend careers with Rahul' }).click();
    await expect(
      page.getByRole('heading', { name: 'DEMO: AMA on backend careers with Rahul', level: 1 }),
    ).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('button', { name: 'I’m going' }).click();
    await expect(
      page.getByText('Saved on this phone. It will be sent when you’re back online.'),
    ).toBeVisible();
    await expect(page.getByText('You’re going').first()).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText('1 change you made offline was saved.')).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByText('You’re going').first()).toBeVisible();
    // Leave the demo data as it was.
    await page.getByRole('button', { name: 'Can’t go' }).click();
    await expect(page.getByRole('button', { name: 'I’m going' })).toBeVisible();
  });

  test('data saver can be switched on in Preferences', async ({ page }, info) => {
    const host = hostFor(info.project.name);
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`http://${host}.localhost:4173/settings/preferences`);
    const group = page.getByRole('radiogroup', { name: 'Data saver' });
    await expect(group).toBeVisible();
    await group.getByRole('radio', { name: 'On' }).click();
    await expect(group.getByRole('radio', { name: 'On' })).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('cl:dataSaver'))).toBe('on');
    await expectNoA11yViolations(page);
    await group.getByRole('radio', { name: 'Automatic' }).click();
  });
});
