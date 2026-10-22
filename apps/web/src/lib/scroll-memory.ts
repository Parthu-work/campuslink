import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType, type Location } from 'react-router';

/**
 * Scroll restoration that survives late content (audit TR-3: "back lands at 222 px, not 900 px").
 *
 * - Back and forward restore the exact position of that history entry.
 * - A new screen starts at the top.
 * - Tabs remember their own position: going back to a tab by tapping it returns to where you were.
 * - Opening an overlay (`?sheet=`, `?compose=`) or changing a filter on the same screen never moves
 *   the page.
 *
 * Positions are recorded continuously while scrolling (so nothing depends on a "before navigation"
 * hook), and a restore is re-applied while the page grows (cached lists, images, virtualised rows)
 * for up to 1.5 s, until the member scrolls, taps or types.
 */
const STORAGE_KEY = 'cl:scroll';
const SETTLE_MS = 1500;

let positions: Record<string, number> = {};
try {
  positions = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, number>;
} catch {
  positions = {};
}

/** History-entry key, or a stable key for tab roots so each tab keeps its own place. */
export function scrollKey(
  location: Pick<Location, 'pathname' | 'search' | 'key'>,
  tabRoots: ReadonlySet<string>,
) {
  return tabRoots.has(location.pathname) ? `tab:${location.pathname}${location.search}` : location.key;
}

export function useScrollMemory(tabRoots: ReadonlySet<string>) {
  const location = useLocation();
  const type = useNavigationType();
  const keyRef = useRef('');
  const previous = useRef<Location | null>(null);

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (keyRef.current) positions[keyRef.current] = window.scrollY;
      });
    };
    const persist = () => {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
      } catch {
        // Private mode: positions still work for this page's lifetime.
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', persist);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', persist);
      cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    const prev = previous.current;
    previous.current = location;
    const key = scrollKey(location, tabRoots);
    keyRef.current = key;
    const sameScreen = !!prev && prev.pathname === location.pathname;
    // Direction for the screen transition (styles/index.css): Back reverses a push, tabs crossfade.
    document.documentElement.dataset.nav = sameScreen
      ? 'none'
      : type === 'POP'
        ? 'back'
        : key.startsWith('tab:')
          ? 'tab'
          : 'forward';
    // Same screen (an overlay opened or closed, a filter changed): leave the page where it is.
    if (sameScreen) return;

    let target: number;
    const saved = positions[key];
    if (type === 'POP' || key.startsWith('tab:')) target = saved ?? 0;
    else if (location.hash) {
      document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
      return;
    } else target = 0;

    window.scrollTo(0, target);
    if (target === 0) return;

    // Content above or in the list may still be rendering: keep the position until it settles.
    let stopped = false;
    const stop = () => {
      stopped = true;
      observer.disconnect();
      for (const e of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const)
        window.removeEventListener(e, stop);
    };
    const observer = new ResizeObserver(() => {
      if (!stopped && Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target);
    });
    observer.observe(document.body);
    for (const e of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const)
      window.addEventListener(e, stop, { passive: true, once: true });
    const timer = window.setTimeout(stop, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      stop();
    };
    // Runs once per location; tabRoots changes only with the member's role.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
}
