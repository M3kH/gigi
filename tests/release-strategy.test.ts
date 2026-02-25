/**
 * Release Strategy Tests
 *
 * Validates that release-related files are present, consistent,
 * and properly structured.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

function readFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf-8')
}

// ─── Package.json ──────────────────────────────────────────────────

describe('package.json release readiness', () => {
  const pkg = JSON.parse(readFile('package.json'))

  it('has semver-compliant version', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'version must be semver (X.Y.Z)')
  })

  it('has version 0.1.0 for initial release', () => {
    assert.equal(pkg.version, '0.1.0')
  })

  it('has correct AGPL-3.0 license identifier', () => {
    assert.equal(pkg.license, 'AGPL-3.0-only', 'license must match SPDX identifier for AGPL-3.0')
  })

  it('has a description', () => {
    assert.ok(pkg.description?.length > 0, 'description must not be empty')
  })

  it('requires Node.js >= 20', () => {
    assert.ok(pkg.engines?.node, 'engines.node must be defined')
    assert.match(pkg.engines.node, /20/, 'must require Node.js 20+')
  })

  it('has essential scripts', () => {
    assert.ok(pkg.scripts.start, 'must have start script')
    assert.ok(pkg.scripts.test, 'must have test script')
    assert.ok(pkg.scripts.build, 'must have build script')
  })
})

// ─── CHANGELOG.md ──────────────────────────────────────────────────

describe('CHANGELOG.md', () => {
  const changelog = readFile('CHANGELOG.md')

  it('exists and is non-empty', () => {
    assert.ok(changelog.length > 0)
  })

  it('follows Keep a Changelog format', () => {
    assert.ok(changelog.includes('Keep a Changelog'), 'must reference Keep a Changelog')
    assert.ok(changelog.includes('Semantic Versioning'), 'must reference Semantic Versioning')
  })

  it('has an Unreleased section', () => {
    assert.ok(changelog.includes('## [Unreleased]'), 'must have [Unreleased] section')
  })

  it('has a v0.1.0 entry', () => {
    assert.ok(changelog.includes('## [0.1.0]'), 'must have [0.1.0] section')
  })

  it('v0.1.0 entry has Added subsection', () => {
    const v010Index = changelog.indexOf('## [0.1.0]')
    const afterV010 = changelog.slice(v010Index)
    assert.ok(afterV010.includes('### Added'), 'v0.1.0 must have ### Added subsection')
  })
})

// ─── LICENSE ────────────────────────────────────────────────────────

describe('LICENSE file', () => {
  it('exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'LICENSE')), 'LICENSE file must exist')
  })

  it('is AGPL-3.0', () => {
    const license = readFile('LICENSE')
    assert.ok(
      license.includes('GNU Affero General Public License'),
      'LICENSE must be AGPL-3.0'
    )
  })
})

// ─── CONTRIBUTING.md ────────────────────────────────────────────────

describe('CONTRIBUTING.md', () => {
  const contributing = readFile('CONTRIBUTING.md')

  it('exists and is non-empty', () => {
    assert.ok(contributing.length > 0)
  })

  it('mentions CLA', () => {
    assert.ok(
      contributing.includes('Contributor License Agreement'),
      'must mention CLA for dual-licensing'
    )
  })

  it('has development setup instructions', () => {
    assert.ok(contributing.includes('npm install'), 'must include npm install step')
    assert.ok(contributing.includes('npm run dev') || contributing.includes('npm start'),
      'must include how to run the project')
  })

  it('has PR guidelines', () => {
    assert.ok(contributing.includes('Pull Request'), 'must have PR guidelines')
  })
})

// ─── SECURITY.md ────────────────────────────────────────────────────

describe('SECURITY.md', () => {
  it('exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'SECURITY.md')), 'SECURITY.md must exist')
  })

  const security = readFile('SECURITY.md')

  it('has vulnerability reporting instructions', () => {
    assert.ok(security.includes('Reporting a Vulnerability'), 'must explain how to report vulnerabilities')
  })

  it('warns against public disclosure', () => {
    assert.ok(
      security.includes('Do NOT open a public issue'),
      'must warn against public vulnerability disclosure'
    )
  })

  it('has supported versions table', () => {
    assert.ok(security.includes('Supported Versions'), 'must list supported versions')
  })
})

// ─── Release strategy documentation ─────────────────────────────────

describe('docs/RELEASE.md', () => {
  it('exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'docs/RELEASE.md')), 'docs/RELEASE.md must exist')
  })

  const release = readFile('docs/RELEASE.md')

  it('documents semver versioning', () => {
    assert.ok(release.includes('Semantic Versioning'), 'must reference semver')
  })

  it('documents conventional commits', () => {
    assert.ok(release.includes('Conventional Commits'), 'must reference conventional commits')
  })

  it('documents release process', () => {
    assert.ok(release.includes('Release Process') || release.includes('Release Workflow'),
      'must have release process section')
  })

  it('documents Docker deployment', () => {
    assert.ok(release.includes('Docker'), 'must reference Docker for deployment')
  })

  it('documents changelog maintenance', () => {
    assert.ok(release.includes('CHANGELOG'), 'must reference changelog')
  })
})

// ─── Issue and PR templates ─────────────────────────────────────────

describe('issue and PR templates', () => {
  it('has bug report template', () => {
    assert.ok(
      existsSync(resolve(ROOT, '.github/ISSUE_TEMPLATE/bug_report.md')),
      'bug report template must exist'
    )
  })

  it('has feature request template', () => {
    assert.ok(
      existsSync(resolve(ROOT, '.github/ISSUE_TEMPLATE/feature_request.md')),
      'feature request template must exist'
    )
  })

  it('has PR template', () => {
    assert.ok(
      existsSync(resolve(ROOT, '.github/PULL_REQUEST_TEMPLATE.md')),
      'PR template must exist'
    )
  })

  it('bug report template has required sections', () => {
    const template = readFile('.github/ISSUE_TEMPLATE/bug_report.md')
    assert.ok(template.includes('Steps to Reproduce'), 'must have reproduction steps')
    assert.ok(template.includes('Expected Behavior'), 'must have expected behavior')
    assert.ok(template.includes('Environment'), 'must have environment section')
  })

  it('feature request template has required sections', () => {
    const template = readFile('.github/ISSUE_TEMPLATE/feature_request.md')
    assert.ok(template.includes('Motivation'), 'must have motivation section')
  })

  it('PR template has checklist', () => {
    const template = readFile('.github/PULL_REQUEST_TEMPLATE.md')
    assert.ok(template.includes('- [ ]'), 'must have checklist items')
    assert.ok(template.includes('Test'), 'must mention testing')
  })

  it('templates use correct label frontmatter', () => {
    const bugTemplate = readFile('.github/ISSUE_TEMPLATE/bug_report.md')
    assert.ok(bugTemplate.includes('labels: type/bug'), 'bug template must set type/bug label')

    const featureTemplate = readFile('.github/ISSUE_TEMPLATE/feature_request.md')
    assert.ok(featureTemplate.includes('labels: type/feature'), 'feature template must set type/feature label')
  })
})
