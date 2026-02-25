/**
 * README Security Documentation Tests
 *
 * Validates that the README contains required security warnings and guidance.
 * These tests act as a guardrail — if someone accidentally removes
 * the security notices, CI will catch it.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const README = readFileSync(
  resolve(import.meta.dirname, '../README.md'),
  'utf-8',
)

describe('README security warnings', () => {
  it('should contain a top-level CAUTION banner', () => {
    assert.ok(
      README.includes('[!CAUTION]'),
      'README must have a [!CAUTION] alert block near the top',
    )
  })

  it('should warn about unrestricted shell access', () => {
    assert.ok(
      README.includes('dangerouslySkipPermissions'),
      'README must mention dangerouslySkipPermissions to warn users about full shell access',
    )
  })

  it('should warn about pre-authenticated Gitea', () => {
    assert.ok(
      README.includes('automatic web authentication') ||
        README.includes('X-WEBAUTH-USER'),
      'README must warn that Gitea has no login screen',
    )
  })

  it('should warn against public internet exposure', () => {
    assert.ok(
      README.includes('Never expose Gigi to the public internet') ||
        README.includes('never expose Gigi to the public internet'),
      'README must explicitly tell users not to expose Gigi publicly',
    )
  })

  it('should have a dedicated Security section', () => {
    assert.ok(
      README.includes('## Security'),
      'README must have a ## Security section',
    )
  })

  it('should link to the Security section from the nav', () => {
    assert.ok(
      README.includes('href="#security"'),
      'README nav bar must include a link to the Security section',
    )
  })

  it('should recommend localhost or private network binding', () => {
    assert.ok(
      README.includes('localhost') && README.includes('private network'),
      'README must recommend binding to localhost or a private network',
    )
  })

  it('should mention VPN as a remote access option', () => {
    assert.ok(
      README.includes('VPN'),
      'README must suggest VPN for remote access',
    )
  })

  it('should warn about credentials in database', () => {
    assert.ok(
      README.includes('Credentials in database') ||
        README.includes('credentials') ||
        README.includes('tokens are stored'),
      'README must warn that API tokens are stored in the database',
    )
  })

  it('should include a security notice in the Quickstart section', () => {
    // The quickstart should not let users skip past the warning
    const quickstartIdx = README.indexOf('## Quickstart')
    assert.ok(quickstartIdx !== -1, 'README must have a ## Quickstart section')
    // Find the next ## section after Quickstart
    const nextSectionIdx = README.indexOf('\n## ', quickstartIdx + 1)
    const quickstartSection = nextSectionIdx === -1
      ? README.slice(quickstartIdx)
      : README.slice(quickstartIdx, nextSectionIdx)

    assert.ok(
      quickstartSection.includes('[!IMPORTANT]') ||
        quickstartSection.includes('[!CAUTION]') ||
        quickstartSection.includes('[!WARNING]'),
      'Quickstart section must include a security notice',
    )
  })
})

describe('README security recommendations', () => {
  it('should have a recommendations subsection', () => {
    assert.ok(
      README.includes('### Recommendations'),
      'Security section must include a Recommendations subsection',
    )
  })

  it('should mention Docker isolation', () => {
    assert.ok(
      README.includes('Docker') && README.includes('network isolation'),
      'Recommendations must mention Docker network isolation',
    )
  })

  it('should mention database access restriction', () => {
    assert.ok(
      README.includes('Restrict database access') ||
        README.includes('database access'),
      'Recommendations must mention restricting database access',
    )
  })

  it('should provide guidance for reporting vulnerabilities', () => {
    assert.ok(
      README.includes('Reporting vulnerabilities') ||
        README.includes('security issue'),
      'Security section must include vulnerability reporting guidance',
    )
  })
})
