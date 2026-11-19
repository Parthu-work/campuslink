import { useCallback, useEffect, useState } from 'react';

/** How far below (and above) the screen an element counts as near: about a screen's height. */
const MARGIN = '600px 0px';

let observer: IntersectionObserver | null = null;
const callbacks = new WeakMap<Element, () => void>();
const observe = (el: Element, onNear: () => void) => {
  if (typeof IntersectionObserver === 'undefined') {
    onNear();
    return () => undefined;
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          callbacks.get(e.target)?.();
          callbacks.delete(e.target);
          observer?.unobserve(e.target);
        }
    },
    { rootMargin: MARGIN },
  );
  callbacks.set(el, onNear);
  observer.observe(el);
  return () => {
    callbacks.delete(el);
    observer?.unobserve(el);
  };
};

/**
 * True once the element has come within about a screen of the viewport, and true from then on
 * (prompt 3, U10): images fetched with the session (avatars, feed photos) load only when they are
 * about to be seen, instead of all at once for a long list. One observer for every caller.
 */
export function useNearViewport<T extends Element>(): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!el || near) return;
    return observe(el, () => setNear(true));
  }, [el, near]);
  const ref = useCallback((node: T | null) => setEl(node), []);
  return [ref, near];
}
