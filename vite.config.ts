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
      '/gitea': {
        target: 'http://localhost:3000',
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
        target: process.env.GIGI_WS_URL || 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
