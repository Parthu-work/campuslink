import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import { signIn } from '../helpers';

/**
 * Navigation journeys J0–J9 (audit §5.1), re-run on the revamped app: a 360 × 780 phone (DPR 2,
 * dark), student Ananya on DPIT, with Lighthouse's mobile throttling (4× CPU, 150 ms, 1.6 Mbps down,
 * 750 kbps up) and once unthrottled. A per-frame probe records, from the tap: when the destination
 * is ready (its selector visible, no skeleton in `main`, no navigation progress bar), frames with a
 * spinner, the progress bar, skeletons or an empty `main`, whether the shell remounted, scroll and
 * focus. Writes `data-after/journeys.json` and `journeys-unthrottled.json`.
 * Run: `pnpm --filter @campuslink/web audit:journeys` (after `audit:capture`, or on a fresh seed).
 */
const OUT = join(process.env.AUDIT_OUT ?? '../../docs/design/revamp', 'data-after');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://dpit.localhost:4173';

interface Frame {
  t: number;
  path: string;
  ready: boolean;
  spinner: boolean;
  progress: boolean;
  skeletons: number;
  textLen: number;
  shell: string;
  scrollY: number;
}
interface Step {
  journey: string;
  step: string;
  actError: string | null;
  ms: number | null;
  firstChange: number | null;
  spinnerFrames: number;
  progressBarFrames: number;
  skeletonFrames: number;
  blankFrames: number;
  totalFrames: number;
  shellRemounted: boolean;
  scrollBefore: number;
  scrollAfter: number;
  focusAfter: string;
  pathAfter: string;
  dialogOpenAfter: number;
  scripts: { file: string; start: number; end: number }[];
  api: { path: string; start: number; end: number }[];
  waterfall: boolean;
}

/** Installed before any page script: records one sample per animation frame while armed. */
function installProbe() {
  type W = typeof window & {
    __probe: { sel: string; path: string; t0: number; on: boolean };
    __frames: Frame[];
  };
  const w = window as W;
  const armed = sessionStorage.getItem('__probeCold');
  w.__probe = armed
    ? { ...(JSON.parse(armed) as { sel: string; path: string }), t0: 0, on: true }
    : { sel: '', path: '', t0: 0, on: false };
  sessionStorage.removeItem('__probeCold');
  w.__frames = [];
  let next = 1;
  const id = (el: Element | null) => {
    if (!el) return 0;
    const e = el as Element & { __pid?: number };
    e.__pid ??= next++;
    return e.__pid;
  };
  const tick = () => {
    const p = w.__probe;
    if (p.on) {
      const main = document.querySelector('main');
      const target = p.sel ? document.querySelector(p.sel) : null;
      const visible = !!target && target.getBoundingClientRect().height > 0;
      const progress = !!document.querySelector('.nav-progress');
      const skeletons = main?.querySelectorAll('[data-skeleton]').length ?? 0;
      w.__frames.push({
        t: performance.now() - p.t0,
        path: location.pathname + location.search,
        ready: visible && !progress && skeletons === 0 && new RegExp(p.path).test(location.pathname),
        spinner: !!document.querySelector('.animate-spin, [data-route-spinner]'),
        progress,
        skeletons,
        textLen: (main?.textContent ?? '').trim().length,
        shell: [
          document.querySelector('header:not(main header)'),
          Array.from(document.querySelectorAll('nav[aria-label="Main"]')).pop() ?? null,
          main,
        ]
          .map(id)
          .join('-'),
        scrollY: Math.round(window.scrollY),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function measure(
  page: Page,
  journey: string,
  step: string,
  target: { sel: string; path: string },
  act: () => Promise<unknown>,
  after?: (page: Page) => Promise<void>,
): Promise<Step> {
  const scrollBefore = await page.evaluate(() => Math.round(window.scrollY));
  await page.evaluate((tg) => {
    const w = window as unknown as { __probe: Record<string, unknown>; __frames: unknown[] };
    w.__frames = [];
    w.__probe = { ...tg, t0: performance.now(), on: true };
  }, target);
  let actError: string | null = null;
  try {
    await act();
    await page.waitForFunction(
      () => (window as unknown as { __frames: Frame[] }).__frames.some((f) => f.ready),
      undefined,
      { timeout: 20_000, polling: 100 },
    );
    await page.waitForTimeout(400);
    await after?.(page);
  } catch (e) {
    actError = (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? 'error';
  }
  return summarise(page, journey, step, scrollBefore, actError);
}

async function summarise(
  page: Page,
  journey: string,
  step: string,
  scrollBefore: number,
  actError: string | null,
  cold = false,
): Promise<Step> {
  const r = await page.evaluate((isCold) => {
    const w = window as unknown as { __probe: { t0: number; on: boolean }; __frames: Frame[] };
    w.__probe.on = false;
    const t0 = isCold ? 0 : w.__probe.t0;
    const res = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((e) => e.startTime >= t0 - 1)
      .map((e) => ({
        name: e.name,
        start: Math.round(e.startTime - t0),
        end: Math.round(e.responseEnd - t0),
      }));
    return {
      frames: w.__frames,
      res,
      focus: document.activeElement?.tagName ?? 'BODY',
      scrollY: Math.round(window.scrollY),
      path: location.pathname + location.search,
      dialogs: document.querySelectorAll('[role=dialog]').length,
    };
  }, cold);
  const frames = r.frames as Frame[];
  const upTo = frames.findIndex((f) => f.ready);
  const window_ = upTo >= 0 ? frames.slice(0, upTo + 1) : frames;
  const first = frames[0];
  const changed = frames.find((f) => first && (f.path !== first.path || f.textLen !== first.textLen));
  const scripts = r.res
    .filter((x) => /\.js(\?|$)/.test(x.name))
    .map((x) => ({ file: x.name.split('/').pop() ?? x.name, start: x.start, end: x.end }));
  const api = r.res
    .filter((x) => x.name.includes('/api/v1/'))
    .map((x) => ({ path: x.name.split('/api/v1')[1] ?? x.name, start: x.start, end: x.end }));
  const screenApi = api.filter((a) => !/unread|\/me$|\/tenant$|refresh/.test(a.path));
  return {
    journey,
    step,
    actError,
    ms: upTo >= 0 ? Math.round(frames[upTo]?.t ?? 0) : null,
    firstChange: changed ? Math.round(changed.t) : null,
    spinnerFrames: window_.filter((f) => f.spinner).length,
    progressBarFrames: window_.filter((f) => f.progress).length,
    skeletonFrames: window_.filter((f) => f.skeletons > 0).length,
    blankFrames: window_.filter((f) => f.textLen < 20).length,
    totalFrames: window_.length,
    shellRemounted: new Set(frames.map((f) => f.shell)).size > 1,
    scrollBefore,
    scrollAfter: r.scrollY,
    focusAfter: r.focus,
    pathAfter: r.path,
    dialogOpenAfter: r.dialogs,
    scripts,
    api,
    waterfall:
      scripts.length > 0 &&
      screenApi.length > 0 &&
      Math.min(...screenApi.map((a) => a.start)) >= Math.max(...scripts.map((s) => s.end)) - 5,
  };
}

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Main' }).last();
const tapTab = async (page: Page, name: string) => {
  const tab = tabs(page).getByRole('link', { name, exact: true });
  await tab.focus();
  await tab.click();
};
const fromMenu = async (page: Page, name: string) => {
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('dialog').getByRole('link', { name, exact: true }).click();
};
const scroll = async (page: Page, y: number) => {
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForTimeout(300);
};
const FEED = { sel: '[role=feed] article', path: '^/home$' };
const JOBS_LINK = 'main a[href^="/jobs/"]:not([href="/jobs/new"]):not([href="/jobs/tracker"])';

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

async function run(browser: Browser, throttled: boolean): Promise<Step[]> {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  await ctx.addInitScript(installProbe);
  const page = await ctx.newPage();
  await signIn(page, 'ananya@dpit.example');
  if (throttled) await throttle(page);
  const out: Step[] = [];
  const m = (...a: Parameters<typeof measure> extends [Page, ...infer R] ? R : never) =>
    measure(page, ...a).then((s) => out.push(s));

  // J0: cold start (a reload of Home).
  await page.evaluate((t) => sessionStorage.setItem('__probeCold', JSON.stringify(t)), FEED);
  await page.reload();
  await page
    .waitForFunction(
      () => (window as unknown as { __frames: Frame[] }).__frames.some((f) => f.ready),
      undefined,
      {
        timeout: 30_000,
      },
    )
    .catch(() => undefined);
  await page.waitForTimeout(400);
  out.push(await summarise(page, '00-cold', 'reload-home', 0, null, true));

  // J1: Home → post → back.
  await scroll(page, 900);
  await m('01-post', 'open-post', { sel: 'main article', path: '^/posts/' }, async () => {
    const links = page.locator('main a[href^="/posts/"]');
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      const box = await links.nth(i).boundingBox();
      if (box && box.y > 60 && box.y < 700) return links.nth(i).click();
    }
    return links.first().click();
  });
  await m('01-post', 'back-home', FEED, () => page.goBack());

  // J2: Mentors → browse → a mentor → back.
  await m('02-mentor', 'tab-mentors', { sel: 'main a[href^="/mentors/"]', path: '^/mentors$' }, () =>
    tapTab(page, 'Mentors'),
  );
  await m('02-mentor', 'browse', { sel: 'main a[href^="/mentors/"]', path: '^/mentors$' }, () =>
    page.getByRole('button', { name: 'Browse', exact: true }).click(),
  );
  await m('02-mentor', 'open-mentor', { sel: 'main h1', path: '^/mentors/[a-f0-9]{24}$' }, () =>
    page.locator('main a[href^="/mentors/"]').first().click(),
  );
  await m('02-mentor', 'back-to-mentors', { sel: 'main a[href^="/mentors/"]', path: '^/mentors$' }, () =>
    page.goBack(),
  );

  // J3: tab switching (first visits, second visits, then four taps in quick succession). Study took
  // Roadmaps' tab (Roadmaps moved to the account menu).
  const TAB_READY: Record<string, { sel: string; path: string }> = {
    Home: FEED,
    Jobs: { sel: JOBS_LINK, path: '^/jobs$' },
    Study: { sel: 'main h1', path: '^/study$' },
    Mentors: { sel: 'main a[href^="/mentors/"]', path: '^/mentors$' },
  };
  for (const round of ['r0', 'r1'])
    for (const name of ['Home', 'Jobs', 'Study', 'Mentors'])
      await m('03-tabs', `${round}-${name.toLowerCase()}`, TAB_READY[name] ?? FEED, () => tapTab(page, name));
  await m('03-tabs', 'rapid-fire', TAB_READY.Mentors ?? FEED, async () => {
    for (const name of ['Home', 'Jobs', 'Study', 'Mentors']) await tapTab(page, name);
  });

  // J4: Jobs (scrolled) → job → back.
  await tapTab(page, 'Jobs');
  await page.locator(JOBS_LINK).first().waitFor();
  await scroll(page, 1400);
  await m('04-jobs', 'open-job', { sel: 'main h1', path: '^/jobs/[a-f0-9]{24}$' }, async () => {
    const links = page.locator(JOBS_LINK);
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      const box = await links.nth(i).boundingBox();
      if (box && box.y > 60 && box.y < 700) return links.nth(i).click();
    }
    return links.first().click();
  });
  await m('04-jobs', 'back-to-list', { sel: JOBS_LINK, path: '^/jobs$' }, () => page.goBack());

  // J5: Roadmaps → a roadmap → a step → Back closes the step (and stays on the roadmap).
  await m('05-roadmaps', 'open-roadmaps', { sel: 'main h1', path: '^/roadmaps$' }, () =>
    fromMenu(page, 'Roadmaps'),
  );
  await m('05-roadmaps', 'open-roadmap', { sel: 'main h1', path: '^/roadmaps/sde-dsa$' }, () =>
    page.goto(`${BASE}/roadmaps/sde-dsa`),
  );
  const list = page.getByRole('button', { name: 'List', exact: true });
  if (await list.isVisible().catch(() => false)) await list.click();
  await m('05-roadmaps', 'open-step', { sel: '[role=dialog]', path: '^/roadmaps/sde-dsa' }, () =>
    page.locator('main ol > li > button').first().click(),
  );
  await m(
    '05-roadmaps',
    'back-gesture-with-panel-open',
    { sel: 'main h1', path: '^/roadmaps/sde-dsa$' },
    () => page.goBack(),
  );

  // J7: profile → save.
  await m('07-profile', 'open-profile', { sel: 'main form', path: '^/profile$' }, () =>
    fromMenu(page, 'Profile'),
  );
  await m('07-profile', 'save', { sel: '[data-sonner-toast], [role=status]', path: '^/profile$' }, () =>
    page.getByRole('button', { name: 'Save changes' }).first().click(),
  );

  // J8: first visits to lazily loaded screens.
  for (const [name, path] of [
    ['Events', '^/events$'],
    ['Progress', '^/progress$'],
    ['People', '^/people$'],
  ] as const)
    await m('08-lazy', `${name.toLowerCase()}-first-visit`, { sel: 'main h1', path }, () =>
      fromMenu(page, name),
    );

  // J9: browser back and forward.
  await m('09-history', 'back-to-progress', { sel: 'main h1', path: '^/progress$' }, () => page.goBack());
  await m('09-history', 'back-to-events', { sel: 'main h1', path: '^/events$' }, () => page.goBack());
  await m('09-history', 'forward-to-progress', { sel: 'main h1', path: '^/progress$' }, () =>
    page.goForward(),
  );
  await ctx.close();

  // J6: a mentor opens a notification and accepts the request it is about.
  const mentor = await browser.newContext({
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  await mentor.addInitScript(installProbe);
  const mp = await mentor.newPage();
  await signIn(mp, 'sneha@dpit.example');
  if (throttled) await throttle(mp);
  const mm = (...a: Parameters<typeof measure> extends [Page, ...infer R] ? R : never) =>
    measure(mp, ...a).then((s) => out.push(s));
  await mm('06-notifications', 'open-notifications', { sel: 'main h1', path: '^/notifications$' }, () =>
    fromMenu(mp, 'Notifications'),
  );
  await mm('06-notifications', 'open-item', { sel: 'main h1', path: '^/mentorship' }, () =>
    mp.locator('main a[href^="/mentorship"]').first().click(),
  );
  await mm('06-notifications', 'accept-request', { sel: '[role=status]', path: '^/mentorship' }, () =>
    mp.getByRole('button', { name: 'Accept', exact: true }).first().click(),
  );
  await mentor.close();
  return out;
}

test.setTimeout(0);

test('journeys, throttled', async ({ browser }) => {
  const steps = await run(browser, true);
  writeFileSync(join(OUT, 'journeys.json'), `${JSON.stringify(steps, null, 1)}\n`);
});

test('journeys, unthrottled', async ({ browser }) => {
  const steps = await run(browser, false);
  writeFileSync(join(OUT, 'journeys-unthrottled.json'), `${JSON.stringify(steps, null, 1)}\n`);
});
