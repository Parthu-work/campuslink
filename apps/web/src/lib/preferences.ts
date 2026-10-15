import { create } from 'zustand';
import i18n from '../i18n';
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
const applyTheme = (t: ThemePref) => (t === 'system' ? delete root.dataset.theme : (root.dataset.theme = t));
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
    void i18n.changeLanguage(l);
  },
}));

export const prefersReducedMotion = () =>
  getComputedStyle(root).getPropertyValue('--motion-scale').trim() === '0';
