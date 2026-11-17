import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

const BASE = 'http://dpit.localhost:4173';
const HEADLINE = 'Get guidance, referrals and placement help from your college’s seniors.';

/** The page's largest-contentful-paint element and its layout shifts so far. */
const vitals = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ lcp: string | null; cls: number }>((resolve) => {
        let lcp: string | null = null;
        let cls = 0;
        new PerformanceObserver((list) => {
          const last = list.getEntries().at(-1) as (PerformanceEntry & { element?: Element }) | undefined;
          lcp = last?.element ? `${last.element.tagName.toLowerCase()}#${last.element.id}` : 'image';
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          })[])
            if (!e.hadRecentInput) cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => resolve({ lcp, cls }), 500);
      }),
  );

test.describe('landing (prompt 3, U4)', () => {
  test('one headline, one primary action, Sign in as a link, the real product labelled as demo data', async ({
    page,
  }) => {
    await page.goto(`${BASE}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADLINE);
    // The app took over the headline index.html painted: still one headline and one main.
    await expect(page.locator('html')).toHaveAttribute('data-fp-claimed', '');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
    // The college's name once, in the header (the sub-line names it too, in a sentence).
    await expect(page.getByText('Deccan Plateau Institute of Technology', { exact: true })).toHaveCount(1);
    const join = page.getByRole('link', { name: 'Join with your mobile number' });
    await expect(join).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /Home screen of a demo student/ })).toHaveAttribute(
      'src',
      /\/landing\/home-light-en\.webp$/,
    );
    await expect(page.getByText('Demo data', { exact: true })).toBeVisible();
    for (const name of ['Find a senior', 'Prepare and register for drives', 'Follow a career path'])
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    // The college publishes its outcomes page in the seed: its figures, aggregates only.
    await expect(page.getByRole('heading', { level: 2, name: 'DPIT in numbers' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'See the outcomes page' })).toHaveAttribute(
      'href',
      '/p/outcomes',
    );

    await join.click();
    await expect(page).toHaveURL(/\/sign-up$/);
    // Leaving the landing removes the first paint.
    await expect(page.locator('#fp')).toHaveCount(0);
  });

  test('the headline is the largest paint on a phone, and nothing shifts', async ({ page }, testInfo) => {
    await page.goto(`${BASE}/`);
    await expect(page.getByRole('link', { name: 'Join with your mobile number' })).toBeVisible();
    await page.waitForTimeout(1500);
    const v = await vitals(page);
    expect(v.cls).toBeLessThan(0.05);
    // On a wide screen the product picture beside the headline is larger (recorded in progress-3.md).
    if (testInfo.project.name === 'mobile') expect(v.lcp).toBe('h1#landing-h1');
  });

  test('another language gets the app’s own landing; a member’s device skips the first paint', async ({
    page,
  }) => {
    await page.goto(`${BASE}/`);
    await page.getByRole('button', { name: 'తెలుగు' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'మీ కళాశాల సీనియర్ల నుండి మార్గదర్శనం, రిఫరల్స్, ప్లేస్‌మెంట్ సహాయం పొందండి.',
    );
    await expect(page.locator('#fp')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'మీ మొబైల్ నంబర్‌తో చేరండి' })).toBeVisible();

    // A device that was signed in last time: "/" draws nothing before the app knows who it is.
    await page.evaluate(() => {
      localStorage.removeItem('cl:lang');
      localStorage.setItem('cl:member', '1');
    });
    await page.goto(`${BASE}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADLINE);
    await expect(page.locator('#fp')).toHaveCount(0);
    expect(await page.evaluate(() => 'fp' in document.documentElement.dataset)).toBe(false);
  });

  test('signing in marks the device; "/" then opens the member’s app without the landing', async ({
    page,
  }) => {
    await signIn(page, 'ananya@dpit.example');
    expect(await page.evaluate(() => localStorage.getItem('cl:member'))).toBe('1');
    await page.goto(`${BASE}/`);
    await expect(page).toHaveURL(/\/(home|start)$/);
    await expect(page.locator('#fp')).toHaveCount(0);
  });
});
