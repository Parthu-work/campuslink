import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

/**
 * The re-audit (master prompt §12), kept out of the normal e2e run: its files end in `.audit.ts`,
 * which the main config does not match. Same servers, seed and Chromium as the e2e suite.
 */
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: /.*\.audit\.ts$/,
  globalSetup: '../global-setup.ts',
  retries: 0,
  reporter: 'line',
  projects: [{ name: 'audit', use: base.use ?? {} }],
});
