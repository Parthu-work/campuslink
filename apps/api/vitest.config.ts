import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/scripts/**', 'src/**/*.d.ts'],
      thresholds: {
        // Security-critical modules (section 13): at least 80%.
        'src/db/**': { statements: 80, branches: 75 },
        'src/http/**': { statements: 80, branches: 70 },
        'src/lib/**': { statements: 80, branches: 70 },
        'src/modules/auth/**': { statements: 80, branches: 70 },
      },
    },
  },
});
