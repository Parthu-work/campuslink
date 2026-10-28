import { describe, expect, it } from 'vitest';
import en from './en.json';
import te from './te.json';

/** Flattens nested strings to "a.b.c" → value. */
const flat = (o: unknown, prefix = ''): Record<string, string> =>
  Object.entries(o as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') acc[key] = v;
    else Object.assign(acc, flat(v, key));
    return acc;
  }, {});

const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('English and Telugu strings', () => {
  const e = flat(en);
  const t = flat(te);

  // The app loads only the member's language and has no fallback bundle (i18n/index.ts).
  it('have exactly the same keys', () => {
    expect(Object.keys(t).sort()).toEqual(Object.keys(e).sort());
  });

  it('use the same interpolation variables', () => {
    const mismatched = Object.keys(e).filter(
      (k) => JSON.stringify(vars(e[k] ?? '')) !== JSON.stringify(vars(t[k] ?? '')),
    );
    expect(mismatched).toEqual([]);
  });

  it('never leave a Telugu string empty', () => {
    expect(Object.entries(t).filter(([, v]) => !v.trim())).toEqual([]);
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
