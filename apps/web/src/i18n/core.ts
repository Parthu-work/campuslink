/**
 * The app's translation runtime: the part of i18next it used (dotted keys, `{{var}}` interpolation
 * with default variables, `_one`/`_other` plurals by the language's plural rules, `defaultValue`,
 * language switching) in about 1 KB instead of 13 KB of the first load (build B1, bundle budget).
 * Strings are plain text rendered by React, so nothing is escaped here.
 */
type Strings = Record<string, unknown>;
export type TOptions = Record<string, unknown> & { count?: number; defaultValue?: string };
export type TFunction = (key: string, options?: TOptions) => string;

interface InitOptions {
  resources: Record<string, { translation: Strings }>;
  lng: string;
  /** Variables every string may use ({{app}}). */
  defaultVariables?: Record<string, string>;
}

const VAR = /\{\{\s*(\w+)\s*\}\}/g;

function lookup(strings: Strings | undefined, key: string): string | undefined {
  let cur: unknown = strings;
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Strings)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export class Translator {
  language = 'en';
  private readonly bundles = new Map<string, Strings>();
  private readonly listeners = new Set<(lng: string) => void>();
  private defaults: Record<string, string> = {};
  private plurals = new Intl.PluralRules('en');

  init(o: InitOptions): Promise<void> {
    for (const [lng, r] of Object.entries(o.resources)) this.bundles.set(lng, r.translation);
    this.defaults = o.defaultVariables ?? {};
    this.setLanguage(o.lng);
    return Promise.resolve();
  }

  hasResourceBundle(lng: string, _ns = 'translation'): boolean {
    return this.bundles.has(lng);
  }

  addResourceBundle(lng: string, _ns: string, strings: Strings): void {
    this.bundles.set(lng, strings);
  }

  async changeLanguage(lng: string): Promise<void> {
    if (lng === this.language) return;
    this.setLanguage(lng);
    for (const fn of this.listeners) fn(lng);
  }

  on(_event: 'languageChanged', fn: (lng: string) => void): void {
    this.listeners.add(fn);
  }

  off(_event: 'languageChanged', fn: (lng: string) => void): void {
    this.listeners.delete(fn);
  }

  /** The string for `key` with its variables filled in; the key itself when there is none. */
  t: TFunction = (key, options = {}) => {
    const strings = this.bundles.get(this.language);
    const { count } = options;
    const raw =
      (typeof count === 'number'
        ? (lookup(strings, `${key}_${this.plurals.select(count)}`) ?? lookup(strings, `${key}_other`))
        : undefined) ??
      lookup(strings, key) ??
      options.defaultValue ??
      key;
    return raw.replace(VAR, (_m, name: string) => {
      const v = name in options ? options[name] : this.defaults[name];
      return v === undefined || v === null ? '' : String(v);
    });
  };

  private setLanguage(lng: string) {
    this.language = lng;
    this.plurals = new Intl.PluralRules(lng);
  }
}

const i18n = new Translator();
export default i18n;
