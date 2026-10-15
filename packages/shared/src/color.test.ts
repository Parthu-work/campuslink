import { describe, expect, it } from 'vitest';
import { contrast, ensureContrast, onColor } from './color.js';

describe('colour helpers', () => {
  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  it.each(['#3fb8e6', '#22b07d', '#f2b705', '#ff7a59', '#ffffff', '#000000'])(
    'ensureContrast(%s) reaches 5.5:1 on both themes',
    (c) => {
      expect(contrast(ensureContrast(c, '#ffffff', 5.5), '#ffffff')).toBeGreaterThanOrEqual(5.5);
      expect(contrast(ensureContrast(c, '#0d1222', 5.5), '#0d1222')).toBeGreaterThanOrEqual(5.5);
    },
  );
  it('picks readable text for filled surfaces', () => {
    expect(onColor('#3fb8e6')).toBe('#06101c');
    expect(onColor('#1a237e')).toBe('#ffffff');
  });
});
