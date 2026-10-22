import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_NAME } from '@campuslink/shared';
import { previewSecurityHeaders } from './security-headers';
import { pureShared } from './pure-shared';

/** Same-origin API proxy. Sockets that close mid-flight (tab closed) are normal, not errors. */
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:4000',
    changeOrigin: false,
    ws: true,
    configure: (proxy: { on: (e: 'error', cb: (err: NodeJS.ErrnoException) => void) => void }) =>
      proxy.on('error', (err) => {
        if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') console.error('[proxy]', err.message);
      }),
  },
};

/** Preloads the UI face's Latin file, the one font every first screen needs (ADR 0008). */
const preloadUiFont = (): Plugin => ({
  name: 'preload-ui-font',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (_html, ctx) => {
      const file = Object.keys(ctx.bundle ?? {}).find((f) =>
        /\/geist-latin-wght-normal-[\w-]+\.woff2$/.test(f),
      );
      return file
        ? [
            {
              tag: 'link',
              attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${file}`, crossorigin: '' },
              injectTo: 'head',
            },
          ]
        : [];
    },
  },
});

export default defineConfig({
  plugins: [
    // The product name has one home (packages/shared/src/brand.ts); index.html uses %APP_NAME%.
    { name: 'app-name', transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', APP_NAME) },
    pureShared(),
    preloadUiFont(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // src/lib/pwa.ts registers the worker and shows the update prompt.
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: 'Guidance from your own college.',
        theme_color: '#0c0d12',
        background_color: '#0c0d12',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Fonts load by unicode-range on demand; only precache the subsets our locales use.
        // Anek Telugu's Latin files never load (Geist covers Latin first in every stack).
        globIgnores: [
          '**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese,latin-ext}-*.woff2',
          '**/anek-telugu-latin-*.woff2',
        ],
        navigateFallback: '/index.html',
        // Take control of the page on first install, so every screen chunk is available offline in
        // the very first session (audit ST-0). Updates still wait for the member's "Reload".
        clientsClaim: true,
        // API responses are never cached by the service worker; TanStack Query owns server state.
        navigateFallbackDenylist: [/^\/api\//],
        // Web push and notification clicks (public/push-sw.js).
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['.localhost'],
    // Same-origin API; the Host header is preserved; ws: Socket.io lives under /api/v1/realtime.
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    // The production CSP and friends (deploy/nginx), so the end-to-end suite runs under them.
    headers: previewSecurityHeaders(),
    allowedHosts: ['.localhost'],
    proxy: apiProxy,
  },
  build: {
    // Fonts are always files: the production CSP allows fonts from 'self' only, never data: URLs.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
    target: 'es2022',
    sourcemap: true,
    // The manifest feeds the bundle budget check (scripts/bundle-budget.mjs).
    manifest: true,
  },
});
