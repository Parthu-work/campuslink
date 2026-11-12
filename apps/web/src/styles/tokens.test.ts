import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** ADR 0015's type, shape and motion tokens, read from the stylesheet the app ships. */
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

const STEPS: Record<string, [number, number]> = {
  display: [32, 36],
  title: [22, 28],
  headline: [18, 24],
  body: [16, 24],
  callout: [14, 20],
  caption: [12.5, 16],
};
const value = (block: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
const latin = css.slice(0, css.indexOf(":root:is([lang='te'], [lang='hi'])"));
const indic = css.slice(css.indexOf(":root:is([lang='te'], [lang='hi'])"));

describe('type scale (ADR 0015)', () => {
  it.each(Object.entries(STEPS))('%s is %s px at 360 and grows 15% by 1280', (step, [size, line]) => {
    const clamp = value(latin, `text-${step}`) ?? '';
    const [min, mid, max] = /clamp\(([\d.]+)rem, ([^,]+), ([\d.]+)rem\)/.exec(clamp)?.slice(1) ?? [];
    expect(Number(min) * 16).toBeCloseTo(size, 2);
    expect(Number(max) * 16).toBeCloseTo(size * 1.15, 1);
    // The preferred value meets the floor at 360 px and the ceiling at 1280 px.
    const [rem, vw] = /([\d.]+)rem \+ ([\d.]+)vw/
      .exec(mid ?? '')
      ?.slice(1)
      .map(Number) ?? [0, 0];
    expect((rem ?? 0) * 16 + ((vw ?? 0) * 360) / 100).toBeCloseTo(size, 1);
    expect((rem ?? 0) * 16 + ((vw ?? 0) * 1280) / 100).toBeCloseTo(size * 1.15, 1);
    expect(Number(value(latin, `lh-${step}`)) * size).toBeCloseTo(line, 1);
  });

  it('never goes under 12.5 px', () => {
    for (const step of Object.keys(STEPS)) {
      const min = Number(/clamp\(([\d.]+)rem/.exec(value(latin, `text-${step}`) ?? '')?.[1]);
      expect(min * 16).toBeGreaterThanOrEqual(12.5);
    }
  });

  it.each(Object.keys(STEPS))('Telugu and Devanagari get 2 px more line height on %s', (step) => {
    const ratio = value(latin, `lh-${step}`);
    expect(value(indic, `lh-${step}`)).toBe(`calc(${ratio}em + 2px)`);
  });

  it('Tailwind utilities read the step line heights, and the retired steps are gone', () => {
    for (const step of Object.keys(STEPS))
      expect(theme).toContain(`--text-${step}--line-height: var(--lh-${step});`);
    expect(`${css}${theme}`).not.toMatch(/--text-(meta|lead|hero)\b/);
  });
});

describe('shape, motion and density (ADR 0015)', () => {
  it('has three radii: 8, 12 and 20', () => {
    const radii = ['xs', 'sm', 'md', 'lg', 'xl'].map((r) => value(latin, `radius-${r}`));
    expect(new Set(radii)).toEqual(new Set(['8px', '12px', '20px']));
  });

  it('presses in 120 ms, enters in 200 and moves sheets in 280, scaled for reduced motion', () => {
    expect(value(latin, 'dur-press')).toBe('calc(120ms * var(--motion-scale))');
    expect(value(latin, 'dur-enter')).toBe('calc(200ms * var(--motion-scale))');
    expect(value(latin, 'dur-sheet')).toBe('calc(280ms * var(--motion-scale))');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[^}]*--motion-scale: 0/s);
  });

  it('draws no shadow under cards (elev-1) in either theme', () => {
    expect(css.match(/--elev-1:[^;]+;/g)?.every((d) => d === '--elev-1: none;')).toBe(true);
  });

  it('keeps compact rows at a 44 px target', () => {
    const compact = css.slice(css.indexOf("[data-density='compact']"));
    expect(Number(value(compact, 'row-min-h')?.replace('rem', '')) * 16).toBeGreaterThanOrEqual(44);
  });
});
