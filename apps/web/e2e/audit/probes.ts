import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** Waits until data has loaded and entrance animations have finished (ambient loops are ignored). */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(250);
}

export interface AxeResult {
  screen: string;
  url: string;
  violations: { id: string; impact: string | null; help: string; nodes: string[] }[];
}

export async function axe(page: Page, screen: string): Promise<AxeResult> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return {
    screen,
    url: page.url(),
    violations: r.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? null,
      help: v.help,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    })),
  };
}

/**
 * The audit's 360 px measurements (`data/touch-targets-360.json`): interactive targets under 44 and
 * 24 px, horizontal overflow, the font-size histogram and images without dimensions. Same rules as
 * the audit (a target is "under" when its smaller side is), plus `exempt`: targets WCAG 2.5.8 exempts
 * (links inside running text, skip links that are visually hidden until focused, and chart columns,
 * whose values the chart's table view offers as an equivalent control). A checkbox or radio inside
 * its `<label>` is measured by the label, which is what a finger hits.
 */
export function measure(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const sel =
      'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=option], [tabindex]:not([tabindex="-1"])';
    const visible = (e: Element) => {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const label = (e: Element) =>
      (e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const inlineText = (e: Element) =>
      e.tagName === 'A' &&
      getComputedStyle(e).display === 'inline' &&
      !!e.parentElement &&
      (e.parentElement.textContent ?? '').trim().length > (e.textContent ?? '').trim().length + 10;
    const targets = Array.from(document.querySelectorAll(sel)).filter(visible);
    const box = (e: Element) => {
      const l = e instanceof HTMLInputElement ? e.closest('label') : null;
      return (l ?? e).getBoundingClientRect();
    };
    const under = (n: number) =>
      targets.filter((e) => {
        const r = box(e);
        return Math.min(r.width, r.height) < n;
      });
    const exempt = (e: Element) => {
      const r = e.getBoundingClientRect();
      const chartColumn = e.matches('figure [role=img]') && !!e.closest('figure')?.querySelector('details');
      return inlineText(e) || chartColumn || (r.width <= 1 && r.height <= 1);
    };
    const ex = (list: Element[]) =>
      list.slice(0, 8).map((e) => {
        const r = box(e);
        return { label: label(e), w: Math.round(r.width), h: Math.round(r.height), exempt: exempt(e) };
      });
    const u44 = under(44);
    const u24 = under(24);
    // Overflow: elements past the right edge that no scrolling or clipping ancestor contains.
    const clipped = (e: Element) => {
      // The page itself (body clips sideways) does not count: overflow there is cut off, not scrolled.
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
      }
      return false;
    };
    const overflow = Array.from(document.querySelectorAll('body *'))
      .filter((e) => visible(e) && e.getBoundingClientRect().right > vw + 1 && !clipped(e))
      .slice(0, 10)
      .map((e) => ({
        tag: e.tagName,
        cls: String((e as HTMLElement).className).slice(0, 80),
        right: Math.round(e.getBoundingClientRect().right),
        text: label(e),
      }));
    const fontSizes: Record<string, number> = {};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !(n.textContent ?? '').trim() || !visible(el)) continue;
      const size = getComputedStyle(el).fontSize;
      fontSizes[size] = (fontSizes[size] ?? 0) + 1;
    }
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: vw,
      overflow,
      targets: targets.length,
      under44: u44.length,
      under24: u24.length,
      under44NotExempt: u44.filter((e) => !exempt(e)).length,
      under24NotExempt: u24.filter((e) => !exempt(e)).length,
      under44Examples: ex(u44.filter((e) => !exempt(e))),
      under24Examples: ex(u24.filter((e) => !exempt(e))),
      fontSizes,
      imagesWithoutDimensions: Array.from(document.images).filter(
        (i) => !i.getAttribute('width') && !i.getAttribute('height') && !i.style.width,
      ).length,
    };
  });
}
