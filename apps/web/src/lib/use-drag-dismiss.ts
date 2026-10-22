import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Phones get the bottom-sheet layout (dialog.tsx); wider screens never drag. */
const BOTTOM_LAYOUT = '(max-width: 47.99rem)';

/**
 * Swipe a bottom sheet down to close it (audit DS-5). Spread the returned handlers on the grab
 * area (the handle and header). The sheet follows the finger through the `translate` property,
 * which composes with the enter and exit animations' `transform`; letting go past a quarter of its
 * height, or flicking down, closes it, otherwise it settles back on the smooth spring.
 */
export function useDragDismiss(onDismiss: () => void) {
  const drag = useRef<{ el: HTMLElement; y0: number; y: number; t: number; v: number } | null>(null);

  const settle = (el: HTMLElement) => {
    el.style.transition = 'translate var(--dur-smooth) var(--ease-smooth)';
    el.style.translate = '';
    el.addEventListener('transitionend', () => (el.style.transition = ''), { once: true });
  };

  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (e.button !== 0 || !window.matchMedia(BOTTOM_LAYOUT).matches) return;
      // Buttons and links in the header keep their own taps.
      if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
      const el = e.currentTarget.closest<HTMLElement>('[role="dialog"]');
      if (!el) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      el.style.transition = 'none';
      drag.current = { el, y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0 };
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      const dt = Math.max(1, e.timeStamp - d.t);
      d.v = (e.clientY - d.y) / dt;
      d.y = e.clientY;
      d.t = e.timeStamp;
      const dy = e.clientY - d.y0;
      // Down follows the finger; up resists (the sheet is already as tall as its content).
      d.el.style.translate = `0 ${dy > 0 ? dy : dy / 6}px`;
    },
    onPointerUp() {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const dy = d.y - d.y0;
      if (dy > d.el.offsetHeight * 0.25 || (dy > 24 && d.v > 0.6)) onDismiss();
      else settle(d.el);
    },
    onPointerCancel() {
      const d = drag.current;
      drag.current = null;
      if (d) settle(d.el);
    },
  };
}
