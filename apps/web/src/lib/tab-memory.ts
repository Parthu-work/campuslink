import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router';
import { spaceOf, type NavSpace, type SectionRef, type SpaceId } from '@campuslink/shared';

/** Search params that belong to overlays, not to the screen (never remembered as a sub-route). */
const OVERLAY_PARAMS = ['sheet', 'compose', 'ask', 'step', 'story'];

const screenHref = (pathname: string, search: string) => {
  const p = new URLSearchParams(search);
  for (const k of OVERLAY_PARAMS) p.delete(k);
  const s = p.toString();
  return s ? `${pathname}?${s}` : pathname;
};

// Per page load: where each space was left, and the space of the last screen that had one.
const lastScreen = new Map<SpaceId, string>();
let lastOwner: SpaceId | null = null;

/**
 * Which space is lit, and where its tab goes (prompt 3, U2). The lit one is the space that owns
 * the current URL in the navigation model (`spaceOf`), so a deep link, a notification or Back
 * always lights the right tab, whatever was pressed before. Each space still remembers the last
 * screen opened in it; tapping the lit tab returns to that space's first screen.
 */
export function useSpaceMemory(spaces: readonly NavSpace[]): {
  active: SpaceId | null;
  section: SectionRef | null;
  hrefFor: (space: { id: SpaceId; to: string }) => string;
} {
  const location = useLocation();
  const owner = spaceOf(spaces, location.pathname)?.space.id ?? null;
  const section = spaceOf(spaces, location.pathname)?.section?.key ?? null;
  // A screen no space owns (a legal page opened from Settings) keeps the last space lit, but is
  // never remembered as that space's screen: its tab must not lead back to it.
  const stillThere = lastOwner && spaces.some((s) => s.id === lastOwner) ? lastOwner : null;
  const active = owner ?? stillThere ?? spaces[0]?.id ?? null;

  useLayoutEffect(() => {
    if (!owner) return;
    lastOwner = owner;
    lastScreen.set(owner, screenHref(location.pathname, location.search));
  }, [owner, location.pathname, location.search]);

  return {
    active,
    section,
    hrefFor: (space) => (space.id === active ? space.to : (lastScreen.get(space.id) ?? space.to)),
  };
}
