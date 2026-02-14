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
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
