import { useEffect } from 'react';

/** The path this page load started on; the first render there keeps the browser's own focus. */
const LOADED_AT = typeof location === 'undefined' ? '' : location.pathname;
let firstRender = true;

/**
 * Focus management for client-side navigation (WCAG 2.4.3). Browsers keep the Tab starting point
 * where a removed element was (the sign-in button, a link in a closed menu), so after a route
 * change focus moves to the main region, where screen readers start reading the new page. Focus
 * already inside the main region (tabs, in-page links) stays where the member put it. On a fresh
 * page load nothing moves, so the first Tab still reaches the skip link.
 */
export function useRouteFocus(pathname: string) {
  useEffect(() => {
    const fresh = firstRender && pathname === LOADED_AT;
    firstRender = false;
    if (fresh) return;
    const main = document.getElementById('main');
    if (!main || main.contains(document.activeElement)) return;
    main.focus({ preventScroll: true });
  }, [pathname]);
}
