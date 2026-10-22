import { useLayoutEffect, useState, type RefObject } from 'react';

export interface IndicatorStyle {
  transform: string;
  width: number;
  opacity: number;
}

/**
 * Position of a highlight that slides to the active item of a row (tabs, segmented controls). The
 * row's own CSS animates `transform` and `width`, scaled by --motion-scale.
 */
export function useSlidingIndicator(
  container: RefObject<HTMLElement | null>,
  activeSelector: string,
  key: unknown,
): IndicatorStyle {
  const [style, setStyle] = useState<IndicatorStyle>({ transform: 'translateX(0)', width: 0, opacity: 0 });
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>(activeSelector);
      if (!active) return setStyle((s) => ({ ...s, opacity: 0 }));
      setStyle({ transform: `translateX(${active.offsetLeft}px)`, width: active.offsetWidth, opacity: 1 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [container, activeSelector, key]);
  return style;
}
