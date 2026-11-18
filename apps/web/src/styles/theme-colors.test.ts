import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every colour utility the code uses must exist (prompt 3, U7). `text-success-ink` and the other
 * status inks were used by badges and status lines for a long time while index.css never mapped
 * them, so Tailwind silently dropped the class and the text took the surrounding colour.
 */
const theme = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const PREFIX = '(?:text|bg|border|fill|stroke|ring|outline|decoration|divide|caret|accent|from|via|to)';
const FAMILY = '(?:brand|accent|success|warning|danger|info|subject-\\d)';
const CLASS = new RegExp(`(?<![\\w-])${PREFIX}-(${FAMILY}(?:-[a-z]+)?)(?![\\w-])`, 'g');

describe('theme colours', () => {
  it('every brand, status and subject colour class used has a --color- token', () => {
    const missing = new Set<string>();
    for (const [file, src] of Object.entries(sources))
      for (const m of src.matchAll(CLASS)) {
        const name = m[1] ?? '';
        if (!new RegExp(`--color-${name}:`).test(theme)) missing.add(`${name} (${file})`);
      }
    expect([...missing].sort()).toEqual([]);
  });
});
