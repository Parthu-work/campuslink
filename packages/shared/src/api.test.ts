import { describe, expect, it } from 'vitest';
import { cursorPageQuery, API_PREFIX } from './api.js';

describe('cursorPageQuery', () => {
  it('applies a default limit', () => {
    expect(cursorPageQuery.parse({}).limit).toBe(20);
  });
  it('rejects limits above the cap', () => {
    expect(cursorPageQuery.safeParse({ limit: 500 }).success).toBe(false);
  });
  it('coerces numeric strings from query params', () => {
    expect(cursorPageQuery.parse({ limit: '5' }).limit).toBe(5);
  });
});

describe('API_PREFIX', () => {
  it('is versioned', () => expect(API_PREFIX).toBe('/api/v1'));
});
