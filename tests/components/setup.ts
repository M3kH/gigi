/**
 * Component test setup
 *
 * Initializes jsdom environment and @testing-library/jest-dom matchers
 * for Svelte component tests.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/svelte'
import { afterEach } from 'vitest'

// Auto-cleanup after each test to prevent DOM leaks
afterEach(() => {
  cleanup()
})
