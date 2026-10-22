import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/** Search params that belong to overlays, not to the screen (never remembered as a sub-route). */
const OVERLAY_PARAMS = ['sheet', 'compose', 'ask', 'step', 'story'];

const within = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

const screenHref = (pathname: string, search: string) => {
  const p = new URLSearchParams(search);
  for (const k of OVERLAY_PARAMS) p.delete(k);
  const s = p.toString();
  return s ? `${pathname}?${s}` : pathname;
};

// Per page load: which tab owns each history entry, and where each tab was left.
const owners = new Map<string, string>();
const lastScreen = new Map<string, string>();
let currentOwner: string | null = null;

/**
 * Bottom tabs behave like Instagram's (master prompt §7a): each tab remembers the last screen you
 * opened from it, a detail screen keeps its tab lit (a post opened from Home belongs to Home), and
 * tapping the lit tab goes back to that tab's root.
 */
export function useTabMemory(tabs: readonly { id: string; to: string }[]) {
  const location = useLocation();
  const type = useNavigationType();
  const direct = tabs.find((t) => within(location.pathname, t.to))?.id;
  const remembered = type === 'POP' ? owners.get(location.key) : undefined;
  const owner = remembered ?? direct ?? currentOwner ?? tabs[0]?.id ?? null;

  useLayoutEffect(() => {
    if (!owner) return;
    currentOwner = owner;
    owners.set(location.key, owner);
    lastScreen.set(owner, screenHref(location.pathname, location.search));
  }, [owner, location.key, location.pathname, location.search]);

  return {
    active: owner,
    /** Where tapping a tab goes: its root when it is the lit tab, else where you left it. */
    hrefFor: (tab: { id: string; to: string }) =>
      tab.id === owner ? tab.to : (lastScreen.get(tab.id) ?? tab.to),
  };
}
