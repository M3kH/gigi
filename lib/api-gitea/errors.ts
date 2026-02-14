/**
 * Gitea API — Typed Errors
 *
 * Structured error types for API failures.
 */

import { GiteaErrorResponse } from './schemas'

export class GiteaApiError extends Error {
  readonly status: number
  readonly endpoint: string
  readonly body: unknown

  constructor(status: number, endpoint: string, body: unknown) {
    const parsed = GiteaErrorResponse.safeParse(body)
    const msg = parsed.success ? parsed.data.message : JSON.stringify(body)
    super(`Gitea API ${status} on ${endpoint}: ${msg}`)
    this.name = 'GiteaApiError'
    this.status = status
    this.endpoint = endpoint
    this.body = body
  }

  get isNotFound(): boolean { return this.status === 404 }
  get isUnauthorized(): boolean { return this.status === 401 }
  get isForbidden(): boolean { return this.status === 403 }
  get isConflict(): boolean { return this.status === 409 }
  get isValidation(): boolean { return this.status === 422 }
}

export class GiteaNetworkError extends Error {
  readonly cause: unknown

  constructor(endpoint: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause)
    super(`Gitea network error on ${endpoint}: ${msg}`)
    this.name = 'GiteaNetworkError'
    this.cause = cause
  }
}

export class GiteaParseError extends Error {
  readonly endpoint: string
  readonly raw: unknown

  constructor(endpoint: string, raw: unknown, zodError: unknown) {
    super(`Gitea parse error on ${endpoint}: ${zodError}`)
    this.name = 'GiteaParseError'
    this.endpoint = endpoint
    this.raw = raw
  }
}
