import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

/** Tailwind's default sizes sit off the type scale (audit DS-2, TY-3): use text-caption … text-hero. */
const OFF_SCALE_TEXT = {
  selector: 'Literal[value=/(^|[\\s:])text-(xs|sm|base|lg|[2-9]?xl)(\\s|$)/]',
  message: 'Use a type-scale token (text-caption, text-meta, text-body, text-lead, text-title, …).',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/dev-dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Bundle budget (master prompt §7d): these load lazily through one module each.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: [
      'apps/web/src/lib/toast.ts',
      'apps/web/src/lib/motion.ts',
      'apps/web/src/lib/motion-features.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'sonner', message: "Import toast from 'lib/toast' (loads sonner on first use)." },
            {
              name: 'motion/react',
              message: "Import from 'lib/motion' (LazyMotion; features load on demand).",
            },
          ],
        },
      ],
    },
  },
  {
    // Type comes from the scale (text-caption … text-hero) and page titles from PageHeader (audit
    // DS-1). The landing hero and story canvases size type to their own frames.
    files: ['apps/web/src/features/**/*.tsx'],
    ignores: ['apps/web/src/features/landing/**', 'apps/web/src/features/feed/story-viewer.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/text-\\[clamp\\(/]",
          message: 'Use a type-scale token (text-headline, text-display…) or <PageHeader>.',
        },
        OFF_SCALE_TEXT,
      ],
    },
  },
  {
    // The same scale everywhere else in the app (the landing hero and story canvases included).
    files: [
      'apps/web/src/components/**/*.tsx',
      'apps/web/src/app/**/*.tsx',
      'apps/web/src/features/landing/**/*.tsx',
      'apps/web/src/features/feed/story-viewer.tsx',
    ],
    rules: { 'no-restricted-syntax': ['error', OFF_SCALE_TEXT] },
  },
  {
    // Service-worker scripts run in the worker global scope.
    files: ['apps/web/public/**/*.js'],
    ignores: ['apps/web/public/boot.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // The pre-paint boot script runs in the page.
    files: ['apps/web/public/boot.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Tenancy guard rails (ADR 0002): raw driver access bypasses the tenant plugin.
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/db/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='mongoose'][callee.property.name='model']",
          message: 'Use defineTenantModel/definePlatformModel from db/models.ts.',
        },
        {
          selector: "MemberExpression[property.name='collection'][object.name=/Model$/]",
          message: 'Raw collection access bypasses tenant isolation.',
        },
        {
          selector: "MemberExpression[object.property.name='connection'][property.name='db']",
          message: 'Raw driver access bypasses tenant isolation.',
        },
        { selector: "CallExpression[callee.name='eval']", message: 'No eval.' },
      ],
    },
  },
  {
    files: ['**/test/**/*.ts', '**/*.test.ts', '**/e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'apps/*/scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
