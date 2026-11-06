import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '@campuslink/shared';
import en from './en.json';

/** Every language's strings file, by its locale code (`./hi.json` → `hi`). */
const files = import.meta.glob<Record<string, unknown>>('./*.json', { eager: true, import: 'default' });
const bundle = (l: string) => files[`./${l}.json`];
/** Packs (`packs/<name>.<locale>.json`): sections loaded with the screens that use them. */
const packFiles = import.meta.glob<Record<string, unknown>>('./packs/*.json', {
  eager: true,
  import: 'default',
});
const packNames = [...new Set(Object.keys(packFiles).map((f) => f.split('/').pop()?.split('.')[0] ?? ''))];
const pack = (name: string, l: string) => packFiles[`./packs/${name}.${l}.json`];
/** Where each pack's sections may be used: only screens that load the pack (app/router.tsx, withPack). */
const PACK_USERS: Record<string, string[]> = {
  career: ['/features/resume/', '/features/interviews/', '/features/admin/interview-questions.tsx'],
  readiness: ['/features/progress/readiness.tsx', '/features/admin/readiness-admin.tsx'],
  alumni: ['/features/alumni/', '/features/admin/recognition-admin.tsx', '/features/admin/giving-admin.tsx'],
  practice: ['/features/practice/', '/features/admin/practice-bank.tsx'],
  habits: ['/features/habits/'],
};

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

  describe.each(packNames)('the %s pack', (name) => {
    const pe = flat(pack(name, 'en'));
    it('exists in every language with exactly the English keys and variables', () => {
      for (const l of SUPPORTED_LOCALES) {
        const t = flat(pack(name, l));
        expect(Object.keys(t).sort(), l).toEqual(Object.keys(pe).sort());
        expect(
          Object.keys(pe).filter(
            (k) => JSON.stringify(vars(pe[k] ?? '')) !== JSON.stringify(vars(t[k] ?? '')),
          ),
          l,
        ).toEqual([]);
        expect(
          Object.entries(t).filter(([, v]) => !v.trim()),
          l,
        ).toEqual([]);
      }
    });
    it('shares no section with the main strings', () => {
      expect(Object.keys(pack(name, 'en') ?? {}).filter((k) => k in en)).toEqual([]);
    });
  });

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
  const e = { ...flat(en), ...Object.assign({}, ...packNames.map((n) => flat(pack(n, 'en')))) } as Record<
    string,
    string
  >;
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
  it("uses a pack's sections only on the screens that load it", () => {
    const misplaced = packNames.flatMap((name) => {
      const sections = Object.keys(pack(name, 'en') ?? {});
      return code.flatMap(([file, src]) =>
        PACK_USERS[name]?.some((u) => file.includes(u))
          ? []
          : [...src.matchAll(/\bt\(\s*['`]([a-zA-Z]\w*)\./g)]
              .map((m) => m[1] ?? '')
              .filter((section) => sections.includes(section))
              .map((section) => `${file}: ${section}`),
      );
    });
    expect(misplaced).toEqual([]);
  });

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
