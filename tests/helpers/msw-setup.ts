/**
 * MSW Setup — shared mock server for UI/unit tests
 *
 * Provides a pre-configured MSW server that mocks external services
 * (Gitea API, etc.) so unit tests never hit real endpoints.
 *
 * Usage in test files:
 *   import { mockServer } from './helpers/msw-setup'
 *   import { http, HttpResponse } from 'msw'
 *
 *   beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }))
 *   afterEach(() => mockServer.resetHandlers())
 *   afterAll(() => mockServer.close())
 *
 *   // Add test-specific handlers:
 *   mockServer.use(
 *     http.get('http://gitea:3000/api/v1/repos', () => {
 *       return HttpResponse.json([{ name: 'test-repo' }])
 *     })
 *   )
 *
 * For tests that need both MSW (external API mocking) and happy-dom
 * (DOM environment), add this comment at the top of the test file:
 *   // @vitest-environment happy-dom
 */
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

// Default handlers — return empty/safe responses for common endpoints
const defaultHandlers = [
  // Gitea: empty repos list
  http.get('*/api/v1/repos/search', () => {
    return HttpResponse.json({ data: [], ok: true })
  }),

  // Gitea: empty org repos
  http.get('*/api/v1/orgs/*/repos', () => {
    return HttpResponse.json([])
  }),

  // Gitea: user info
  http.get('*/api/v1/user', () => {
    return HttpResponse.json({ login: 'test-user', id: 1 })
  }),
]

export const mockServer = setupServer(...defaultHandlers)

// Re-export MSW utilities for convenience
export { http, HttpResponse }
