import { describe, expect, it } from 'vitest';
import { labelEvery, niceTicks } from './chart';

describe('chart helpers', () => {
  it('ticks land on round steps and cover the largest value', () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(1750)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(niceTicks(9)).toEqual([0, 5, 10]);
    expect(niceTicks(1)).toEqual([0, 0.5, 1]);
    expect(niceTicks(120_000)).toEqual([0, 50_000, 100_000, 150_000]);
  });

  it('labels thin out evenly and the last one always shows', () => {
    const show7 = labelEvery(7, 7);
    expect([0, 1, 2, 3, 4, 5, 6].filter(show7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const show30 = labelEvery(30, 6);
    const shown = Array.from({ length: 30 }, (_, i) => i).filter(show30);
    expect(shown.length).toBeLessThanOrEqual(7);
    expect(shown.at(-1)).toBe(29);
    expect(shown).not.toContain(28);
  });
});
