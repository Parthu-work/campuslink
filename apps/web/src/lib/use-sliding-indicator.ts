import { useEffect, useState, type RefObject } from 'react';

export interface IndicatorStyle {
  transform: string;
  width: number;
  opacity: number;
}

/**
 * Position of a highlight that slides to the active item of a row (tabs, segmented controls). The
 * row's own CSS animates `transform` and `width`, scaled by --motion-scale.
 *
 * Measured only from the ResizeObserver, which reports once on observe and after every layout, so
 * reading positions never forces an extra layout while React is still committing.
 */
export function useSlidingIndicator(
  container: RefObject<HTMLElement | null>,
  activeSelector: string,
  key: unknown,
): IndicatorStyle {
  const [style, setStyle] = useState<IndicatorStyle>({ transform: 'translateX(0)', width: 0, opacity: 0 });
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>(activeSelector);
      if (!active) return setStyle((s) => (s.opacity ? { ...s, opacity: 0 } : s));
      const left = active.offsetLeft;
      const width = active.offsetWidth;
      setStyle((s) =>
        s.width === width && s.opacity === 1 && s.transform === `translateX(${left}px)`
          ? s
          : { transform: `translateX(${left}px)`, width, opacity: 1 },
      );
    };
    // Re-created when the active item changes (`key`), so it reports again for the new one.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [container, activeSelector, key]);
  return style;
}
