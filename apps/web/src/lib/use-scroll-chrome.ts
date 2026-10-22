import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Scroll-aware phone chrome (audit NB-1, master prompt §7a). One passive scroll listener, throttled
 * to animation frames, sets two attributes on <html> and CSS does the rest with transforms:
 *
 * - `data-chrome="hidden"` after scrolling down past 56 px (8 px of travel against jitter); any
 *   upward scroll, the end of the page, a focused field or control, a tap on the top edge and a new
 *   screen bring the bars back.
 * - `data-scrolled` once content runs under the top bar, which turns it from clear to glass.
 *
 * Nothing leaves the accessibility tree: hidden bars only move off screen, and focusing them brings
 * them back. The desktop rail never hides.
 */
const HIDE_AFTER = 56;
const THRESHOLD = 8;
const END_ZONE = 96;

export function useScrollChrome() {
  const { pathname } = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    let anchor = window.scrollY;
    let hidden = false;
    let frame = 0;
    const set = (hide: boolean) => {
      if (hide === hidden) return;
      hidden = hide;
      root.dataset.chrome = hide ? 'hidden' : 'shown';
    };
    const update = () => {
      const y = window.scrollY;
      root.dataset.scrolled = y > 4 ? 'true' : 'false';
      const nearEnd = y + window.innerHeight >= document.documentElement.scrollHeight - END_ZONE;
      if (y < HIDE_AFTER || nearEnd) {
        set(false);
        anchor = y;
        return;
      }
      if (hidden ? y > anchor : y < anchor)
        anchor = y; // still moving the same way
      else if (!hidden && y - anchor > THRESHOLD) {
        set(true);
        anchor = y;
      } else if (hidden && anchor - y > THRESHOLD) {
        set(false);
        anchor = y;
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const reveal = () => {
      set(false);
      anchor = window.scrollY;
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest('[data-chrome-bar]') || el.matches('input, textarea, select, [contenteditable="true"]'))
        reveal();
    };
    const onTouch = (e: PointerEvent) => {
      if (e.clientY < 24) reveal();
    };
    // First read in the next frame: reading scroll metrics now would force a layout mid-commit.
    frame = requestAnimationFrame(update);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('focusin', onFocus);
    window.addEventListener('pointerdown', onTouch, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('focusin', onFocus);
      window.removeEventListener('pointerdown', onTouch);
      delete root.dataset.chrome;
      delete root.dataset.scrolled;
    };
  }, []);

  // A new screen always starts with the bars visible.
  useEffect(() => {
    document.documentElement.dataset.chrome = 'shown';
  }, [pathname]);
}
