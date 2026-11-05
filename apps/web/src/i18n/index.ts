import i18n from './core';
import { APP_NAME, DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@campuslink/shared';
import { prefs } from '../lib/storage';

/**
 * Only the member's language is downloaded (audit PF-1: both languages were 54 KB of the first
 * load). Another one loads when they switch (`loadLanguage`).
 */
const bundles: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./en.json'),
  te: () => import('./te.json'),
  hi: () => import('./hi.json'),
};

const saved = prefs.get('lang');
const initial: Locale = SUPPORTED_LOCALES.includes(saved as Locale) ? (saved as Locale) : DEFAULT_LOCALE;

/**
 * Packs: sections only some screens use, downloaded with those screens instead of with every
 * language (bundle budget: a language is one chunk). `career`: résumés and mock interviews (prompt 2).
 */
const PACKS = {
  career: {
    sections: ['resume', 'interviews'],
    load: {
      en: () => import('./packs/career.en.json'),
      te: () => import('./packs/career.te.json'),
      hi: () => import('./packs/career.hi.json'),
    },
  },
  // Placement readiness (prompt 2, G5): the student's score and the placement cell's board.
  readiness: {
    sections: ['readiness', 'readinessBoard'],
    load: {
      en: () => import('./packs/readiness.en.json'),
      te: () => import('./packs/readiness.te.json'),
      hi: () => import('./packs/readiness.hi.json'),
    },
  },
} satisfies Record<
  string,
  { sections: string[]; load: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> }
>;
export type Pack = keyof typeof PACKS;
const wanted = new Set<Pack>();

async function addPack(pack: Pack, lng: Locale) {
  const p = PACKS[pack];
  if (p.sections.every((s) => i18n.hasSection(lng, s))) return;
  const { default: strings } = await p.load[lng]();
  i18n.addStrings(lng, strings);
}

/** Loads a pack for the current language (and remembers it, so a language switch loads it too). */
export async function loadPack(pack: Pack) {
  wanted.add(pack);
  await i18nReady;
  await addPack(pack, i18n.language as Locale);
}

/** Downloads a language's strings once and registers them, with any packs already in use. */
export async function loadLanguage(lng: Locale) {
  if (!i18n.hasResourceBundle(lng, 'translation')) {
    const { default: strings } = await bundles[lng]();
    i18n.addResourceBundle(lng, 'translation', strings);
  }
  for (const p of wanted) await addPack(p, lng);
}

/** Resolves once the first language is ready; the app renders after it (main.tsx). */
export const i18nReady = bundles[initial]().then(({ default: strings }) =>
  i18n.init({
    resources: { [initial]: { translation: strings } },
    lng: initial,
    // Every language is at parity (a unit test checks it), so there is no fallback bundle.
    // {{app}} in any string is the product name (single source: packages/shared/src/brand.ts).
    defaultVariables: { app: APP_NAME },
  }),
);
document.documentElement.setAttribute('lang', initial);
i18n.on('languageChanged', (lng) => document.documentElement.setAttribute('lang', lng));

export default i18n;
