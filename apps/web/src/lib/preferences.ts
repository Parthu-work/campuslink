import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import i18n, { loadLanguage } from '../i18n';
import { prefs } from './storage';

export type ThemePref = 'system' | 'dark' | 'light';
export type MotionPref = 'system' | 'full' | 'reduce';

interface PrefState {
  theme: ThemePref;
  motion: MotionPref;
  setTheme: (t: ThemePref) => void;
  setMotion: (m: MotionPref) => void;
  setLanguage: (l: 'en' | 'te') => void;
}

const root = document.documentElement;
/** Browser chrome colours per theme (index.html sets them per device theme before first paint). */
const CHROME = { light: '#f3f5fa', dark: '#070a14' } as const;
const applyTheme = (t: ThemePref) => {
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = CHROME[t === 'system' ? scheme : t];
  }
};
const applyMotion = (m: MotionPref) =>
  m === 'system' ? delete root.dataset.motion : (root.dataset.motion = m);

const initialTheme = (prefs.get('theme') as ThemePref | null) ?? 'system';
const initialMotion = (prefs.get('motion') as MotionPref | null) ?? 'system';
applyTheme(initialTheme);
applyMotion(initialMotion);

export const usePreferences = create<PrefState>((set) => ({
  theme: initialTheme,
  motion: initialMotion,
  setTheme: (theme) => {
    applyTheme(theme);
    prefs.set('theme', theme);
    set({ theme });
  },
  setMotion: (motion) => {
    applyMotion(motion);
    prefs.set('motion', motion);
    set({ motion });
  },
  setLanguage: (l) => {
    prefs.set('lang', l);
    void loadLanguage(l).then(() => i18n.changeLanguage(l));
  },
}));

export const prefersReducedMotion = () =>
  getComputedStyle(root).getPropertyValue('--motion-scale').trim() === '0';

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * The one reduced-motion signal for React code (audit MO-3): the in-app setting wins, "System"
 * follows the device. CSS reads the same decision through --motion-scale.
 */
export function useReducedMotionPref(): boolean {
  const motion = usePreferences((s) => s.motion);
  const os = useSyncExternalStore(
    (cb) => {
      reducedQuery.addEventListener('change', cb);
      return () => reducedQuery.removeEventListener('change', cb);
    },
    () => reducedQuery.matches,
  );
  return motion === 'reduce' || (motion === 'system' && os);
}
