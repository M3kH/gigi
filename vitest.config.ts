/**
 * Vitest Configuration
 *
 * Two test workspaces:
 *
 * 1. "unit" — Pure logic + UI tests. Uses happy-dom + MSW.
 *    No database, no external services. Fast, isolated.
 *    Run: `npm test` or `npm run test:unit`
 *
 * 2. "integration" — DB + HTTP tests. Uses createTestApp() with
 *    real PostgreSQL (gigi_test). Requires running database.
 *    Run: `npm run test:integration`
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/integration/**'],
          globals: true,
          environment: 'node',
          // Process isolation — some tests mutate process.env
          pool: 'forks',
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
