import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * The human check for protected writes (lib/bot-check.ts), under the production CSP.
 *
 * Cloudflare is not reachable from the test environment, and the API runs with bot protection off,
 * so the test stands in for both ends: the college config carries a Turnstile site key, the
 * Turnstile script is a local fake that issues a token, and the API's first answer to the write is
 * BOT_CHECK_FAILED. The app must run the check and retry once with `X-Bot-Token`.
 */
const SITE_KEY = '1x00000000000000000000AA'; // Cloudflare's documented always-pass test key
const FAKE_TURNSTILE = `
  window.turnstile = {
    render(el, opts) {
      if (opts.sitekey !== ${JSON.stringify(SITE_KEY)}) throw new Error('wrong site key');
      el.setAttribute('data-fake-turnstile', '');
      setTimeout(() => opts.callback('e2e-bot-token'), 50);
      return 'w1';
    },
    remove() {},
  };
`;

test('a challenged write runs the human check and retries once with its token', async ({ page }, info) => {
  test.setTimeout(90_000);
  const host = info.project.name === 'mobile' ? 'mrce' : 'dpit';
  const text = `E2E bot check ${info.project.name}: one useful tip`;

  await page.route('**/api/v1/tenant', async (route) => {
    // Node cannot resolve *.localhost; fetch through 127.0.0.1 with the college's Host header.
    const res = await route.fetch({
      url: 'http://127.0.0.1:4173/api/v1/tenant',
      headers: { ...route.request().headers(), host: `${host}.localhost:4173` },
    });
    const body = (await res.json()) as { data: Record<string, unknown> };
    body.data.botCheck = { provider: 'turnstile', siteKey: SITE_KEY };
    await route.fulfill({ response: res, json: body });
  });
  let scriptLoads = 0;
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', async (route) => {
    scriptLoads++;
    await route.fulfill({ contentType: 'text/javascript', body: FAKE_TURNSTILE });
  });
  const tokens: (string | null)[] = [];
  await page.route('**/api/v1/posts', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const token = route.request().headers()['x-bot-token'] ?? null;
    tokens.push(token);
    if (!token)
      return route.fulfill({
        status: 403,
        json: {
          ok: false,
          error: { code: 'BOT_CHECK_FAILED', message: 'Please complete the human check and try again' },
        },
      });
    return route.continue();
  });
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });

  await signIn(page, `sneha@${host}.example`, host);
  // Nothing is loaded before a write is challenged.
  expect(scriptLoads).toBe(0);
  await page.getByRole('button', { name: 'Share something useful with your college…' }).click();
  await page.getByLabel('Text').fill(text);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Posted')).toBeVisible();
  await expect(page.getByRole('feed').getByText(text)).toBeVisible();

  expect(tokens).toEqual([null, 'e2e-bot-token']);
  expect(scriptLoads).toBe(1);
  // The widget container is hidden again once the check is done.
  await expect(page.locator('#bot-check-host')).toBeHidden();
  expect(violations).toEqual([]);
});
