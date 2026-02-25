import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('./web/app', import.meta.url)),
  plugins: [svelte()],
  build: {
    outDir: fileURLToPath(new URL('./dist/app', import.meta.url)),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '$lib': fileURLToPath(new URL('./web/app/lib', import.meta.url)),
      '$components': fileURLToPath(new URL('./web/app/components', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Gitea assets: direct to Gitea (no auth/rewriting needed, avoids
      // Parse Error from backend response streaming).
      '/gitea/assets': {
        target: 'http://localhost:3300',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/gitea/, ''),
      },
      // Gitea pages: proxy through Gigi backend which handles auth
      // (X-WEBAUTH-USER), HTML rewriting, and theme injection.
      '/gitea': {
        target: process.env.GIGI_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api': {
        // Proxy to the live Gigi app running on the cluster
        // Falls back to localhost:3000 if GIGI_API_URL env var not set
        target: process.env.GIGI_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.GIGI_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.GIGI_WS_URL || 'ws://localhost:3000',
        ws: true,
      },
      '/browser': {
        target: 'http://localhost:6080',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/browser/, ''),
        ws: true,
      },
      '/cdp': {
        target: 'http://localhost:9223',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/cdp/, ''),
        ws: true,
      },
    },
  },
})
