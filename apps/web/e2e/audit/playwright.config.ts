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
  // Journeys run without a test time limit; a step whose element is gone fails after 15 s (and is
  // recorded as that step's error) instead of waiting forever.
  projects: [{ name: 'audit', use: { ...base.use, actionTimeout: 15_000, navigationTimeout: 30_000 } }],
});
