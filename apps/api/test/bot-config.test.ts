import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { MemoryMailProvider } from '../src/lib/mailer.js';
import { MemoryStorage } from '../src/lib/storage.js';
import { InlineJobQueue } from '../src/lib/jobs.js';
import { makeTenant } from './helpers.js';

const appWith = (extra: Record<string, string>) =>
  createApp({
    env: loadEnv({ NODE_ENV: 'test', HIBP_ENABLED: 'false', ...extra }),
    logger: createLogger('silent'),
    readiness: {},
    mailer: new MemoryMailProvider(),
    storage: new MemoryStorage(),
    jobs: new InlineJobQueue(),
    rateLimitScale: 1000,
  });

beforeAll(async () => {
  await makeTenant('botconfig');
});

describe('public bot-check config', () => {
  it('is null while bot protection is off', async () => {
    const r = await request(appWith({})).get('/api/v1/tenant').set('host', 'botconfig.localhost');
    expect(r.status).toBe(200);
    expect(r.body.data.botCheck).toBeNull();
  });

  it('carries only the public site key when Turnstile is on, never the secret', async () => {
    const secret = 'turnstile-secret-for-tests-only';
    const r = await request(
      appWith({
        BOT_PROTECTION: 'turnstile',
        TURNSTILE_SECRET: secret,
        TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      }),
    )
      .get('/api/v1/tenant')
      .set('host', 'botconfig.localhost');
    expect(r.body.data.botCheck).toEqual({ provider: 'turnstile', siteKey: '1x00000000000000000000AA' });
    expect(r.text).not.toContain(secret);
  });

  it('Turnstile needs both the secret and the site key', () => {
    expect(() => loadEnv({ BOT_PROTECTION: 'turnstile', TURNSTILE_SECRET: 's' })).toThrow(
      /TURNSTILE_SITE_KEY/,
    );
  });
});
