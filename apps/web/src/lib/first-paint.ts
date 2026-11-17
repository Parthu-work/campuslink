/**
 * The landing's first paint (prompt 3, U4). index.html carries the landing's frame and its English
 * headline (`#fp`), and `public/boot.js` turns it on before any script runs where the landing is
 * what will show. The landing then claims that frame and renders into its slots, so the headline
 * the browser painted first is the one that stays (a second headline would be a later, possibly
 * larger paint, and LCP would move to it). Anything else the app shows first releases it.
 */
export const FIRST_PAINT_SLOTS = ['backdrop', 'header', 'copy', 'figure', 'below', 'footer'] as const;
export type FirstPaintSlot = (typeof FIRST_PAINT_SLOTS)[number];
export type FirstPaint = Record<FirstPaintSlot, HTMLElement>;

const html = () => document.documentElement;
/** undefined: not decided yet; null: released (or never shown). */
let claimed: FirstPaint | null | undefined;
let holds = 0;

const frame = () => (typeof document === 'undefined' ? null : document.getElementById('fp'));
const shown = () => 'fp' in html().dataset;

/** Removes the first paint for good (the app renders the landing, or another screen, itself). */
export function releaseFirstPaint() {
  claimed = null;
  if (typeof document === 'undefined') return;
  frame()?.remove();
  delete html().dataset.fp;
  delete html().dataset.fpClaimed;
}

/**
 * The landing takes the frame over (idempotent: StrictMode renders twice). Only in English, the
 * one language index.html carries; null means "render the landing normally".
 */
export function claimFirstPaint(language: string): FirstPaint | null {
  if (claimed !== undefined) return claimed;
  const el = frame();
  if (!el || !shown() || language !== 'en') {
    releaseFirstPaint();
    return null;
  }
  const slots = {} as FirstPaint;
  for (const s of FIRST_PAINT_SLOTS) {
    const node = el.querySelector<HTMLElement>(`[data-slot="${s}"]`);
    if (!node) {
      releaseFirstPaint();
      return null;
    }
    slots[s] = node;
  }
  html().dataset.fpClaimed = '';
  claimed = slots;
  return slots;
}

/**
 * The landing holds the frame while it is mounted; the last release removes it. The removal waits
 * a microtask so StrictMode's unmount-and-mount in development does not drop it.
 */
export function holdFirstPaint() {
  holds++;
  return () => {
    holds--;
    queueMicrotask(() => {
      if (holds === 0 && claimed) releaseFirstPaint();
    });
  };
}

/**
 * Called once at start (main.tsx): while the app starts, `#root` holds only the launch mark and the
 * first paint shows instead (index.css). As soon as the app renders anything else there without
 * the landing having claimed the frame (a redirect home, a college error), the frame goes.
 */
export function watchFirstPaint() {
  const el = frame();
  if (!el) return;
  if (!shown()) {
    el.remove();
    return;
  }
  const root = document.getElementById('root');
  if (!root) return;
  const observer = new MutationObserver(() => {
    if (claimed !== undefined) observer.disconnect();
    else if (!root.querySelector('.launch')) {
      observer.disconnect();
      releaseFirstPaint();
    }
  });
  observer.observe(root, { childList: true, subtree: true });
}
