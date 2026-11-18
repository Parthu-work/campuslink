import { test, expect } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Phase 3 done-criteria: a student requests, an alumnus accepts, both chat and join video. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test.describe('mentorship', () => {
  test('a student requests a session, the alumna accepts, and they chat live', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(120_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;

    // Student: find a mentor and send a structured request with a time.
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`${base}/mentors?view=browse`);
    await expect(page.getByRole('heading', { name: 'Mentors', level: 1 })).toBeVisible();
    await page.getByPlaceholder('Search by name, company or topic').fill('Sneha');
    await page.getByRole('link', { name: /Sneha Reddy/ }).click();
    await expect(page.getByRole('heading', { name: 'Sneha Reddy', level: 1 })).toBeVisible();
    // Three steps in a sheet (prompt 3, U6): what you need, your goal, when, with a preview.
    await page.getByRole('button', { name: 'Request mentorship' }).click();
    const sheet = page.getByRole('dialog', { name: /Ask Sneha for help/ });
    await sheet.getByRole('radio', { name: /1:1 video call/ }).click();
    await expect(sheet.getByText(/A video call about your plans/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Continue' }).click();
    await sheet
      .getByLabel('What are you working towards?')
      .fill('switch from ECE coursework to a data analyst role.');
    await sheet
      .getByLabel('What would help most?')
      .fill('a plan for the next three months and project ideas.');
    await sheet.getByRole('button', { name: 'Continue' }).click();
    await sheet.getByRole('radiogroup', { name: 'Time' }).getByRole('radio').first().click();
    // Exactly what Sneha will read, in the headings mentors already know.
    const preview = sheet.getByRole('region', { name: 'What Sneha will see' });
    await expect(preview).toContainText('Goal: switch from ECE coursework to a data analyst role.');
    await expect(preview).toContainText('What I need: a plan for the next three months and project ideas.');
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible();

    // Mentor: accept from the inbox.
    const mentorCtx = await browser.newContext();
    const mentor = await mentorCtx.newPage();
    await signIn(mentor, `sneha@${host}.example`, host);
    await mentor.goto(`${base}/mentorship`);
    await expect(mentor.getByText('Switch from ECE coursework to a data analyst role')).toBeVisible();
    await expectNoA11yViolations(mentor);
    await mentor.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(mentor.getByText('Accepted', { exact: true })).toBeVisible();
    await mentor.getByRole('link', { name: 'Open chat' }).click();
    await expect(mentor.getByRole('heading', { name: 'Ananya K', level: 1 })).toBeVisible();
    await mentor.getByLabel('Write a message').fill('Hello Ananya, happy to help!');
    await mentor.keyboard.press('Enter');
    await expect(mentor.getByText('Hello Ananya, happy to help!')).toBeVisible();

    // Student: the chat is open now; replies arrive live on the mentor's screen, with typing.
    await page.goto(`${base}/messages`);
    await page.getByRole('link', { name: /Sneha Reddy/ }).click();
    await expect(page.getByText('Hello Ananya, happy to help!')).toBeVisible();
    await page.getByLabel('Write a message').fill('Thank you, Sneha!');
    await expect(mentor.getByText('Ananya is typing…')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(mentor.getByText('Thank you, Sneha!')).toBeVisible(); // no reload: socket delivery
    await expectNoA11yViolations(page);
    await expect(page.getByText('Seen')).toBeVisible();
    await mentorCtx.close();
  });

  test('both sides of a booked session can join the video room around its time', async ({ page }, info) => {
    const host = hostFor(info.project.name);
    await signIn(page, `ananya@${host}.example`, host);
    await page.goto(`http://${host}.localhost:4173/sessions`);
    const card = page.locator('li').filter({ hasText: 'Rahul Varma' }).filter({ hasText: 'Mock interview' });
    await expect(card).toBeVisible();
    await expectNoA11yViolations(page);
    await card.getByRole('button', { name: 'Join video' }).click();
    await expect(page.getByRole('heading', { name: 'Your video room' })).toBeVisible();
    const link = page.getByRole('link', { name: /Open video call/ });
    await expect(link).toHaveAttribute('href', /^https:\/\/meet\.jit\.si\/mentor-[a-z2-7]{32}#/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expectNoA11yViolations(page);
    const studentRoom = (await link.getAttribute('href'))?.split('#')[0];
    // The mentor gets the same room.
    await page.context().clearCookies();
    await signIn(page, `rahul@${host}.example`, host);
    await page.goto(`http://${host}.localhost:4173/sessions`);
    await page
      .locator('li')
      .filter({ hasText: 'Ananya K' })
      .getByRole('button', { name: 'Join video' })
      .click();
    const mentorRoom = (
      await page.getByRole('link', { name: /Open video call/ }).getAttribute('href')
    )?.split('#')[0];
    expect(mentorRoom).toBe(studentRoom);
  });

  test('Alumni Match suggests mentors with reasons, and the mentor dashboard is accessible', async ({
    page,
  }, info) => {
    // Two members across five screens with three accessibility scans: it took 29 of 30 s locally.
    test.setTimeout(90_000);
    const host = hostFor(info.project.name);
    const base = `http://${host}.localhost:4173`;
    await signIn(page, `vikram@${host}.example`, host);
    await page.goto(`${base}/mentors`);
    // Prompt 3, U6: a ranked list beside the selected senior on a wide screen; one card on a phone.
    if (info.project.name === 'desktop') {
      await expect(page.getByRole('region', { name: 'Why this match' })).toBeVisible();
      await expectNoA11yViolations(page);
      await page.getByRole('link', { name: 'View full profile' }).click();
    } else {
      await expectNoA11yViolations(page);
      await page.getByRole('button', { name: /^Not now: / }).click();
      await page
        .getByRole('main')
        .getByRole('region')
        .getByRole('heading', { level: 2 })
        .getByRole('link')
        .click();
    }
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request mentorship' })).toBeVisible();

    await page.context().clearCookies();
    await signIn(page, `rahul@${host}.example`, host);
    await page.goto(`${base}/mentor`);
    await expect(page.getByRole('heading', { name: /^You helped/ })).toBeVisible();
    await expect(page.getByText('DEMO: very practical resume feedback.')).toBeVisible();
    await expectNoA11yViolations(page);
    const toggle = page.getByRole('switch', { name: 'Taking requests' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await page.goto(`${base}/settings/notifications`);
    await expect(page.getByText('What you hear about, and how')).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto(`${base}/notifications`);
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
