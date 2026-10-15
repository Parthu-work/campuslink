import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

describe('health and readiness', () => {
  it('GET /api/v1/health returns ok with a request id', async () => {
    const res = await request(testApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { status: 'ok' } });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /api/v1/ready returns 503 when a dependency is down', async () => {
    const app = testApp({ readiness: { mongo: async () => true, redis: async () => false } });
    const res = await request(app).get('/api/v1/ready');
    expect(res.status).toBe(503);
    expect(res.body.data.checks).toEqual({ mongo: true, redis: false });
  });

  it('treats a throwing readiness check as not ready', async () => {
    const app = testApp({
      readiness: {
        mongo: async () => {
          throw new Error('boom');
        },
      },
    });
    const res = await request(app).get('/api/v1/ready');
    expect(res.status).toBe(503);
  });
});

describe('cross-cutting behaviour', () => {
  it('returns the error envelope for unknown routes', async () => {
    const res = await request(testApp()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('rejects a malformed request id and mints a fresh one', async () => {
    const res = await request(testApp()).get('/api/v1/health').set('x-request-id', '<script>');
    expect(res.headers['x-request-id']).not.toBe('<script>');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(testApp()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('returns 400 (not 500) for malformed JSON', async () => {
    const res = await request(testApp())
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('CORS allowlist', () => {
  it('allows a tenant subdomain', async () => {
    const res = await request(testApp()).get('/api/v1/health').set('origin', 'http://jntuh.localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://jntuh.localhost:5173');
  });

  it.each(['http://evil.com', 'http://a.b.localhost:5173', 'http://localhost.evil.com:5173', 'null'])(
    'rejects %s',
    async (origin) => {
      const res = await request(testApp()).get('/api/v1/health').set('origin', origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    },
  );
});
