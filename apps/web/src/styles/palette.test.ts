import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultPaletteCss } from '@campuslink/shared';

describe('palette.css', () => {
  it('is what the generator produces (run `pnpm --filter @campuslink/web palette`)', () => {
    const file = readFileSync(new URL('./palette.css', import.meta.url), 'utf8');
    expect(file).toBe(defaultPaletteCss());
  });

  it('is the only place colour values are defined', () => {
    // tokens.css keeps the story gradients (tested for white text) and nothing else raw.
    const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
    const raw = tokens.match(/#[0-9a-f]{6}\b/gi) ?? [];
    expect(raw).toEqual(['#8f1b3e', '#b2471b', '#0b3f72', '#136b80', '#123f24', '#2a6a3f']);
  });
});
