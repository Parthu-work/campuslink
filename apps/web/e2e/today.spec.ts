import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, signIn } from './helpers';

/** Prompt 3, U5: Home's one clear "Today". Each project uses its own college. */
const hostFor = (project: string) => (project === 'mobile' ? 'mrce' : 'dpit');

test('a student’s Home: one Today card, the next steps, people with reasons, then the college', async ({
  page,
}, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `ananya@${host}.example`, host);
  await expect(page.getByRole('heading', { level: 1, name: 'Hi, Ananya' })).toBeVisible();
  // The Today card: one large action, and it goes where it says.
  const action = page.getByRole('main').getByRole('link', { name: /^(Join|Register|Continue)$/ });
  await expect(action).toHaveCount(1);
  const href = (await action.getAttribute('href')) ?? '';
  expect(href).toMatch(/^\/(sessions\/[a-f0-9]{24}\?join=1|placements\/|roadmaps\/[^?]+\?step=)/);
  // The Next Step's other items, without the one in the Today card.
  await expect(page.getByRole('heading', { name: 'Your next steps' })).toBeVisible();
  if (href.startsWith('/roadmaps/'))
    await expect(page.getByRole('main').locator(`a[href="${href}"]`)).toHaveCount(1);
  // People to follow say why, from the data: the branch, or the college.
  const suggested = page.getByRole('region', { name: 'Suggested for you' });
  if (await suggested.count())
    await expect(suggested.getByText(/^Alumnus of your (branch \(\w+\)|college)$/).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'From your college' })).toBeVisible();
  await expect(page.getByRole('feed', { name: 'For you' }).getByRole('article').first()).toBeVisible();
  // No second featured card style: One Useful Thing is a post in the feed.
  await expect(page.getByRole('region', { name: 'One useful thing today' })).toHaveCount(0);
  // Wide screens add "Coming up"; phones carry the urgent item in the Today card.
  const coming = page.getByRole('complementary', { name: 'Coming up' });
  if (info.project.name === 'desktop') await expect(coming).toBeVisible();
  else await expect(coming).toHaveCount(0);
  await expectNoA11yViolations(page);

  await action.click();
  await page.waitForURL((u) => u.pathname === href.split('?')[0]);
});

test('an alumna’s Home leads with who is waiting, and Accept takes one tap', async ({ page }, info) => {
  const host = hostFor(info.project.name);
  await signIn(page, `fatima@${host}.example`, host);
  const waiting = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Waiting for you' }) });
  await expect(waiting).toBeVisible();
  // The seed's pending request from Vikram (a quick chat).
  const row = waiting.getByRole('listitem').filter({ hasText: /Vikram/ });
  await expect(row).toBeVisible();
  await expect(row.getByRole('link', { name: 'Decline…' })).toHaveAttribute('href', '/mentorship');
  // The student set-up checklist is a student's.
  await expect(page.getByRole('heading', { name: 'Set up your CampusLink' })).toHaveCount(0);
  await expectNoA11yViolations(page);
  await row.getByRole('button', { name: 'Accept' }).click();
  await expect(waiting.getByRole('listitem').filter({ hasText: /Vikram/ })).toHaveCount(0);
});
