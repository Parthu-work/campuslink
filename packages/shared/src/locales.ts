/**
 * Every language the product speaks. Adding one is a translation job (docs/adding-a-language.md):
 * add it here, add its strings file and server texts; types and database enums follow from this.
 */
export const SUPPORTED_LOCALES = ['en', 'te', 'hi'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Each language's name in its own script (language pickers show these, never translated). */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  te: 'తెలుగు',
  hi: 'हिन्दी',
};

/** BCP 47 tags for dates and numbers (`Intl`), with Indian conventions. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: 'en-IN',
  te: 'te-IN',
  hi: 'hi-IN',
};

/** The English name of each language (AI prompts and logs). */
export const LOCALE_ENGLISH_NAMES: Record<Locale, string> = {
  en: 'English',
  te: 'Telugu',
  hi: 'Hindi',
};

export const isLocale = (v: unknown): v is Locale =>
  typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v);

/** A stored or requested language narrowed to one the product speaks (else the default). */
export const toLocale = (v: unknown): Locale => (isLocale(v) ? v : DEFAULT_LOCALE);

/** The language after `l` in the list (a one-tap "switch language" cycles through them all). */
export const nextLocale = (l: unknown): Locale => {
  const i = SUPPORTED_LOCALES.indexOf(toLocale(l));
  return SUPPORTED_LOCALES[(i + 1) % SUPPORTED_LOCALES.length] ?? DEFAULT_LOCALE;
};
