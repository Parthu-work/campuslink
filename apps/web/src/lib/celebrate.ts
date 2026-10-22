import { create } from 'zustand';
import { usePreferences } from './preferences';
import { prefs } from './storage';

export interface Celebration {
  id: number;
  x: number;
  y: number;
}

/** The burst on screen, if any (components/layout/celebration-host.tsx draws it). */
export const useCelebration = create<{ current: Celebration | null; clear: () => void }>((set) => ({
  current: null,
  clear: () => set({ current: null }),
}));

let next = 0;

/**
 * True the first time any of these ids is seen on this device (then remembered), so a moment is
 * celebrated once, not on every visit. A per-device convenience, like a read marker.
 */
export function firstSighting(kind: string, ids: readonly string[]): boolean {
  const key = `seen-${kind}`;
  let seen: string[] = [];
  try {
    seen = JSON.parse(prefs.get(key) ?? '[]') as string[];
  } catch {
    /* start again */
  }
  const fresh = ids.filter((id) => !seen.includes(id));
  if (!fresh.length) return false;
  prefs.set(key, JSON.stringify([...seen, ...fresh].slice(-200)));
  return true;
}

/** A short vibration for a confirmation, only when the member turned haptics on. */
export function haptic(pattern: number | number[] = 12) {
  if (usePreferences.getState().haptics) navigator.vibrate?.(pattern);
}

/** Pop an icon button that just switched on (a reaction, a bookmark): `.react-pop[data-pop]`. */
export function pop(el: HTMLElement) {
  el.removeAttribute('data-pop');
  void el.offsetWidth; // restart the animation if it is still running
  el.setAttribute('data-pop', '');
}

/**
 * Celebrate a real moment (ADR 0008: request accepted, booking confirmed, step done, badge,
 * streak milestone, referral, verification, quiz complete): an aurora burst of at most 1.2 s from
 * the element that caused it, never blocking, a still glow under reduced motion. Never for quiet
 * moments (declines, cancellations, failures).
 */
export function celebrate(from?: Element | null) {
  const r = from?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const y = r ? r.top + r.height / 2 : window.innerHeight * 0.38;
  next += 1;
  useCelebration.setState({ current: { id: next, x, y } });
  haptic([10, 40, 18]);
}
