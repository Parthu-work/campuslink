import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps a type-scale size beside a text colour', () => {
    expect(cn('text-meta font-semibold text-fg-2')).toBe('text-meta font-semibold text-fg-2');
    expect(cn('text-headline', 'text-brand-ink')).toBe('text-headline text-brand-ink');
  });
  it('still lets a later size or shadow win', () => {
    expect(cn('text-meta', 'text-title')).toBe('text-title');
    expect(cn('shadow-elev-1', 'shadow-elev-3')).toBe('shadow-elev-3');
  });
});
