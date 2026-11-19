import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';
import { truncations } from './audit/probes';

/**
 * Prompt 3, U11: motion and size. Under reduced motion nothing animates on a student's main
 * screens; with text at 200% (the reader's own text size) and at 200% page zoom (a 1280 px window
 * seen at 640 CSS px), the page never scrolls sideways and nothing that carries meaning is cut.
 */
const SCREENS = ['/home', '/placements', '/mentors', '/roadmaps', '/jobs', '/study', '/settings/preferences'];

const settled = async (page: Page) => {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
};

/** Animations still running with a real duration (an ambient loop scaled to 0 does not count). */
const moving = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => ({
        name: 'animationName' in a ? String(a.animationName) : 'transition',
        duration: Number(a.effect?.getComputedTiming().duration ?? 0),
      }))
      .filter((a) => a.duration > 1),
  );

/** How far the page is wider than its window (0 when it reflows). */
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('reduced motion: nothing on the main screens animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, 'ananya@dpit.example');
  for (const path of SCREENS) {
    await page.goto(path);
    await settled(page);
    expect(await moving(page), path).toEqual([]);
  }
});

test('text at 200% and page zoom at 200%: no sideways scroll, nothing cut', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Sizes a window; the desktop project covers it');
  test.setTimeout(120_000);
  await signIn(page, 'ananya@dpit.example');
  // The reader's text size at 200% (type is in rem, so it follows), in a 1280 px window.
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const path of SCREENS) {
    await page.goto(path);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await settled(page);
    expect(await sideways(page), `${path} at 200% text`).toBeLessThanOrEqual(1);
    expect(await truncations(page, `${path} at 200% text`)).toEqual([]);
  }
  // Page zoom at 200%: the same window is 640 CSS px wide.
  await page.setViewportSize({ width: 640, height: 400 });
  for (const path of SCREENS) {
    await page.goto(path);
    await settled(page);
    expect(await sideways(page), `${path} at 200% zoom`).toBeLessThanOrEqual(1);
    expect(await truncations(page, `${path} at 200% zoom`)).toEqual([]);
  }
});
