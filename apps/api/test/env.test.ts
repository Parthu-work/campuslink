import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('refuses placeholder secrets in production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/placeholder secrets/);
  });

  it('does not echo secret values in validation errors', () => {
    try {
      loadEnv({ JWT_ACCESS_SECRET: 'short-secret-value' });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain('JWT_ACCESS_SECRET');
      expect(String(e)).not.toContain('short-secret-value');
    }
  });

  it('parses the CORS allowlist', () => {
    expect(loadEnv({ CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test' }).CORS_ALLOWED_ORIGINS).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
  });
});
