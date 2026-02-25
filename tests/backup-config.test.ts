/**
 * Tests for backup config loader: env var interpolation, YAML parsing, validation.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { interpolateEnvVars, parseSimpleYaml, loadBackupConfig } from '../lib/backup/config'
import { parseInterval } from '../lib/backup/scheduler'
import { writeFile, unlink } from 'node:fs/promises'

// ── Env Var Interpolation ───────────────────────────────────────────

describe('interpolateEnvVars', () => {
  beforeEach(() => {
    process.env.TEST_VAR = 'hello'
    process.env.TEST_URL = 'https://backup.example.com'
  })

  afterEach(() => {
    delete process.env.TEST_VAR
    delete process.env.TEST_URL
  })

  it('replaces ${VAR} with env value', () => {
    assert.equal(interpolateEnvVars('url: ${TEST_VAR}'), 'url: hello')
  })

  it('replaces multiple vars in one string', () => {
    const result = interpolateEnvVars('${TEST_VAR} at ${TEST_URL}')
    assert.equal(result, 'hello at https://backup.example.com')
  })

  it('uses default value when var is not set', () => {
    const result = interpolateEnvVars('${MISSING_VAR:-fallback}')
    assert.equal(result, 'fallback')
  })

  it('prefers env value over default', () => {
    const result = interpolateEnvVars('${TEST_VAR:-fallback}')
    assert.equal(result, 'hello')
  })

  it('returns empty string for missing var without default', () => {
    const result = interpolateEnvVars('${TOTALLY_MISSING}')
    assert.equal(result, '')
  })

  it('handles default with colons in value', () => {
    const result = interpolateEnvVars('${MISSING:-https://example.com:8080}')
    assert.equal(result, 'https://example.com:8080')
  })
})

// ── YAML Parser ─────────────────────────────────────────────────────

describe('parseSimpleYaml', () => {
  it('parses nested objects', () => {
    const yaml = `
backup:
  schedule:
    interval: 6h
    before_deploy: true
`
    const result = parseSimpleYaml(yaml)
    assert.deepEqual(result, {
      backup: {
        schedule: {
          interval: '6h',
          before_deploy: true,
        },
      },
    })
  })

  it('parses arrays of objects', () => {
    const yaml = `
backup:
  sources:
    - org: idea
  targets:
    - type: git-mirror
      name: backup
      url: https://example.com
      auth: token
`
    const result = parseSimpleYaml(yaml) as any
    assert.equal(result.backup.sources.length, 1)
    assert.equal(result.backup.sources[0].org, 'idea')
    assert.equal(result.backup.targets.length, 1)
    assert.equal(result.backup.targets[0].type, 'git-mirror')
    assert.equal(result.backup.targets[0].name, 'backup')
  })

  it('ignores comments', () => {
    const yaml = `
# This is a comment
backup:
  sources:
    - org: idea  # inline comment
`
    const result = parseSimpleYaml(yaml) as any
    assert.equal(result.backup.sources[0].org, 'idea')
  })

  it('handles quoted strings', () => {
    const yaml = `
name: "hello world"
other: 'single quoted'
`
    const result = parseSimpleYaml(yaml)
    assert.equal(result.name, 'hello world')
    assert.equal(result.other, 'single quoted')
  })

  it('parses booleans and numbers', () => {
    const yaml = `
enabled: true
disabled: false
count: 42
`
    const result = parseSimpleYaml(yaml)
    assert.equal(result.enabled, true)
    assert.equal(result.disabled, false)
    assert.equal(result.count, 42)
  })
})

// ── Interval Parsing ────────────────────────────────────────────────

describe('parseInterval', () => {
  it('parses seconds', () => {
    assert.equal(parseInterval('30s'), 30_000)
  })

  it('parses minutes', () => {
    assert.equal(parseInterval('5m'), 300_000)
  })

  it('parses hours', () => {
    assert.equal(parseInterval('6h'), 21_600_000)
  })

  it('parses days', () => {
    assert.equal(parseInterval('1d'), 86_400_000)
  })

  it('defaults to 6h for invalid input', () => {
    assert.equal(parseInterval('invalid'), 21_600_000)
  })
})

// ── Config Loading (integration) ────────────────────────────────────

describe('loadBackupConfig', () => {
  const testConfigPath = '/tmp/gigi-test-config.yaml'

  afterEach(async () => {
    await unlink(testConfigPath).catch(() => {})
    delete process.env.TEST_BACKUP_URL
    delete process.env.TEST_BACKUP_TOKEN
  })

  it('loads a valid config file', async () => {
    process.env.TEST_BACKUP_URL = 'https://backup.example.com'
    process.env.TEST_BACKUP_TOKEN = 'secret123'

    const yaml = `
backup:
  sources:
    - org: idea
  targets:
    - type: git-mirror
      name: test-backup
      url: \${TEST_BACKUP_URL}
      auth: token
      token: \${TEST_BACKUP_TOKEN}
  schedule:
    interval: 1h
    before_deploy: true
`
    await writeFile(testConfigPath, yaml)

    const config = await loadBackupConfig(testConfigPath)
    assert.ok(config, 'config should not be null')
    assert.equal(config!.sources.length, 1)
    assert.equal(config!.targets.length, 1)
    assert.equal(config!.targets[0].url, 'https://backup.example.com')
    assert.equal(config!.targets[0].token, 'secret123')
    assert.equal(config!.schedule.interval, '1h')
    assert.equal(config!.schedule.before_deploy, true)
  })

  it('returns null for missing config file', async () => {
    const config = await loadBackupConfig('/tmp/nonexistent-gigi-config.yaml')
    assert.equal(config, null)
  })

  it('returns null for invalid config', async () => {
    await writeFile(testConfigPath, 'not: valid: backup: config')

    const config = await loadBackupConfig(testConfigPath)
    assert.equal(config, null)
  })
})
