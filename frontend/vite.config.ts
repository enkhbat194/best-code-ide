import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const releaseBranch = (process.env.WORKERS_CI_BRANCH ?? process.env.GITHUB_REF_NAME ?? 'local')
  .replace(/^refs\/heads\//, '')
const releaseSha = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'unknown'
const releaseBuildId = process.env.WORKERS_CI_BUILD_UUID ?? process.env.GITHUB_RUN_ID ?? 'local'
const releaseEnvironment = process.env.WORKERS_CI
  ? 'cloudflare-workers-builds'
  : process.env.GITHUB_ACTIONS
    ? 'github-actions'
    : 'local'
const releaseCacheKey = releaseSha === 'unknown' ? releaseBuildId : releaseSha.slice(0, 12)

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BESTCODE_RELEASE__: JSON.stringify({
      app: 'best-code-ide',
      branch: releaseBranch,
      sha: releaseSha,
      buildId: releaseBuildId,
      environment: releaseEnvironment,
      builtAt: new Date().toISOString(),
    }),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'best-code-ide',
        short_name: 'CodeIDE',
        description: 'Private mobile-first Personal Creation OS with governed AI, evidence, and safe delivery.',
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
        cleanupOutdatedCaches: true,
        // App shell is cached for offline use; API calls always go to network.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: `app-shell-${releaseCacheKey}`,
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 10 },
            },
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
