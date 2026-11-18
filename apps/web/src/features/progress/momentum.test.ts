import { describe, expect, it } from 'vitest';
import type { TFunction } from '../../i18n/core';
import { momentumText } from './momentum';

const t = ((key: string, o?: Record<string, unknown>) => `${key} ${JSON.stringify(o ?? {})}`) as TFunction;
const now = Date.parse('2026-11-18T10:00:00Z');

describe('momentumText (prompt 3, U7)', () => {
  it('says nothing without an earlier score, or when the score did not go up', () => {
    expect(momentumText(t, null, now)).toBe('');
    expect(momentumText(t, undefined, now)).toBe('');
    expect(momentumText(t, { delta: 0, since: '2026-11-11' }, now)).toBe('');
    expect(momentumText(t, { delta: -4, since: '2026-11-11' }, now)).toBe('');
  });

  it('is "this week" for an earlier score from the last 8 days', () => {
    expect(momentumText(t, { delta: 6, since: '2026-11-11' }, now)).toBe('readiness.momentumWeek {"n":6}');
  });

  it('names the day for an older one', () => {
    const text = momentumText(t, { delta: 6, since: '2026-11-01' }, now);
    expect(text.startsWith('readiness.momentumSince')).toBe(true);
    expect(text).toContain('"n":6');
  });
});
