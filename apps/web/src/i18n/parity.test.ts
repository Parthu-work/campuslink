import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '@campuslink/shared';
import en from './en.json';

/** Every language's strings file, by its locale code (`./hi.json` → `hi`). */
const files = import.meta.glob<Record<string, unknown>>('./*.json', { eager: true, import: 'default' });
const bundle = (l: string) => files[`./${l}.json`];

/** Flattens nested strings to "a.b.c" → value. */
const flat = (o: unknown, prefix = ''): Record<string, string> =>
  Object.entries(o as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') acc[key] = v;
    else Object.assign(acc, flat(v, key));
    return acc;
  }, {});

const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('every language', () => {
  it('has a strings file for each supported locale, and no stray ones', () => {
    expect(Object.keys(files).sort()).toEqual(SUPPORTED_LOCALES.map((l) => `./${l}.json`).sort());
  });

  const e = flat(en);
  // The app loads only the member's language and has no fallback bundle (i18n/index.ts).
  describe.each(SUPPORTED_LOCALES.filter((l) => l !== 'en'))('%s', (l) => {
    const t = flat(bundle(l));

    it('has exactly the English keys', () => {
      expect(Object.keys(t).sort()).toEqual(Object.keys(e).sort());
    });

    it('uses the same interpolation variables', () => {
      const mismatched = Object.keys(e).filter(
        (k) => JSON.stringify(vars(e[k] ?? '')) !== JSON.stringify(vars(t[k] ?? '')),
      );
      expect(mismatched).toEqual([]);
    });

    it('never leaves a string empty', () => {
      expect(Object.entries(t).filter(([, v]) => !v.trim())).toEqual([]);
    });
  });
});

describe('keys the code asks for', () => {
  const e = flat(en);
  const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const code = Object.entries(sources);
  // i18next plurals live under key_one / key_other.
  const exists = (k: string) => k in e || `${k}_one` in e || `${k}_other` in e;

  it('every literal key exists', () => {
    const missing = code.flatMap(([file, src]) =>
      [...src.matchAll(/\bt\(\s*'([a-zA-Z][\w.-]*)'/g)]
        .map((m) => m[1] ?? '')
        .filter((k) => k.includes('.') && !exists(k))
        .map((k) => `${file}: ${k}`),
    );
    expect(missing).toEqual([]);
  });

  // A key built at run time (`progress.mentorLevels.${id}`) needs a group of strings under its
  // prefix; once a string took a group's name and every mentor level showed its raw key.
  it('every built key has a group of strings under its prefix', () => {
    const missing = code.flatMap(([file, src]) =>
      [...src.matchAll(/\bt\(\s*`([a-zA-Z][\w.-]*\.)\$\{/g)]
        .map((m) => m[1] ?? '')
        .filter((prefix) => !Object.keys(e).some((k) => k.startsWith(prefix)))
        .map((prefix) => `${file}: ${prefix}…`),
    );
    expect(missing).toEqual([]);
  });
});
