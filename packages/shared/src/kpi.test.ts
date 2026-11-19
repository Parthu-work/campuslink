import { describe, expect, it } from 'vitest';
import { kpi, kpiChange } from './schemas/analytics.js';

describe('headline numbers (prompt 3, U9c)', () => {
  it('suppresses both figures', () => {
    expect(kpi(12, 3)).toEqual({ value: 12, previous: '<5' });
    expect(kpi(0, null)).toEqual({ value: 0, previous: null });
  });

  it('shows a change only when both figures are shown', () => {
    expect(kpiChange(kpi(12, 7))).toBe(5);
    expect(kpiChange(kpi(7, 12))).toBe(-5);
    expect(kpiChange(kpi(9, 9))).toBe(0);
    expect(kpiChange(kpi(9, 0))).toBe(9);
    // A change from or to a count under 5 would reveal that count.
    expect(kpiChange(kpi(12, 3))).toBeNull();
    expect(kpiChange(kpi(3, 12))).toBeNull();
    expect(kpiChange(kpi(12, null))).toBeNull();
  });
});
