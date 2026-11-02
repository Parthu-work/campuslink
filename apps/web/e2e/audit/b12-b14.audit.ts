import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { signIn } from '../helpers';
import { adminSignIn } from '../admin';
import { axe, measure, settle } from './probes';

/**
 * Prompt 1b, R3: the checks prompt 1's definition of done asks for, on the B12 to B14 screens. At
 * 360 px (touch) and 1440 px, in light and dark, with reduced motion: axe (WCAG 2.2 AA), targets
 * under 44 px that WCAG does not exempt, sideways scrolling, and whether the keyboard alone (Tab)
 * reaches every control. Results: `data-after/b12-b14.json`, summarised in docs/accessibility.md.
 * Run against a freshly seeded database: `pnpm --filter @campuslink/web exec playwright test -c
 * e2e/audit/playwright.config.ts b12-b14`.
 */
const OUT = join(process.env.AUDIT_OUT ?? '../../docs/design/revamp', 'data-after');
mkdirSync(OUT, { recursive: true });

const DEVICES = {
  360: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;
type Width = keyof typeof DEVICES;
const THEMES = ['light', 'dark'] as const;
const BASE = 'http://dpit.localhost:4173';

interface Row {
  screen: string;
  width: Width;
  theme: (typeof THEMES)[number];
  axe: { id: string; impact: string | null; nodes: string[] }[];
  under44: { label: string; w: number; h: number }[];
  sideways: boolean;
  unreachable: string[];
}
const rows: Row[] = [];

/** Controls Tab never reaches (visible, enabled, not inside an inert or hidden part). */
async function keyboardGaps(page: Page): Promise<string[]> {
  const total = await page.evaluate(() => {
    const sel =
      'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
    const list = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility !== 'hidden' &&
        !e.closest('[inert], [aria-hidden="true"]') &&
        e.tabIndex >= 0
      );
    });
    // Radio groups take one Tab stop; arrows move inside them.
    const seen = new Set<string>();
    let n = 0;
    for (const e of list) {
      const group = e.getAttribute('role') === 'radio' ? e.closest('[role=radiogroup]') : null;
      const key = group
        ? `g${Array.from(document.querySelectorAll('[role=radiogroup]')).indexOf(group)}`
        : '';
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      e.dataset.kb = String(n++);
    }
    return n;
  });
  await page.locator('body').focus();
  const reached = new Set<string>();
  for (let i = 0; i < total * 2 + 10 && reached.size < total; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      const own = a?.dataset.kb;
      if (own) return own;
      // A focused radio stands for its group.
      const g = a?.closest('[role=radiogroup]');
      return g?.querySelector<HTMLElement>('[data-kb]')?.dataset.kb ?? null;
    });
    if (id) reached.add(id);
  }
  return page.evaluate(
    (got) => {
      const out: string[] = [];
      for (const e of Array.from(document.querySelectorAll<HTMLElement>('[data-kb]')))
        if (!got.includes(e.dataset.kb ?? ''))
          out.push(
            (e.getAttribute('aria-label') ?? e.textContent ?? e.tagName)
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 50),
          );
      return out.slice(0, 10);
    },
    [...reached],
  );
}

async function check(page: Page, screen: string, width: Width, theme: Row['theme']) {
  await settle(page);
  const a = await axe(page, screen);
  const m = await measure(page);
  const unreachable = await keyboardGaps(page);
  rows.push({
    screen,
    width,
    theme,
    axe: a.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5) })),
    under44: width === 360 ? m.under44Examples.filter((x) => !x.exempt) : [],
    sideways: m.docScrollWidth > m.viewportWidth + 1,
    unreachable,
  });
}

async function context(browser: Browser, width: Width, theme: Row['theme']) {
  return browser.newContext({
    ...DEVICES[width],
    colorScheme: theme,
    reducedMotion: 'reduce',
    baseURL: BASE,
  });
}

test('B12 to B14 screens: axe, 44 px targets, no sideways scroll, keyboard only (prompt 1b, R3)', async ({
  browser,
}) => {
  test.setTimeout(30 * 60_000);
  for (const width of [360, 1440] as const)
    for (const theme of THEMES) {
      // A student: language, preferences, offline, help, reports, legal pages and the grievance card.
      const s = await context(browser, width, theme);
      const page = await s.newPage();
      await signIn(page, 'ananya@dpit.example', 'dpit');
      for (const [name, path] of [
        ['settings-preferences', '/settings/preferences'],
        ['help', '/help'],
        ['settings-privacy-grievance', '/settings/privacy'],
        ['legal-privacy', '/legal/privacy'],
        ['legal-terms', '/legal/terms'],
      ] as const) {
        await page.goto(path);
        await check(page, name, width, theme);
      }
      await page.goto('/help');
      await page.getByRole('link', { name: /Getting started/ }).click();
      await check(page, 'help-guide', width, theme);
      await page.goto('/help');
      await page.getByRole('button', { name: 'Report a problem' }).click();
      await expect(page.getByRole('dialog', { name: 'Report a problem' })).toBeVisible();
      await check(page, 'report-a-problem', width, theme);
      await page.keyboard.press('Escape');
      const thread = page.locator('a[href^="/help/reports/"]').first();
      if (await thread.count()) {
        await thread.click();
        await check(page, 'report-thread', width, theme);
      }
      // Offline: the pill on a page already open.
      await page.goto('/home');
      await settle(page);
      await s.setOffline(true);
      await expect(page.getByText(/offline/i).first()).toBeVisible({ timeout: 15_000 });
      await check(page, 'offline-pill', width, theme);
      await s.setOffline(false);
      // Hindi: switch the language from Preferences, check a Hindi screen, switch back.
      await page.goto('/settings/preferences');
      await page.getByRole('radio', { name: /हिन्दी|हिंदी/ }).click();
      await page.goto('/home');
      await check(page, 'home-hindi', width, theme);
      await page.goto('/settings/preferences');
      await check(page, 'settings-preferences-hindi', width, theme);
      await page.getByRole('radio', { name: 'English' }).click();
      await s.close();

      // The college's admin: Admin › Support and Admin › Branding › Legal details.
      const a = await context(browser, width, theme);
      const admin = await a.newPage();
      await adminSignIn(admin, 'dpit', 'admin@dpit.example');
      for (const [name, path] of [
        ['admin-support', '/admin/support'],
        ['admin-branding-legal', '/admin/branding'],
      ] as const) {
        await admin.goto(path);
        await check(admin, name, width, theme);
      }
      await a.close();

      // The platform's desk.
      const p = await browser.newContext({ ...DEVICES[width], colorScheme: theme, reducedMotion: 'reduce' });
      const platform = await p.newPage();
      await adminSignIn(platform, 'admin', 'superadmin@campuslink.example');
      await platform.goto('http://admin.localhost:4173/platform/support');
      await check(platform, 'platform-support', width, theme);
      await p.close();
    }

  // The notice gate: the college publishes its details again, and a member meets the gate.
  const a = await browser.newContext({ ...DEVICES[1440], baseURL: BASE });
  const admin = await a.newPage();
  await adminSignIn(admin, 'dpit', 'admin@dpit.example');
  await admin.goto('/admin/branding');
  await admin.getByRole('button', { name: 'Publish', exact: true }).first().click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(admin.getByText('Published.', { exact: false })).toBeVisible();
  await a.close();
  for (const width of [360, 1440] as const)
    for (const theme of THEMES) {
      const g = await context(browser, width, theme);
      const page = await g.newPage();
      await signIn(page, 'vikram@dpit.example', 'dpit').catch(() => undefined);
      await page.goto('/home');
      await expect(page.getByRole('heading', { name: /updated its privacy policy/ })).toBeVisible();
      await check(page, 'notice-gate', width, theme);
      await g.close();
    }

  writeFileSync(join(OUT, 'b12-b14.json'), `${JSON.stringify(rows, null, 1)}\n`);
  const failing = rows.filter((r) => r.axe.length || r.under44.length || r.sideways || r.unreachable.length);
  console.warn(`b12-b14: ${rows.length} checks, ${failing.length} with findings`);
  for (const r of failing)
    console.warn(
      `${r.screen} ${r.width} ${r.theme}: axe=${r.axe.map((v) => v.id).join(',') || '-'} under44=${r.under44.length} sideways=${r.sideways} unreachable=${r.unreachable.join(' | ') || '-'}`,
    );
});
