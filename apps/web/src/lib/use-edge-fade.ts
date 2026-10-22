import { useCallback, useEffect, useRef, useState } from 'react';

export type EdgeFade = 'none' | 'start' | 'end' | 'both';

/**
 * For horizontal scrollers: which edges have more content beyond them, so the row can fade there
 * and show that it scrolls (audit NB-4). Pair with the `edge-fade` class and `data-fade`.
 */
export function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [fade, setFade] = useState<EdgeFade>('none');
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 2;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setFade(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none');
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The observer reports once on observe (after layout), so there is no measuring mid-commit.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure]);
  return { ref, fade, measure };
}
