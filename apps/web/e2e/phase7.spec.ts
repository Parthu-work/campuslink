import { test, expect } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';
import { adminSignIn } from './admin';

/**
 * Phase 7 done-criteria: RSVP to an event, add it to a calendar and ask in its Q&A; staff create
 * an event; a student sees XP and badges and redeems a reward an admin hands over; the admin
 * analytics dashboard renders and exports.
 */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test.describe('events, progress, rewards and analytics', () => {
  test('RSVP, calendar export and the live Q&A queue', async ({ page }, info) => {
    test.setTimeout(90_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    await signIn(page, `vikram@${host}.example`, host);
    await page.goto(`${base}/events`);
    await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('link', { name: 'DEMO: AMA on backend careers with Rahul' }).click();
    await expect(
      page.getByRole('heading', { name: 'DEMO: AMA on backend careers with Rahul', level: 1 }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'I’m going' }).click();
    await expect(page.getByText('You’re going').first()).toBeVisible();
    await expect(page.getByText('The online link appears here 15 minutes before the start.')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Add to calendar' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('event.ics');
    await page
      .getByLabel('Ask a question for the host')
      .fill(`E2E: how do I start with system design? (${info.project.name})`);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(
      page.getByText(`E2E: how do I start with system design? (${info.project.name})`),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('staff create an event', async ({ page }, info) => {
    test.setTimeout(90_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    const title = `E2E Placement drive ${info.project.name}`;
    await signIn(page, `faculty@${host}.example`, host);
    await page.goto(`${base}/events/new`);
    await expect(page.getByRole('heading', { name: 'New event', level: 1 })).toBeVisible();
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('What it’s about').fill('E2E demo drive used by the automated tests only.');
    await page.getByLabel('Type').selectOption('drive');
    await page.getByLabel('Where').selectOption('in_person');
    const d = new Date(Date.now() + 5 * 86_400_000);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await page.getByLabel('Starts').fill(`${day}T10:00`);
    await page.getByLabel('Ends').fill(`${day}T13:00`);
    await page.getByLabel('Venue').fill('E2E demo hall');
    await page.getByLabel('Places').fill('50');
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Attendees' })).toBeVisible();
  });

  test('progress, rewards and fulfilment', async ({ page, browser }, info) => {
    test.setTimeout(120_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/progress`);
    await expect(page.getByRole('heading', { name: 'Your progress', level: 1 })).toBeVisible();
    await expect(page.getByText('First step', { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto(`${base}/rewards`);
    await expect(page.getByRole('heading', { name: 'Rewards', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Request' }).first().click();
    await expect(page.getByText('Requested. The college will let you know.')).toBeVisible();
    await expect(page.getByText('Waiting').first()).toBeVisible();
    await expectNoA11yViolations(page);

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const admin = await ctx.newPage();
    await adminSignIn(admin, host, `admin@${host}.example`);
    await admin.goto(`${base}/admin/rewards`);
    await admin.getByRole('button', { name: 'Mark handed over' }).first().click();
    await expect(admin.getByText('No requests here.')).toBeVisible();
    await admin.goto(`${base}/admin/analytics`);
    await expect(admin.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await expect(admin.getByText('Counts under 5 are shown as <5').first()).toBeVisible();
    await expectNoA11yViolations(admin);
    const [csv] = await Promise.all([
      admin.waitForEvent('download'),
      admin.getByRole('button', { name: 'Summary' }).click(),
    ]);
    expect(csv.suggestedFilename()).toBe('summary.csv');
    await ctx.close();
  });
});
