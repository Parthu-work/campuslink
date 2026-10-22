import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToOklch, inGamut, oklchToHex, type Oklch } from './oklch.js';
import {
  brandPrimary,
  generatePalette,
  INK_RATIO,
  neutrals,
  staticTokens,
  TEXT_RATIO,
  themeCss,
  type Theme,
  type Tokens,
} from './palette.js';

/** Master prompt §4: at least these eight, including the awkward ones (neon lime, pure red). */
const COLLEGES = {
  maroon: '#800000',
  navy: '#000080',
  saffron: '#ff9933',
  'forest green': '#228b22',
  'neon lime': '#ccff00',
  'pure red': '#ff0000',
  teal: '#008080',
  purple: '#800080',
};
const THEMES: Theme[] = ['light', 'dark'];
/** Accents a college might pair with each (gold, saffron, white-ish, none…), including awkward ones. */
const ACCENTS: Record<string, string | undefined> = {
  '#800000': '#f2b705',
  '#000080': '#ff9933',
  '#ff9933': '#000080',
  '#228b22': '#ffd700',
  '#ccff00': '#ff00ff',
  '#ff0000': '#ffffff',
  '#008080': undefined,
  '#800080': '#00ffcc',
};

const parse = (value: string | undefined): Oklch => {
  const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value ?? '');
  if (!m) throw new Error(`Not an opaque oklch() value: ${value}`);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
};
const color = (t: Tokens, name: string) => parse(t[name]);
const textBackgrounds = (t: Tokens) => ['--bg', '--surface-1', '--surface-2'].map((k) => color(t, k));
const worst = (fg: Oklch, bgs: Oklch[]) => Math.min(...bgs.map((b) => contrastRatio(fg, b)));

describe('OKLCH maths', () => {
  it('round-trips sRGB colours', () => {
    for (const hex of ['#800000', '#000080', '#ff9933', '#ccff00', '#ffffff', '#3fb8e6']) {
      const back = oklchToHex(hexToOklch(hex));
      const diff = [1, 3, 5].map((i) =>
        Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)),
      );
      expect(Math.max(...diff)).toBeLessThanOrEqual(1);
    }
  });

  it('measures WCAG contrast', () => {
    expect(contrastRatio({ l: 1, c: 0, h: 0 }, { l: 0, c: 0, h: 0 })).toBeCloseTo(21, 1);
  });
});

describe.each(Object.entries(COLLEGES))('palette for a %s college', (_, hex) => {
  const palette = generatePalette({ primary: hex, accent: ACCENTS[hex] });

  it('keeps the hue and clamps the brand into a pleasant range', () => {
    const input = hexToOklch(hex);
    const brand = brandPrimary(hex);
    expect(Math.abs(brand.h - input.h)).toBeLessThan(0.1);
    expect(brand.l).toBeGreaterThanOrEqual(0.55);
    expect(brand.l).toBeLessThanOrEqual(0.68);
    expect(brand.c).toBeLessThanOrEqual(0.2);
  });

  it.each(THEMES)('every colour is inside sRGB (%s)', (theme) => {
    for (const [name, value] of Object.entries(palette[theme])) {
      if (!value.startsWith('oklch(') || value.includes('/')) continue;
      expect(inGamut(parse(value)), name).toBe(true);
    }
  });

  it.each(THEMES)('text reads on the canvas and every surface (%s)', (theme) => {
    const t = palette[theme];
    const surfaces = [...textBackgrounds(t), color(t, '--surface-3')];
    expect(worst(color(t, '--fg'), surfaces)).toBeGreaterThanOrEqual(12);
    expect(worst(color(t, '--fg-2'), surfaces)).toBeGreaterThanOrEqual(6);
    expect(worst(color(t, '--fg-3'), surfaces)).toBeGreaterThanOrEqual(TEXT_RATIO);
  });

  it.each(THEMES)('inks keep 5.5:1, labels on fills 4.5:1 (%s)', (theme) => {
    const t = palette[theme];
    expect(worst(color(t, '--brand-ink'), textBackgrounds(t))).toBeGreaterThanOrEqual(INK_RATIO);
    expect(worst(color(t, '--accent-ink'), textBackgrounds(t))).toBeGreaterThanOrEqual(INK_RATIO);
    expect(contrastRatio(color(t, '--on-brand'), color(t, '--brand'))).toBeGreaterThanOrEqual(TEXT_RATIO);
    expect(contrastRatio(color(t, '--on-accent'), color(t, '--accent'))).toBeGreaterThanOrEqual(TEXT_RATIO);
    // The focus ring is the brand ink: 3:1 against the canvas is the WCAG bar for indicators.
    expect(contrastRatio(color(t, '--brand-ink'), color(t, '--bg'))).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('subject accents are readable as text and on their own chip (%s)', (theme) => {
    const t = palette[theme];
    for (let i = 1; i <= 8; i++) {
      const surfaces = [...textBackgrounds(t), color(t, `--subject-${i}-surface`)];
      expect(worst(color(t, `--subject-${i}-ink`), surfaces), `subject ${i}`).toBeGreaterThanOrEqual(
        TEXT_RATIO,
      );
    }
  });

  it('ramps from light to dark', () => {
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) =>
      color(palette.light, `--brand-${s}`),
    );
    for (let i = 1; i < steps.length; i++) expect(steps[i]?.l ?? 0).toBeLessThan(steps[i - 1]?.l ?? 1);
  });
});

describe('fallbacks', () => {
  it('uses indigo-violet (hue 275) without a colour or for a grey', () => {
    expect(generatePalette().hue).toBe(275);
    expect(generatePalette({ primary: '#808080' }).hue).toBe(275);
  });

  it('tints neutrals with the hue but keeps them quiet (chroma 0.004–0.014)', () => {
    for (const theme of THEMES) {
      const n = neutrals(30, theme);
      for (const s of [n.bg, n.s2, n.s3]) {
        expect(s.c).toBeGreaterThanOrEqual(0.004);
        expect(s.c).toBeLessThanOrEqual(0.014);
      }
    }
  });
});

describe('fixed-hue tokens', () => {
  const tokens = staticTokens();

  it.each(THEMES)('status inks reach 5.5:1 on surfaces and their own tint (%s)', (theme) => {
    const t = tokens[theme];
    const n = neutrals(275, theme);
    for (const name of ['success', 'warning', 'danger', 'info']) {
      const bgs = [n.bg, n.s1, n.s2, color(t, `--${name}-surface`)];
      expect(worst(color(t, `--${name}-ink`), bgs), name).toBeGreaterThanOrEqual(INK_RATIO);
    }
    expect(contrastRatio(color(t, '--on-danger'), color(t, '--danger-fill'))).toBeGreaterThanOrEqual(
      TEXT_RATIO,
    );
  });

  it.each(THEMES)('role chips are readable (%s)', (theme) => {
    const t = tokens[theme];
    for (const role of ['student', 'alumni', 'faculty', 'admin']) {
      const ink = color(t, `--role-${role}-ink`);
      expect(contrastRatio(ink, color(t, `--role-${role}-surface`)), role).toBeGreaterThanOrEqual(TEXT_RATIO);
    }
  });

  it.each(THEMES)('chart colours stand out from the card (3:1, %s)', (theme) => {
    const t = tokens[theme];
    const card = neutrals(275, theme).s1;
    for (let i = 1; i <= 6; i++)
      expect(contrastRatio(color(t, `--chart-${i}`), card)).toBeGreaterThanOrEqual(3);
  });
});

describe('themeCss', () => {
  it('writes dark first, then light for the device setting and for a saved choice', () => {
    const css = themeCss({ light: { '--x': 'oklch(1 0 0)' }, dark: { '--x': 'oklch(0 0 0)' } });
    expect(css).toBe(
      [
        ':root {\n  --x: oklch(0 0 0);\n}',
        "@media (prefers-color-scheme: light) {\n  :root:not([data-theme='dark']) {\n    --x: oklch(1 0 0);\n  }\n}",
        ":root[data-theme='light'] {\n  --x: oklch(1 0 0);\n}",
      ].join('\n'),
    );
  });
});
