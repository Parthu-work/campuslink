import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import { signIn } from '../helpers';
import { adminSignIn } from '../admin';
import { axe, measure, settle, type AxeResult } from './probes';
import { ACCOUNT, SCREENS, TELUGU, type AuditRole, type AuditScreen } from './screens';

/**
 * Re-audit capture (master prompt §12): every screen at 360 × 780 (DPR 2, touch) and 1440 × 900, in
 * light and dark, on both demo colleges and the platform console. Writes `after/<role>-<screen>-
 * <width>-<theme>-<college>.png` (the audit's names), axe results for every 360 px screen, the
 * 360 px target, type and overflow measurements, and any capture failures to `data-after/`.
 * Run against a freshly seeded database: `pnpm --filter @campuslink/web audit:capture`.
 */
const OUT = process.env.AUDIT_OUT ?? '../../docs/design/revamp';
const SHOTS = join(OUT, 'after');
const DATA = join(OUT, 'data-after');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(DATA, { recursive: true });

const DEVICES = {
  360: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;
type Width = keyof typeof DEVICES;
const THEMES = ['light', 'dark'] as const;
const COLLEGES = ['dpit', 'mrce'] as const;

/** Results are merged into the files (replacing this run's own rows), so one role can be re-run alone. */
function merge<T>(file: string, rows: T[], owns: (x: T) => boolean) {
  const path = join(DATA, file);
  let old: T[] = [];
  try {
    old = JSON.parse(readFileSync(path, 'utf8')) as T[];
  } catch {
    /* first run */
  }
  writeFileSync(path, `${JSON.stringify([...old.filter((x) => !owns(x)), ...rows], null, 1)}\n`);
}
const mergeMap = (file: string, rows: Record<string, unknown>) => {
  const path = join(DATA, file);
  let old: Record<string, unknown> = {};
  try {
    old = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    /* first run */
  }
  writeFileSync(path, `${JSON.stringify({ ...old, ...rows }, null, 1)}\n`);
};

async function context(browser: Browser, width: Width, host: string, role: AuditRole) {
  const ctx = await browser.newContext({ ...DEVICES[width], baseURL: `http://${host}.localhost:4173` });
  const page = await ctx.newPage();
  if (role === 'platform') await adminSignIn(page, 'admin', 'superadmin@campuslink.example');
  else if (role === 'admin') await adminSignIn(page, host, `admin@${host}.example`);
  else if (role !== 'public') await signIn(page, `${ACCOUNT[role]}@${host}.example`, host);
  return { ctx, page };
}

/** Resolves a screen to a URL (following the first matching link on its list page). */
async function resolve(page: Page, s: AuditScreen, cache: Map<string, string>): Promise<string> {
  if (s.path) return s.path;
  const f = s.follow;
  if (!f) throw new Error(`${s.slug}: no path`);
  const key = JSON.stringify(f);
  const hit = cache.get(key);
  if (hit) return hit;
  const pick = async (from: string, sel: string, text?: RegExp) => {
    await page.goto(from);
    let link = page.locator(sel);
    if (text) link = link.filter({ hasText: text });
    await link.first().waitFor({ timeout: 15_000 });
    const href = await link.first().getAttribute('href');
    if (!href) throw new Error(`${s.slug}: no link on ${from}`);
    return href;
  };
  let url = await pick(f.from, f.link, f.text);
  if (f.then) url = await pick(url, f.then);
  cache.set(key, url);
  return url;
}

async function captureRole(browser: Browser, role: AuditRole, host: string, label = host) {
  const name = (slug: string, w: Width, theme: string) => `${role}-${slug}-${w}-${theme}-${label}`;
  const owns = (x: { screen: string }) => x.screen.startsWith(`${role}-`) && x.screen.endsWith(`-${label}`);
  const axeRows: AxeResult[] = [];
  const failures: { screen: string; error: string }[] = [];
  const metrics: Record<string, unknown> = {};
  const urls = new Map<string, string>();
  for (const width of [360, 1440] as const) {
    const { ctx, page } = await context(browser, width, host, role);
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      for (const s of SCREENS[role]) {
        if (s.mobileOnly && width !== 360) continue;
        const shot = name(s.slug, width, theme);
        try {
          const url = await resolve(page, s, urls);
          await page.goto(url);
          await settle(page);
          if (s.ready) {
            await page.locator(s.ready).first().waitFor({ timeout: 15_000 });
            await settle(page);
          }
          if (s.open) {
            await s.open(page);
            await settle(page);
          }
          await page.screenshot({ path: join(SHOTS, `${shot}.png`) });
          if (width === 360) {
            axeRows.push(await axe(page, shot));
            if (theme === 'light' && host === 'dpit')
              metrics[role === 'student' ? url : `${role}:${url}`] = await measure(page);
          }
          if (s.open) await page.keyboard.press('Escape');
        } catch (e) {
          failures.push({
            screen: shot,
            error: (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? '',
          });
        }
      }
    }
    await ctx.close();
  }
  merge('axe.json', axeRows, owns);
  merge('capture-failures.json', failures, owns);
  if (Object.keys(metrics).length) mergeMap('touch-targets-360.json', metrics);
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(0);

for (const host of COLLEGES)
  for (const role of Object.keys(SCREENS) as AuditRole[]) {
    if (role === 'platform') continue;
    test(`${host} · ${role}`, async ({ browser }) => {
      await captureRole(browser, role, host);
    });
  }

test('platform console', async ({ browser }) => {
  await captureRole(browser, 'platform', 'admin', 'platform');
});

test('Telugu (360, light, DPIT)', async ({ browser }) => {
  const { ctx, page } = await context(browser, 360, 'dpit', 'student');
  await page.evaluate(() => localStorage.setItem('cl:lang', 'te'));
  for (const s of TELUGU) {
    await page.goto(s.path);
    await settle(page);
    await page.screenshot({ path: join(SHOTS, `student-${s.slug}-te-360-light-dpit.png`) });
  }
  await ctx.close();
});

test('summary', () => {
  const rows = JSON.parse(readFileSync(join(DATA, 'axe.json'), 'utf8')) as AxeResult[];
  const rules = new Map<string, { id: string; impact: string | null; help: string; screens: string[] }>();
  for (const r of rows)
    for (const v of r.violations) {
      const rule = rules.get(v.id) ?? { id: v.id, impact: v.impact, help: v.help, screens: [] };
      rule.screens.push(r.screen);
      rules.set(v.id, rule);
    }
  writeFileSync(
    join(DATA, 'axe-summary.json'),
    `${JSON.stringify(
      {
        scans: rows.length,
        scansWithoutViolations: rows.filter((r) => !r.violations.length).length,
        rules: [...rules.values()],
      },
      null,
      1,
    )}\n`,
  );
});
