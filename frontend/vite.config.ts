import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'best-code-ide',
        short_name: 'CodeIDE',
        description: 'Mobile AI coding assistant — chat, edit, and push to GitHub from your iPhone.',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is cached for offline use; API calls always go to network.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: { cacheName: 'app-shell' },
          },
          {
            // esbuild's ~14MB wasm binary is fetched lazily (only when Preview is used),
            // then cached so it's available offline after the first run.
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'esbuild-wasm', expiration: { maxEntries: 2 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
