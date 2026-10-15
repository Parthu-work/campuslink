import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'CampusLink',
        short_name: 'CampusLink',
        description: 'Guidance from your own college.',
        theme_color: '#070a14',
        background_color: '#070a14',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Fonts load by unicode-range on demand; only precache the subsets our locales use.
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese,latin-ext}-*.woff2'],
        navigateFallback: '/index.html',
        // API responses are never cached by the service worker; TanStack Query owns server state.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['.localhost'],
    // Same-origin API: the Host header (e.g. dpit.localhost:5173) is preserved so the API resolves the tenant.
    proxy: { '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false } },
  },
  preview: {
    port: 4173,
    allowedHosts: ['.localhost'],
    proxy: { '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: true },
});
