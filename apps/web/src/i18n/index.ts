import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE } from '@campuslink/shared';
import en from './en.json';
import te from './te.json';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, te: { translation: te } },
  lng: DEFAULT_LOCALE,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => document.documentElement.setAttribute('lang', lng));

export default i18n;
