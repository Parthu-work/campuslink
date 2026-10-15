import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { createApp, type AppDeps } from '../src/app.js';

export function testApp(overrides: Partial<AppDeps> = {}) {
  const env = loadEnv({
    NODE_ENV: 'test',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://*.localhost:5173',
  });
  return createApp({ env, logger: createLogger('silent'), readiness: {}, ...overrides });
}
