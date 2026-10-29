import i18n from './core';
import { APP_NAME, DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@campuslink/shared';
import { prefs } from '../lib/storage';

/**
 * Only the member's language is downloaded (audit PF-1: both languages were 54 KB of the first
 * load). The other one loads when they switch (`loadLanguage`).
 */
const bundles: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./en.json'),
  te: () => import('./te.json'),
};

const saved = prefs.get('lang');
const initial: Locale = SUPPORTED_LOCALES.includes(saved as Locale) ? (saved as Locale) : DEFAULT_LOCALE;

/** Downloads a language's strings once and registers them. */
export async function loadLanguage(lng: Locale) {
  if (i18n.hasResourceBundle(lng, 'translation')) return;
  const { default: strings } = await bundles[lng]();
  i18n.addResourceBundle(lng, 'translation', strings);
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
