import { describe, expect, it } from 'vitest';
import { formatCompact } from './numbers';

describe('formatCompact', () => {
  it('stays exact below a lakh (no "1.4T" for 1,400 tokens)', () => {
    expect(formatCompact(1400)).toBe('1,400');
    expect(formatCompact(99_999)).toBe('99,999');
  });

  it('uses the Indian short forms above it', () => {
    expect(formatCompact(250_000)).toBe('2.5L');
    expect(formatCompact(34_000_000)).toBe('3.4Cr');
  });
});
