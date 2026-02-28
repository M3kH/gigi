/**
 * Vitest Configuration
 *
 * Three test workspaces:
 *
 * 1. "unit" — Pure logic + UI tests. Uses happy-dom + MSW.
 *    No database, no external services. Fast, isolated.
 *    Run: `npm test` or `npm run test:unit`
 *
 * 2. "component" — Svelte component tests. Uses jsdom + @testing-library/svelte.
 *    Renders real Svelte 5 components in a DOM environment.
 *    Run: `npm run test:components`
 *
 * 3. "integration" — DB + HTTP tests. Uses createTestApp() with
 *    real PostgreSQL (gigi_test). Requires running database.
 *    Run: `npm run test:integration`
 */
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/integration/**', 'tests/components/**'],
          globals: true,
          environment: 'node',
          // Process isolation — some tests mutate process.env
          pool: 'forks',
          coverage: {
            provider: 'v8',
            include: ['lib/**/*.ts', 'web/app/**/*.ts', 'web/app/**/*.svelte'],
            exclude: ['lib/**/*.d.ts', '**/node_modules/**'],
            thresholds: {
              // Minimum coverage gates — prevents regression
              // These are set ~3% above current baseline to enforce improvement
              lines: 40,
              branches: 31,
              functions: 35,
              statements: 40,
            },
          },
        },
      },
      {
        plugins: [svelte({ hot: false })],
        resolve: {
          // Force browser export conditions so Svelte resolves its client-side
          // module (mount, $state, etc.) instead of the SSR server module.
          conditions: ['browser'],
          alias: {
            '$lib': fileURLToPath(new URL('./web/app/lib', import.meta.url)),
            '$components': fileURLToPath(new URL('./web/app/components', import.meta.url)),
          },
        },
        test: {
          name: 'component',
          include: ['tests/components/**/*.test.ts'],
          globals: true,
          environment: 'jsdom',
          setupFiles: ['tests/components/setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.integration.test.ts'],
          globals: true,
          environment: 'node',
          pool: 'forks',
          poolOptions: {
            forks: {
              singleFork: true, // Sequential — DB tests need isolation
            },
          },
        },
      },
    ],
  },
})
