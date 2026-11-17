import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_NAME } from '@campuslink/shared';
import { previewSecurityHeaders } from './security-headers';
import { pureShared } from './pure-shared';
import { assetLinks } from './asset-links';
import { lucideIcons } from './lucide-icons';

/** Same-origin API proxy. Sockets that close mid-flight (tab closed) are normal, not errors. */
const apiProxy = {
  '/api': {
    // E2E runs set it when a dev server already holds port 4000 (playwright.config.ts).
    target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
    changeOrigin: false,
    ws: true,
    configure: (proxy: { on: (e: 'error', cb: (err: NodeJS.ErrnoException) => void) => void }) =>
      proxy.on('error', (err) => {
        if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') console.error('[proxy]', err.message);
      }),
  },
  // Prompt 2, G8: public pages are server-rendered by the API at /p/... (not the app's routes).
  '/p/': {
    target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
    changeOrigin: false,
  },
  // Prompt 2, G12: a college's credential pages and keys, served by the API at /{college}/... .
  '^/[a-z][a-z0-9-]{1,30}[a-z0-9]/(verify/[A-Za-z0-9_-]{22}(\\.jwt)?|did\\.json|credentials/status/1)$': {
    target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
    changeOrigin: false,
  },
};

/**
 * The app's files start from public/boot.js (prompt 3, U4): the build moves the entry, its module
 * preloads and the UI face's Latin file (the one font every first screen needs, ADR 0008) from
 * index.html onto boot.js's tag, and boot.js loads them at once, except under the landing's first
 * paint, where they wait for that paint so the stylesheet (and so the headline, which uses only the
 * display face) does not share a slow connection with them.
 */
const bootLoadsApp = (): Plugin => ({
  name: 'boot-loads-app',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html, ctx) => {
      const font = Object.keys(ctx.bundle ?? {}).find((f) =>
        /\/geist-latin-wght-normal-[\w-]+\.woff2$/.test(f),
      );
      if (!font) throw new Error('boot-loads-app: no Geist Latin file in the bundle');
      const entry = /<script type="module" crossorigin src="([^"]+)"><\/script>\s*/.exec(html);
      if (!entry?.[1]) throw new Error('boot-loads-app: no entry script in index.html');
      const preloads: string[] = [];
      const out = html
        .replace(entry[0], '')
        .replace(/<link rel="modulepreload" crossorigin href="([^"]+)">\s*/g, (_tag, href: string) => {
          preloads.push(href);
          return '';
        })
        .replace(
          '<script src="/boot.js"></script>',
          `<script src="/boot.js" data-entry="${entry[1]}" data-preload="${preloads.join(' ')}" data-font="/${font}"></script>`,
        );
      if (!out.includes('data-entry=')) throw new Error('boot-loads-app: no boot.js tag in index.html');
      return out;
    },
  },
});

export default defineConfig({
  plugins: [
    // The product name has one home (packages/shared/src/brand.ts); index.html uses %APP_NAME%.
    { name: 'app-name', transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', APP_NAME) },
    pureShared(),
    // Android app links (prompt 2, G9): /.well-known/assetlinks.json when the build is told the app.
    assetLinks(),
    bootLoadsApp(),
    lucideIcons(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // src/lib/pwa.ts registers the worker and shows the update prompt.
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      // Each college has its own manifest (name, colours, logo), served by the API and linked from
      // index.html (audit PW-3, decision 7), so the plugin generates none.
      manifest: false,
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
