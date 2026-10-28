import { prefersReducedMotion } from './preferences';

/**
 * Scrolls a horizontal row (tabs, a tab bar) so `el` is in view, moving only the row.
 * `scrollIntoView` would also scroll every scrolling ancestor, the page included: a tab row below
 * the fold dragged the whole screen down to it on open.
 */
export function revealInRow(row: HTMLElement, el: HTMLElement, align: 'nearest' | 'center' = 'nearest') {
  const r = row.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  let left = row.scrollLeft;
  if (align === 'center') left += e.left - r.left - (r.width - e.width) / 2;
  else if (e.left < r.left) left -= r.left - e.left;
  else if (e.right > r.right) left += e.right - r.right;
  else return;
  row.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
