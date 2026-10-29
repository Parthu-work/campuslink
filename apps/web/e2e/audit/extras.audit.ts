import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { signIn } from '../helpers';

/**
 * The audit's smaller probes, re-run (`data/desktop-rail.json`, `offline.json`, `telugu.json`,
 * `scroll-memory.json`): every rail item reachable on short desktop screens, an unvisited screen
 * offline, Telugu fonts and label overflow, and per-tab scroll memory with the scroll-aware bars.
 * Writes the same files to `data-after/`. Run: `pnpm --filter @campuslink/web audit:extras`.
 */
const OUT = join(process.env.AUDIT_OUT ?? '../../docs/design/revamp', 'data-after');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://dpit.localhost:4173';
const save = (file: string, data: unknown) =>
  writeFileSync(join(OUT, file), `${JSON.stringify(data, null, 1)}\n`);
const PHONE = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

test.setTimeout(0);

test('desktop rail', async ({ browser }) => {
  const out: Record<string, unknown> = {};
  for (const [w, h] of [
    [1440, 900],
    [1280, 720],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await signIn(page, 'ananya@dpit.example');
    await page.locator('.app-rail').waitFor();
    out[`${w}x${h}`] = await page.evaluate((vh) => {
      const rail = document.querySelector('.app-rail');
      if (!rail) return { error: 'no rail' };
      const style = getComputedStyle(rail);
      const scrolls = (el: Element) => /auto|scroll/.test(getComputedStyle(el).overflowY);
      const scroller = [rail, ...Array.from(rail.querySelectorAll('*'))].find(
        (e) => scrolls(e) && e.scrollHeight > e.clientHeight,
      );
      const items = Array.from(rail.querySelectorAll('a, button')).filter(
        (e) => e.getBoundingClientRect().height > 0,
      );
      return {
        railHeight: Math.round(rail.getBoundingClientRect().height),
        railScrollHeight: rail.scrollHeight,
        overflowY: style.overflowY,
        innerScroller: !!scroller,
        viewport: vh,
        items: items.length,
        // Below the fold and not inside anything that scrolls: impossible to reach.
        unreachable: items
          .filter((e) => e.getBoundingClientRect().bottom > vh && !scroller?.contains(e))
          .map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30)),
      };
    }, h);
    await ctx.close();
  }
  save('desktop-rail.json', out);
});

test('offline: an unvisited screen', async ({ browser }) => {
  // Open Events from the account menu with the network gone: the menu is opened first (online), so
  // what is measured is the screen's own code, not the menu's.
  const probe = async (page: Page, setOffline: (o: boolean) => Promise<void>) => {
    await page.getByRole('button', { name: /Account menu/ }).click();
    const events = page.getByRole('dialog').getByRole('link', { name: 'Events', exact: true });
    await events.waitFor();
    await setOffline(true);
    await events.click();
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => ({
      url: location.pathname,
      h1: document.querySelector('h1')?.textContent ?? null,
      text: (document.querySelector('main')?.textContent ?? document.body.textContent ?? '')
        .trim()
        .slice(0, 300),
      shell: !!document.querySelector('nav[aria-label="Main"]'),
    }));
    await setOffline(false);
    return r;
  };
  // With the service worker: it precaches every screen's code after install.
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await signIn(page, 'ananya@dpit.example');
  await page.waitForTimeout(3000);
  await page.reload();
  await page.waitForLoadState('networkidle');
  const swControlled = await page.evaluate(() => !!navigator.serviceWorker?.controller);
  const allow = await probe(page, (o) => ctx.setOffline(o));
  await ctx.close();
  // Without it (first visit, or a browser without service workers): the chunk cannot load.
  const bare = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
  const p2 = await bare.newPage();
  await signIn(p2, 'ananya@dpit.example');
  await p2.waitForTimeout(2000);
  const block = await probe(p2, (o) => bare.setOffline(o));
  await bare.close();
  save('offline.json', { swControlled, 'events-allow': allow, 'events-block': block });
});

test('Telugu', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await signIn(page, 'ananya@dpit.example');
  await page.evaluate(() => localStorage.setItem('cl:lang', 'te'));
  const out: Record<string, unknown> = {};
  for (const path of ['/home', '/study', '/mentors', '/jobs', '/roadmaps', '/settings/preferences']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    out[path] = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const h1 = document.querySelector('h1');
      const h = h1 ? getComputedStyle(h1) : null;
      const labels = Array.from(
        Array.from(document.querySelectorAll('nav[aria-label="Main"]'))
          .pop()
          ?.querySelectorAll('a, button') ?? [],
      ).map((a) => {
        const span = a.querySelector('span:last-child') ?? a;
        return {
          text: (a.textContent ?? '').trim(),
          overflow: span.scrollWidth > span.clientWidth + 1,
          w: Math.round(span.getBoundingClientRect().width),
        };
      });
      return {
        lang: document.documentElement.lang,
        bodyFont: body.fontFamily,
        lineHeight: body.lineHeight,
        h1: h1 && h ? { text: h1.textContent, font: h.fontFamily, size: h.fontSize, lh: h.lineHeight } : null,
        bottomNavLabels: labels,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        fontsLoaded: [
          ...new Set(
            Array.from(document.fonts)
              .filter((f) => f.status === 'loaded')
              .map((f) => f.family),
          ),
        ],
      };
    });
  }
  save('telugu.json', out);
  await ctx.close();
});

test('scroll memory and scroll-aware bars', async ({ browser }) => {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await signIn(page, 'ananya@dpit.example');
  const tabs = page.getByRole('navigation', { name: 'Main' }).last();
  const tap = async (name: string) => {
    const t = tabs.getByRole('link', { name, exact: true });
    await t.focus();
    await t.click();
    await page.waitForTimeout(800);
  };
  const y = () => page.evaluate(() => Math.round(window.scrollY));
  const bars = (p: Page) =>
    p.evaluate(() => {
      const header = document.querySelector('header:not(main header)')?.getBoundingClientRect();
      const nav = Array.from(document.querySelectorAll('nav[aria-label="Main"]'))
        .pop()
        ?.getBoundingClientRect();
      return {
        headerTop: Math.round(header?.top ?? 0),
        headerHeight: Math.round(header?.height ?? 0),
        navTop: Math.round(nav?.top ?? 0),
        navHeight: Math.round(nav?.height ?? 0),
        vh: window.innerHeight,
        chrome: document.documentElement.dataset.chrome ?? null,
      };
    });
  await page.getByRole('feed').getByRole('article').first().waitFor();
  const barsAtTop = await bars(page);
  await page.mouse.move(180, 400);
  // Not to the end of the (short, seeded) feed: there the bars come back by design.
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(600);
  const homeBefore = await y();
  const barsAfterScrollDown = await bars(page);
  await page.mouse.wheel(0, -150);
  await page.waitForTimeout(600);
  const barsAfterScrollUp = await bars(page);
  await tap('Jobs');
  const jobsOnArrival = await y();
  const job = page
    .locator('main a[href^="/jobs/"]:not([href="/jobs/new"]):not([href="/jobs/tracker"])')
    .first();
  await job.click();
  await page.waitForURL(/\/jobs\/[a-f0-9]{24}$/);
  const jobUrl = new URL(page.url()).pathname;
  await tap('Home');
  const homeAfterTabRoundTrip = await y();
  await tap('Home');
  const afterTappingActiveTab = await y();
  await tap('Jobs');
  const jobsTabUrl = new URL(page.url()).pathname;
  await page.goto(`${BASE}/home`);
  await page.getByRole('feed').getByRole('article').first().waitFor();
  const overflowRows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('main *'))
      .filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1)
      .map((e) => ({
        tag: e.tagName,
        cls: String((e as HTMLElement).className).slice(0, 80),
        scrollWidth: e.scrollWidth,
        clientWidth: e.clientWidth,
        maskOrFade:
          getComputedStyle(e).maskImage !== 'none' || getComputedStyle(e).webkitMaskImage !== 'none',
      })),
  );
  save('scroll-memory.json', {
    homeBefore,
    jobsOnArrival,
    homeAfterTabRoundTrip,
    afterTappingActiveTab,
    jobsTabRemembersDetail: jobsTabUrl === jobUrl,
    jobsTabUrl,
    barsAtTop,
    barsAfterScrollDown,
    barsAfterScrollUp,
    overflowRows,
  });
  await ctx.close();
});
