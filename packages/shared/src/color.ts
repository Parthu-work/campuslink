/** Colour helpers used to keep tenant branding accessible (WCAG 2.2 contrast). */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]: [number, number, number]): string {
  return (
    '#' +
    [r, g, b]
      .map((v) =>
        Math.round(Math.min(255, Math.max(0, v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** Mix toward black or white in small steps until `fg` reaches `ratio` against `bg`. */
export function ensureContrast(fg: string, bg: string, ratio = 4.5): string {
  if (contrast(fg, bg) >= ratio) return fg.toLowerCase();
  const target: [number, number, number] = luminance(bg) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  const src = channels(fg);
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = toHex(src.map((v, i) => v + ((target[i] ?? 0) - v) * t) as [number, number, number]);
    if (contrast(c, bg) >= ratio) return c;
  }
  return toHex(target);
}
/** Pick dark or white text for a filled brand surface. */
export function onColor(fill: string, dark = '#06101c'): string {
  return contrast(dark, fill) >= contrast('#ffffff', fill) ? dark : '#ffffff';
}
