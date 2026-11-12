import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('refuses placeholder secrets in production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/placeholder secrets/);
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-access-secret-at-least-32-characters-long',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
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

  it('treats a setting left empty as not set (KEY= lines in an env file)', () => {
    const env = loadEnv({
      AI_DEFAULT_PROVIDER: '',
      ERROR_REPORTER_DSN: '',
      BILLING_SELLER_GSTIN: '',
      AI_PLATFORM_PRICE_INPUT: '',
      SMTP_PORT: '',
      LOG_LEVEL: '',
    });
    expect(env.AI_DEFAULT_PROVIDER).toBeUndefined();
    expect(env.ERROR_REPORTER_DSN).toBeUndefined();
    expect(env.BILLING_SELLER_GSTIN).toBeUndefined();
    // Not 0: an empty price is "no price", not "free".
    expect(env.AI_PLATFORM_PRICE_INPUT).toBeUndefined();
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.LOG_LEVEL).toBe('info');
  });

  // Prompt 4 (P3, P9): what a real deployment must set.
  describe('production deployment checks', () => {
    const prod = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_TICKET_SECRET: 'b'.repeat(40),
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
      MALWARE_SCANNER: 'clamav',
      APP_ROOT_DOMAIN: 'campus.example',
      MONGODB_URI: 'mongodb://campuslink_app:s3cret-value@mongo:27017/campuslink?replicaSet=rs0',
    };

    it('accepts a complete production environment', () => {
      expect(loadEnv(prod).APP_ROOT_DOMAIN).toBe('campus.example');
    });

    it('refuses APP_ROOT_DOMAIN=localhost (and any *.localhost)', () => {
      const { APP_ROOT_DOMAIN: _d, ...rest } = prod;
      expect(() => loadEnv(rest)).toThrow(/APP_ROOT_DOMAIN=localhost is not allowed/);
      expect(() => loadEnv({ ...prod, APP_ROOT_DOMAIN: 'localhost' })).toThrow(/APP_ROOT_DOMAIN/);
      expect(() => loadEnv({ ...prod, APP_ROOT_DOMAIN: 'staging.localhost' })).toThrow(/APP_ROOT_DOMAIN/);
      // Development keeps its default.
      expect(loadEnv({ NODE_ENV: 'development' }).APP_ROOT_DOMAIN).toBe('localhost');
    });

    it('refuses a MONGODB_URI without a username and a password, and never echoes it', () => {
      for (const uri of [
        'mongodb://mongo:27017/campuslink',
        'mongodb://user@mongo:27017/campuslink',
        'mongodb://:pw@mongo:27017/campuslink',
        'mongodb://mongo:27017/campuslink?authSource=user:pw@x',
      ]) {
        let message = '';
        try {
          loadEnv({ ...prod, MONGODB_URI: uri });
        } catch (e) {
          message = String(e);
        }
        expect(message, uri).toMatch(/MONGODB_URI needs a username and password/);
        expect(message).not.toContain('mongo:27017');
      }
      expect(() =>
        loadEnv({ ...prod, MONGODB_URI: 'mongodb+srv://app:pw@cluster.example/campuslink' }),
      ).not.toThrow();
    });

    it('refuses VECTOR_STORE=memory in an api process (the worker would keep another index)', () => {
      expect(() => loadEnv({ ...prod, VECTOR_STORE: 'memory', PROCESS_ROLE: 'api' })).toThrow(
        /VECTOR_STORE=memory is not allowed with PROCESS_ROLE=api/,
      );
      expect(() => loadEnv({ ...prod, VECTOR_STORE: 'memory', PROCESS_ROLE: 'all' })).not.toThrow();
      expect(() =>
        loadEnv({ ...prod, VECTOR_STORE: 'qdrant', QDRANT_URL: 'http://qdrant:6333', PROCESS_ROLE: 'api' }),
      ).not.toThrow();
    });

    it('REHEARSAL=true (deploy/staging only) lifts the domain and credential checks, nothing else', () => {
      const local = {
        ...prod,
        APP_ROOT_DOMAIN: 'localhost',
        MONGODB_URI: 'mongodb://mongo:27017/campuslink',
      };
      expect(() => loadEnv({ ...local, REHEARSAL: 'true' })).not.toThrow();
      expect(() => loadEnv({ ...local, REHEARSAL: 'true', MALWARE_SCANNER: 'none' })).toThrow(
        /MALWARE_SCANNER/,
      );
      expect(() => loadEnv({ ...local, REHEARSAL: 'true', MAIL_DRIVER: 'disabled' })).toThrow(/MAIL_DRIVER/);
    });
  });
});
