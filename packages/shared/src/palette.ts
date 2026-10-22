import { contrastRatio, formatOklch, hexToOklch, oklchToHex, toGamut, type Oklch } from './oklch.js';

/**
 * The "Campus Aurora" palette (master prompt §4, ADR 0008), generated from one input: the hue of
 * the college's primary colour. Every college gets the same calm, tinted neutrals, a brand ramp
 * clamped to a pleasant lightness and chroma, contrast-checked inks, the aurora gradient stops and
 * eight subject accents. The college's exact colour is used only for its logo.
 *
 * Values are CSS `oklch()` strings, rounded and gamut-mapped exactly as tested (palette.test.ts).
 */
export type Theme = 'light' | 'dark';
export type Tokens = Record<string, string>;

export const DEFAULT_HUE = 275;
/** Body text and inks on the canvas and surfaces. */
export const TEXT_RATIO = 4.5;
/** Coloured text (`*-ink`): a margin above AA for tinted surfaces such as badges. */
export const INK_RATIO = 5.5;

const BRAND_L = [0.55, 0.68] as const;
const BRAND_C = [0.12, 0.2] as const;
const ACCENT_L = [0.6, 0.75] as const;
const ACCENT_C = [0.12, 0.18] as const;
/** Ramp lightness from 50 to 950, and how much of the brand chroma each step keeps. */
const RAMP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const RAMP_L = [0.975, 0.945, 0.895, 0.825, 0.745, 0.665, 0.585, 0.505, 0.425, 0.345, 0.275];
const RAMP_C = [0.12, 0.25, 0.45, 0.7, 0.9, 1, 1, 0.92, 0.8, 0.66, 0.52];
/** Hue offsets of the eight subject accents. */
export const SUBJECT_OFFSETS = [0, 45, 90, 135, 180, 225, 270, 315] as const;
/** Aurora: the brand hue and two neighbours. */
export const AURORA_OFFSETS = [0, 45, 100] as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const hueOf = (h: number) => ((h % 360) + 360) % 360;
const ok = (l: number, c: number, h: number): Oklch => toGamut({ l, c, h: hueOf(h) });
const css = (color: Oklch) => formatOklch(color);
const minContrast = (fg: Oklch, bgs: Oklch[]) => Math.min(...bgs.map((b) => contrastRatio(fg, b)));

/** Steps lightness away from the backgrounds until `fg` reaches `ratio` against all of them. */
function ink(start: Oklch, bgs: Oklch[], ratio: number, theme: Theme): Oklch {
  let color = toGamut(start);
  const step = theme === 'light' ? -0.005 : 0.005;
  for (let i = 0; i < 200 && minContrast(color, bgs) < ratio; i++)
    color = toGamut({ ...color, l: color.l + step });
  return color;
}

/**
 * A fill and its label colour. White labels are crisper on saturated fills, so a fill darkens by up
 * to 0.08 to carry one; otherwise near-black, and the fill darkens further only when neither reads.
 */
function onFill(fill: Oklch, h: number): { fill: Oklch; on: Oklch } {
  const dark = ok(0.18, 0.02, h);
  const white = ok(1, 0, 0);
  for (let d = 0; d <= 0.08 + 1e-9; d += 0.005) {
    const f = toGamut({ ...fill, l: fill.l - d });
    if (contrastRatio(white, f) >= TEXT_RATIO) return { fill: f, on: white };
  }
  if (contrastRatio(dark, fill) >= TEXT_RATIO) return { fill, on: dark };
  let f = fill;
  while (contrastRatio(white, f) < TEXT_RATIO && f.l > 0.2) f = toGamut({ ...f, l: f.l - 0.005 });
  return { fill: f, on: white };
}

export interface Neutrals {
  bg: Oklch;
  s1: Oklch;
  s2: Oklch;
  s3: Oklch;
}

/** Canvas and surfaces, tinted by the brand hue (chroma 0.004–0.014). */
export function neutrals(h: number, theme: Theme): Neutrals {
  return theme === 'light'
    ? { bg: ok(0.985, 0.005, h), s1: ok(1, 0, 0), s2: ok(0.965, 0.008, h), s3: ok(0.935, 0.01, h) }
    : { bg: ok(0.16, 0.012, h), s1: ok(0.19, 0.012, h), s2: ok(0.225, 0.013, h), s3: ok(0.26, 0.014, h) };
}

/** A college colour's hue with lightness and chroma brought into range; greys get the fallback. */
function fromCollege(
  hex: string | null | undefined,
  l: readonly [number, number],
  c: readonly [number, number],
) {
  if (!hex) return null;
  const o = hexToOklch(hex);
  return o.c < 0.03 ? null : ok(clamp(o.l, l), clamp(o.c, c), o.h);
}

/** The brand primary for a college colour: its hue, with lightness and chroma brought into range. */
export const brandPrimary = (hex?: string | null): Oklch =>
  fromCollege(hex, BRAND_L, BRAND_C) ?? ok(0.6, 0.17, DEFAULT_HUE);

/** The college's accent, same treatment; without one, the third aurora hue. */
export const brandAccent = (hex: string | null | undefined, primary: Oklch): Oklch =>
  fromCollege(hex, ACCENT_L, ACCENT_C) ?? ok(0.66, 0.16, primary.h + AURORA_OFFSETS[2]);

/** The two colours a college picks that the palette uses (the secondary is for its logo only). */
export interface CollegeColours {
  primary?: string | null | undefined;
  accent?: string | null | undefined;
}

export interface Palette {
  hue: number;
  light: Tokens;
  dark: Tokens;
  /** The canvas as hex, for `<meta name="theme-color">` (browser chrome). */
  chrome: Record<Theme, string>;
}

function themeTokens(primary: Oklch, accentBase: Oklch, theme: Theme): Tokens {
  const h = primary.h;
  const n = neutrals(h, theme);
  const text = [n.bg, n.s1, n.s2];
  const light = theme === 'light';
  const t: Tokens = {
    '--hue': String(+h.toFixed(1)),
    '--bg': css(n.bg),
    '--surface-1': css(n.s1),
    '--surface-2': css(n.s2),
    '--surface-3': css(n.s3),
    '--line': light ? css(ok(0.91, 0.01, h)) : formatOklch(ok(1, 0, 0), 0.08),
    '--line-strong': light ? css(ok(0.84, 0.014, h)) : formatOklch(ok(1, 0, 0), 0.16),
    '--fg': css(ink(light ? ok(0.21, 0.014, h) : ok(0.965, 0.006, h), [n.bg, n.s1, n.s2, n.s3], 12, theme)),
    '--fg-2': css(ink(light ? ok(0.43, 0.014, h) : ok(0.8, 0.012, h), [n.bg, n.s1, n.s2, n.s3], 6, theme)),
    '--fg-3': css(ink(light ? ok(0.52, 0.012, h) : ok(0.68, 0.012, h), [...text, n.s3], TEXT_RATIO, theme)),
    // Opaque enough that bar text keeps its contrast over any content (audit quick win 15).
    '--glass': formatOklch(n.s1, 0.92),
    '--glass-solid': css(n.s1),
    '--scrim': light ? formatOklch(ok(0.2, 0.02, h), 0.42) : formatOklch(ok(0.08, 0.01, h), 0.62),
  };

  // Brand, and the two aurora neighbours used as secondary and accent.
  const brand = onFill(primary, h);
  const second = ok(primary.l, primary.c, h + AURORA_OFFSETS[1]);
  const accent = onFill(accentBase, accentBase.h);
  t['--brand'] = css(brand.fill);
  t['--on-brand'] = css(brand.on);
  t['--brand-2'] = css(second);
  t['--accent'] = css(accent.fill);
  t['--on-accent'] = css(accent.on);
  t['--brand-ink'] = css(ink(light ? brand.fill : ok(0.72, primary.c, h), text, INK_RATIO, theme));
  t['--accent-ink'] = css(
    ink(light ? accent.fill : ok(0.74, accentBase.c, accentBase.h), text, INK_RATIO, theme),
  );
  RAMP.forEach((step, i) => {
    t[`--brand-${step}`] = css(ok(RAMP_L[i] ?? 0.5, primary.c * (RAMP_C[i] ?? 1), h));
  });

  // Aurora stops: vivid, decorative (rings, XP, celebrations); never a text colour.
  AURORA_OFFSETS.forEach((o, i) => {
    t[`--aurora-${i + 1}`] = css(ok(light ? 0.64 : 0.72, light ? 0.17 : 0.16, h + o));
  });

  // Subject accents: same lightness and chroma, hue offsets from the brand.
  SUBJECT_OFFSETS.forEach((o, i) => {
    const sh = h + o;
    const surface = light ? ok(0.955, 0.03, sh) : ok(0.27, 0.04, sh);
    t[`--subject-${i + 1}`] = css(ok(light ? 0.64 : 0.72, 0.13, sh));
    t[`--subject-${i + 1}-surface`] = css(surface);
    t[`--subject-${i + 1}-ink`] = css(
      ink(light ? ok(0.5, 0.12, sh) : ok(0.8, 0.11, sh), [...text, surface], TEXT_RATIO, theme),
    );
  });
  return t;
}

/** Tokens that follow the college's hue, for both themes. */
export function generatePalette(colours: CollegeColours = {}): Palette {
  const primary = brandPrimary(colours.primary);
  const accent = brandAccent(colours.accent, primary);
  return {
    hue: primary.h,
    light: themeTokens(primary, accent, 'light'),
    dark: themeTokens(primary, accent, 'dark'),
    chrome: {
      light: oklchToHex(neutrals(primary.h, 'light').bg),
      dark: oklchToHex(neutrals(primary.h, 'dark').bg),
    },
  };
}

/** Fixed hues: status colours, role chips and charts look the same in every college. */
export const SEMANTIC_HUES = { success: 150, warning: 75, danger: 25, info: 235 } as const;
export const ROLE_HUES = { student: 250, alumni: 310, faculty: 165, admin: 45 } as const;
/** Six categorical chart colours: fixed lightness and chroma, hues far apart. */
export const CHART_HUES = [255, 30, 150, 80, 320, 195] as const;

/** Fixed-hue tokens (status, roles, charts), for both themes. Neutrals use the default hue. */
export function staticTokens(): Record<Theme, Tokens> {
  const out: Record<Theme, Tokens> = { light: {}, dark: {} };
  for (const theme of ['light', 'dark'] as const) {
    const light = theme === 'light';
    const n = neutrals(DEFAULT_HUE, theme);
    const text = [n.bg, n.s1, n.s2];
    const t = out[theme];
    for (const [name, h] of Object.entries(SEMANTIC_HUES)) {
      const surface = light ? ok(0.96, 0.035, h) : ok(0.255, 0.045, h);
      const fg = ok(light ? 0.6 : 0.72, light ? 0.15 : 0.15, h);
      const textInk = ink(light ? ok(0.5, 0.13, h) : ok(0.78, 0.13, h), [...text, surface], INK_RATIO, theme);
      t[`--${name}`] = css(textInk);
      t[`--${name}-ink`] = css(textInk);
      t[`--${name}-fg`] = css(fg);
      t[`--${name}-surface`] = css(surface);
      t[`--${name}-border`] = css(light ? ok(0.85, 0.07, h) : ok(0.42, 0.08, h));
    }
    // A filled destructive button: white text at 4.5:1 or better in both themes.
    const dangerFill = onFill(ok(light ? 0.52 : 0.55, 0.19, SEMANTIC_HUES.danger), SEMANTIC_HUES.danger);
    t['--danger-fill'] = css(dangerFill.fill);
    t['--on-danger'] = css(dangerFill.on);
    for (const [role, h] of Object.entries(ROLE_HUES)) {
      const surface = light ? ok(0.95, 0.035, h) : ok(0.27, 0.045, h);
      t[`--role-${role}-surface`] = css(surface);
      t[`--role-${role}-ink`] = css(
        ink(light ? ok(0.5, 0.12, h) : ok(0.8, 0.1, h), [surface, n.s1], TEXT_RATIO, theme),
      );
    }
    CHART_HUES.forEach((h, i) => {
      t[`--chart-${i + 1}`] = css(ok(light ? 0.6 : 0.72, 0.14, h));
    });
  }
  return out;
}

/** CSS for a set of per-theme tokens, with the same theme selectors as tokens.css (dark first). */
export function themeCss(tokens: Record<Theme, Tokens>): string {
  const block = (t: Tokens, indent: string) =>
    Object.entries(t)
      .map(([k, v]) => `${indent}${k}: ${v};`)
      .join('\n');
  return [
    `:root {\n${block(tokens.dark, '  ')}\n}`,
    `@media (prefers-color-scheme: light) {\n  :root:not([data-theme='dark']) {\n${block(tokens.light, '    ')}\n  }\n}`,
    `:root[data-theme='light'] {\n${block(tokens.light, '  ')}\n}`,
  ].join('\n');
}

/** The college's own palette, injected at runtime over the default (applyBranding). */
export const tenantPaletteCss = (colours: CollegeColours) => themeCss(generatePalette(colours));

/** apps/web/src/styles/palette.css: the default hue plus the fixed-hue tokens. */
export function defaultPaletteCss(): string {
  const p = generatePalette();
  const s = staticTokens();
  const header = [
    '/*',
    ' * Generated from packages/shared/src/palette.ts by `pnpm --filter @campuslink/web palette`.',
    ' * Do not edit. The default hue (275) and the fixed status, role and chart colours.',
    ' */',
  ].join('\n');
  return `${header}\n${themeCss({ light: { ...p.light, ...s.light }, dark: { ...p.dark, ...s.dark } })}\n`;
}
