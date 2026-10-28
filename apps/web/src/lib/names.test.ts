import { describe, expect, it } from 'vitest';
import { firstName, initialsOf } from './names';

describe('names', () => {
  it('skip a courtesy title', () => {
    expect(firstName('Dr. Haritha Rao')).toBe('Haritha');
    expect(initialsOf('Dr. Haritha Rao')).toBe('HR');
    expect(firstName('Prof Ravi Kumar')).toBe('Ravi');
  });
  it('leave other names alone', () => {
    expect(firstName('Ananya K')).toBe('Ananya');
    expect(initialsOf('Srinivas Murthy')).toBe('SM');
    // A one-word name that happens to be a title stays as written.
    expect(firstName('Sri')).toBe('Sri');
  });
});
