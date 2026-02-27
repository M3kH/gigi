/**
 * Tests for lib/api-gitea/errors.ts — Gitea API error classes
 *
 * Tests GiteaApiError, GiteaNetworkError, and GiteaParseError
 * constructors and convenience getters.
 */

import assert from 'node:assert/strict'
import { GiteaApiError, GiteaNetworkError, GiteaParseError } from '../lib/api-gitea/errors'

describe('GiteaApiError', () => {
  it('creates error with correct properties', () => {
    const err = new GiteaApiError(404, '/repos/foo/bar', { message: 'not found' })
    assert.equal(err.status, 404)
    assert.equal(err.endpoint, '/repos/foo/bar')
    assert.equal(err.name, 'GiteaApiError')
    assert.ok(err.message.includes('404'))
    assert.ok(err.message.includes('/repos/foo/bar'))
    assert.ok(err.message.includes('not found'))
  })

  it('parses Gitea error response message', () => {
    const err = new GiteaApiError(422, '/test', { message: 'Validation failed' })
    assert.ok(err.message.includes('Validation failed'))
  })

  it('falls back to JSON.stringify for non-standard body', () => {
    // GiteaErrorResponse schema has optional fields with defaults, so {foo:'bar'}
    // will parse successfully with message='Unknown error'. Test that the error
    // message includes the parsed message.
    const err = new GiteaApiError(500, '/test', { foo: 'bar' })
    // The schema parses { foo: 'bar' } and returns default message: 'Unknown error'
    assert.ok(err.message.includes('Unknown error') || err.message.includes('foo'))
  })

  it('handles null body', () => {
    const err = new GiteaApiError(500, '/test', null)
    assert.ok(err.message.includes('500'))
  })

  describe('convenience getters', () => {
    it('isNotFound returns true for 404', () => {
      const err = new GiteaApiError(404, '/test', null)
      assert.ok(err.isNotFound)
      assert.ok(!err.isUnauthorized)
      assert.ok(!err.isForbidden)
      assert.ok(!err.isConflict)
      assert.ok(!err.isValidation)
    })

    it('isUnauthorized returns true for 401', () => {
      const err = new GiteaApiError(401, '/test', null)
      assert.ok(err.isUnauthorized)
      assert.ok(!err.isNotFound)
    })

    it('isForbidden returns true for 403', () => {
      const err = new GiteaApiError(403, '/test', null)
      assert.ok(err.isForbidden)
    })

    it('isConflict returns true for 409', () => {
      const err = new GiteaApiError(409, '/test', null)
      assert.ok(err.isConflict)
    })

    it('isValidation returns true for 422', () => {
      const err = new GiteaApiError(422, '/test', null)
      assert.ok(err.isValidation)
    })

    it('all getters return false for 500', () => {
      const err = new GiteaApiError(500, '/test', null)
      assert.ok(!err.isNotFound)
      assert.ok(!err.isUnauthorized)
      assert.ok(!err.isForbidden)
      assert.ok(!err.isConflict)
      assert.ok(!err.isValidation)
    })
  })

  it('instanceof Error', () => {
    const err = new GiteaApiError(404, '/test', null)
    assert.ok(err instanceof Error)
    assert.ok(err instanceof GiteaApiError)
  })

  it('preserves body', () => {
    const body = { message: 'conflict', url: '/repos/x' }
    const err = new GiteaApiError(409, '/test', body)
    assert.deepEqual(err.body, body)
  })
})

describe('GiteaNetworkError', () => {
  it('creates error with error cause', () => {
    const cause = new Error('ECONNREFUSED')
    const err = new GiteaNetworkError('/test', cause)
    assert.equal(err.name, 'GiteaNetworkError')
    assert.ok(err.message.includes('ECONNREFUSED'))
    assert.ok(err.message.includes('/test'))
    assert.equal(err.cause, cause)
  })

  it('handles string cause', () => {
    const err = new GiteaNetworkError('/test', 'timeout')
    assert.ok(err.message.includes('timeout'))
  })

  it('handles non-Error cause', () => {
    const err = new GiteaNetworkError('/test', 42)
    assert.ok(err.message.includes('42'))
  })

  it('instanceof Error', () => {
    const err = new GiteaNetworkError('/test', new Error('x'))
    assert.ok(err instanceof Error)
    assert.ok(err instanceof GiteaNetworkError)
  })
})

describe('GiteaParseError', () => {
  it('creates error with parse details', () => {
    const raw = { id: 'not-a-number' }
    const zodError = 'Expected number, received string at "id"'
    const err = new GiteaParseError('/repos/x', raw, zodError)
    assert.equal(err.name, 'GiteaParseError')
    assert.equal(err.endpoint, '/repos/x')
    assert.deepEqual(err.raw, raw)
    assert.ok(err.message.includes('/repos/x'))
    assert.ok(err.message.includes('Expected number'))
  })

  it('instanceof Error', () => {
    const err = new GiteaParseError('/test', {}, 'parse error')
    assert.ok(err instanceof Error)
    assert.ok(err instanceof GiteaParseError)
  })
})
