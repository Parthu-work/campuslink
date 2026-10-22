import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/** The path this page load started on; the first render there keeps the browser's own focus. */
const LOADED_AT = typeof location === 'undefined' ? '' : location.pathname;
let firstRender = true;

/** For each history entry, the link the member followed out of it (to give focus back on Back). */
const leftVia = new Map<string, string>();

/**
 * Focus management for client-side navigation (WCAG 2.4.3, master prompt §7b).
 *
 * - After moving to another screen, focus goes to its main heading, so screen readers announce the
 *   new screen by name, and the document title follows that heading ("Jobs · DPIT", A11Y-6b).
 * - Back gives focus to the link the member followed from that screen.
 * - Focus already inside the content (tabs, in-page links) stays where the member put it, and on a
 *   fresh page load nothing moves, so the first Tab still reaches the skip link.
 */
export function useRouteFocus(collegeName: string) {
  const location = useLocation();
  const type = useNavigationType();

  // Remember which link left each entry.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest('a[href]');
      const href = a?.getAttribute('href');
      if (href?.startsWith('/')) leftVia.set(location.key, href);
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, [location.key]);

  useEffect(() => {
    const main = document.getElementById('main');
    const heading = main?.querySelector<HTMLElement>('h1');
    const name = heading?.textContent?.trim();
    document.title = name ? `${name} · ${collegeName}` : collegeName;

    const fresh = firstRender && location.pathname === LOADED_AT;
    firstRender = false;
    if (fresh || !main || main.contains(document.activeElement)) return;

    if (type === 'POP') {
      const href = leftVia.get(location.key);
      const back = href ? main.querySelector<HTMLElement>(`a[href="${CSS.escape(href)}"]`) : null;
      if (back) {
        back.focus({ preventScroll: true });
        return;
      }
    }
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    } else main.focus({ preventScroll: true });
    // Once per screen; the heading text can change later (a name loading) without moving focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
}
