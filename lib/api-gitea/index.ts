/**
 * lib/api-gitea — Typed Gitea REST Client
 *
 * Centralized, Zod-validated HTTP client for all Gitea API interactions.
 *
 * Usage:
 *   import { createGiteaClient } from '../api-gitea'
 *   const gitea = createGiteaClient(baseUrl, token)
 */

export { createGiteaClient } from './client'
export type { GiteaClient, GiteaClientConfig } from './client'
export { GiteaApiError, GiteaNetworkError, GiteaParseError } from './errors'
export * from './schemas'
