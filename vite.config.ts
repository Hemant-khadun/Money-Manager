import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

// Relative base + hash routing = works on GitHub Pages project sites (/<repo>/),
// custom domains, and any other static host without rewrite rules.
export default defineConfig({
  base: './',
  // Shown in the problem report (#/debug), to tell which version a phone is running.
  define: {
    __APP_VERSION__: JSON.stringify(`${process.env.GITHUB_SHA?.slice(0, 7) ?? 'local'}, built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`),
  },
  // "@/..." is how shadcn/ui and 21st.dev components import each other (see components.json).
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Money Manager',
        short_name: 'Money Manager',
        description: 'Snap your receipts. See where your money goes, month by month.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F6F6F8',
        theme_color: '#F6F6F8',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is precached; OCR models + the ONNX runtime are cached on first scan instead.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Only the Latin Inter files: the Cyrillic, Greek and Vietnamese ones are never shown.
        globIgnores: ['**/models/**', '**/*.wasm', '**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/models/') || url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets',
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  // onnxruntime-web locates its .wasm via import.meta.url; pre-bundling breaks that in dev.
  optimizeDeps: { exclude: ['onnxruntime-web', 'ppu-paddle-ocr'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
