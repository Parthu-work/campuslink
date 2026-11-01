import { beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { api, makeTenant, makeUser, testApp, type TestTenant, type TestUser } from './helpers.js';
import {
  SentryErrorReporter,
  maskRoute,
  parseDsn,
  scrub,
  sentryEvent,
  type ErrorReport,
} from '../src/lib/error-reporter.js';
import { metrics } from '../src/lib/metrics.js';
import { createLogger } from '../src/lib/logger.js';

/** Application-side observability (build B14): metrics, error reports, and no personal data in either. */
const TOKEN = 'metrics-token-for-the-tests-0123456789abcdef';
const ctx = testApp({
  env: loadEnv({
    NODE_ENV: 'test',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://*.localhost:5173',
    HIBP_ENABLED: 'false',
    METRICS_TOKEN: TOKEN,
  }),
});
let T: TestTenant, P: TestTenant;
let student: TestUser;

const PERSONAL = /[\w.+-]+@[\w-]+\.\w+|\+?91[\d\s-]{8,}|\b[a-f0-9]{24}\b|Ananya/i;

beforeAll(async () => {
  T = await makeTenant('obs');
  P = await makeTenant('admin', 'platform');
  student = await makeUser(ctx, T, { roles: ['STUDENT'] });
});

describe('GET /metrics', () => {
  it('needs the token, and lives on the platform host only', async () => {
    expect((await api(ctx, P.host).get('/metrics')).status).toBe(401);
    expect((await api(ctx, P.host).get('/metrics').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await api(ctx, T.host).get('/metrics').set('Authorization', `Bearer ${TOKEN}`)).status).toBe(404);
  });

  it('counts requests by route pattern, never by concrete path', async () => {
    await api(ctx, T.host, student.token).get(`/support/tickets/${student.id}`);
    const r = await api(ctx, P.host).get('/metrics').set('Authorization', `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/plain');
    expect(r.text).toContain('# TYPE campuslink_http_requests_total counter');
    expect(r.text).toContain('route="/support/tickets/:id"');
    expect(r.text).toContain('campuslink_jobs_total');
    expect(r.text).toContain('campuslink_otp_sends_total');
    expect(r.text).toContain('campuslink_ai_tokens_total');
    expect(r.text).toContain('campuslink_whatsapp_delivery_failures_total');
    // No ids, emails, numbers or names in any label.
    expect(r.text).not.toMatch(PERSONAL);
  });

  it('is off (404) without METRICS_TOKEN', async () => {
    const off = testApp();
    expect((await api(off, P.host).get('/metrics').set('Authorization', `Bearer ${TOKEN}`)).status).toBe(404);
  });
});

describe('POST /client-errors', () => {
  it('accepts a browser report without signing in, and refuses anything else', async () => {
    const before = metrics.clientErrors.get({ kind: 'chunk' });
    const r = await api(ctx, T.host)
      .post('/client-errors')
      .send({ kind: 'chunk', message: 'Failed to fetch dynamically imported module', route: '/jobs/:id' });
    expect(r.status).toBe(202);
    expect(metrics.clientErrors.get({ kind: 'chunk' })).toBe(before + 1);
    expect(
      (
        await api(ctx, T.host)
          .post('/client-errors')
          .send({ kind: 'chunk', message: 'x', route: '/', email: 'a@b.c' })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(ctx, T.host)
          .post('/client-errors')
          .send({ kind: 'boundary', message: 'x', route: '/', userHash: 'NOTHEX' })
      ).status,
    ).toBe(400);
  });
});

describe('error reports carry no personal data', () => {
  const nasty: ErrorReport = {
    kind: 'api',
    type: 'TypeError',
    message:
      'Cannot read x of ananya@dpit.example (+91 98765 43210) user 64b7f0c2a1b2c3d4e5f60718 token eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl',
    requestId: 'req-1',
    route: '/profiles/64b7f0c2a1b2c3d4e5f60718?email=ananya@dpit.example',
    tenant: 'dpit',
  };

  it('scrubs emails, numbers, ids and tokens, and drops query strings', () => {
    const s = scrub(nasty.message);
    expect(s).not.toMatch(PERSONAL);
    expect(s).not.toContain('eyJ');
    expect(maskRoute(nasty.route ?? '')).toBe('/profiles/:id');
  });

  it('the Sentry event holds only the type, scrubbed message, request id, route and college', () => {
    const e = sentryEvent(nasty, 'test');
    const json = JSON.stringify(e);
    expect(json).not.toMatch(PERSONAL);
    expect(e.tags).toEqual({ kind: 'api', request_id: 'req-1', route: '/profiles/:id', tenant: 'dpit' });
    expect(e.exception.values[0]?.type).toBe('TypeError');
  });

  it('sends a Sentry envelope to the DSN host only, with no personal data', async () => {
    expect(parseDsn('https://publickey@errors.example.org/42')).toEqual({
      endpoint: 'https://errors.example.org/api/42/envelope/',
      key: 'publickey',
      host: 'errors.example.org',
    });
    expect(() => parseDsn('http://k@errors.example.org/42')).toThrow();
    const sent: { url: string; body: string; hosts: readonly string[] | undefined }[] = [];
    const reporter = new SentryErrorReporter(
      'https://publickey@errors.example.org/42',
      'test',
      createLogger('silent'),
      async (url, opts) => {
        sent.push({ url, body: String(opts?.body ?? ''), hosts: opts?.allowHosts });
        return { status: 200, contentType: 'application/json', body: Buffer.from('{}'), finalUrl: url };
      },
    );
    await reporter.report({ ...nasty, kind: 'web', userHash: 'a'.repeat(64) });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://errors.example.org/api/42/envelope/');
    expect(sent[0]?.hosts).toEqual(['errors.example.org']);
    expect(sent[0]?.body).not.toMatch(PERSONAL);
    expect(sent[0]?.body.split('\n')).toHaveLength(3);
  });

  it('a reporter that cannot send never throws', async () => {
    const reporter = new SentryErrorReporter(
      'https://k@errors.example.org/1',
      'test',
      createLogger('silent'),
      () => Promise.reject(new Error('network down')),
    );
    await expect(reporter.report(nasty)).resolves.toBeUndefined();
  });
});
