import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const app = () => testApp().app;

describe('health and readiness', () => {
  it('GET /api/v1/health returns ok with a request id', async () => {
    const res = await request(app()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { status: 'ok' } });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /api/v1/ready returns 503 when a dependency is down', async () => {
    const a = testApp({ readiness: { mongo: async () => true, redis: async () => false } }).app;
    const res = await request(a).get('/api/v1/ready');
    expect(res.status).toBe(503);
    expect(res.body.data.checks).toEqual({ mongo: true, redis: false });
  });

  it('treats a throwing readiness check as not ready', async () => {
    const a = testApp({
      readiness: {
        mongo: async () => {
          throw new Error('boom');
        },
      },
    }).app;
    expect((await request(a).get('/api/v1/ready')).status).toBe(503);
  });
});

describe('cross-cutting behaviour', () => {
  it('returns the error envelope for unknown routes', async () => {
    const res = await request(app()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('rejects a malformed request id and mints a fresh one', async () => {
    const res = await request(app()).get('/api/v1/health').set('x-request-id', '<script>');
    expect(res.headers['x-request-id']).not.toBe('<script>');
  });

  it('sets security headers, no-store caching and hides the framework', async () => {
    const res = await request(app()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns 400 (not 500) for malformed JSON', async () => {
    const res = await request(app())
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('serves an OpenAPI document generated from the route registry', async () => {
    const res = await request(app()).get('/api/v1/openapi.json');
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/api/v1/admin/users/{id}/roles'].patch['x-permission']).toBe('roles:assign');
  });
});

describe('CORS allowlist', () => {
  it('allows a tenant subdomain', async () => {
    const res = await request(app()).get('/api/v1/health').set('origin', 'http://jntuh.localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://jntuh.localhost:5173');
  });

  it.each(['http://evil.com', 'http://a.b.localhost:5173', 'http://localhost.evil.com:5173', 'null'])(
    'rejects %s',
    async (origin) => {
      const res = await request(app()).get('/api/v1/health').set('origin', origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    },
  );
});
