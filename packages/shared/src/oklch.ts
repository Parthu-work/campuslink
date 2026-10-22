/**
 * OKLCH colour maths (Björn Ottosson's OKLab, as used by CSS `oklch()`), sRGB gamut mapping and
 * WCAG 2.2 contrast. Pure functions: the palette generator (palette.ts) and its tests use them.
 */
export interface Oklch {
  /** Lightness, 0–1. */
  l: number;
  /** Chroma, 0 to about 0.37 inside sRGB. */
  c: number;
  /** Hue in degrees, 0–360. */
  h: number;
}

type Rgb = [number, number, number];

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGammaByte = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

/** Linear-light sRGB, possibly outside 0–1 when the colour is out of gamut. */
export function oklchToLinearRgb({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

export function hexToOklch(hex: string): Oklch {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255)) as Rgb;
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, B);
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c, h: c < 1e-4 ? 0 : (h + 360) % 360 };
}

const EPS = 1e-6;
export const inGamut = (color: Oklch) => oklchToLinearRgb(color).every((v) => v >= -EPS && v <= 1 + EPS);

/** Rounds the way the CSS output does: lightness and chroma to 3 decimals, hue to 1. */
const round = ({ l, c, h }: Oklch): Oklch => ({
  l: Math.round(l * 1000) / 1000,
  c: Math.floor(c * 1000) / 1000,
  h: Math.round((((h % 360) + 360) % 360) * 10) / 10,
});

/**
 * The colour itself if sRGB can show it, else the same lightness and hue with as much chroma as
 * fits. Rounded like the CSS output, so what is tested is exactly what the browser paints.
 */
export function toGamut(color: Oklch): Oklch {
  const l = Math.min(1, Math.max(0, color.l));
  if (inGamut({ ...color, l })) return round({ ...color, l });
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ l, c: mid, h: color.h })) lo = mid;
    else hi = mid;
  }
  return round({ l, c: lo, h: color.h });
}

/** Reads an opaque `oklch(l c h)` value as written by `formatOklch`; null for anything else. */
export function parseOklch(value: string): Oklch | null {
  const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value.trim());
  return m ? { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) } : null;
}

export const formatOklch = ({ l, c, h }: Oklch, alpha?: number) =>
  `oklch(${+l.toFixed(3)} ${+c.toFixed(3)} ${+h.toFixed(1)}${alpha === undefined ? '' : ` / ${alpha}`})`;

export function oklchToHex(color: Oklch): string {
  return `#${oklchToLinearRgb(color)
    .map((v) => toGammaByte(v).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** WCAG relative luminance, from the clipped sRGB colour the browser paints. */
export function relativeLuminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearRgb(color).map((v) => Math.min(1, Math.max(0, v))) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Oklch, b: Oklch): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
