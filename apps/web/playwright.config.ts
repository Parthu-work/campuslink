import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real stack: seeded MongoDB → API → `vite preview` (which proxies /api).
 * Requires MongoDB on MONGODB_URI (docker compose locally, a service container in CI).
 * Tenants are subdomains of localhost; Chromium maps *.localhost to 127.0.0.1.
 */
const chromium = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
const launchOptions = { ...chromium, args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'] };
const mongo = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/campuslink_e2e?directConnection=true';
const apiEnv = `NODE_ENV=test LOG_LEVEL=warn MAIL_DRIVER=smtp INGESTION_ENABLED=false RATE_LIMIT_SCALE=50 HIBP_ENABLED=false SMS_PROVIDER=console WHATSAPP_PROVIDER=console MONGODB_URI='${mongo}' WEB_ORIGIN=http://localhost:4173 CORS_ALLOWED_ORIGINS='http://*.localhost:4173'`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI keeps an HTML report (uploaded on failure) next to the line-per-test output.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://dpit.localhost:4173', trace: 'on-first-retry', launchOptions },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
  ],
  webServer: [
    {
      command: `${apiEnv} pnpm --filter @campuslink/api exec tsx src/server.ts`,
      url: 'http://127.0.0.1:4000/api/v1/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm build && pnpm preview',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
