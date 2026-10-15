import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { APP_NAME, DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@campuslink/shared';
import en from './en.json';
import te from './te.json';
import { prefs } from '../lib/storage';

const saved = prefs.get('lang');
const initial: Locale = SUPPORTED_LOCALES.includes(saved as Locale) ? (saved as Locale) : DEFAULT_LOCALE;

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, te: { translation: te } },
  lng: initial,
  fallbackLng: 'en',
  // {{app}} in any string is the product name (single source: packages/shared/src/brand.ts).
  interpolation: { escapeValue: false, defaultVariables: { app: APP_NAME } },
  returnNull: false,
});
document.documentElement.setAttribute('lang', initial);
i18n.on('languageChanged', (lng) => document.documentElement.setAttribute('lang', lng));

export default i18n;
