/**
 * Git Mirror — Clone + Push mirror to a target remote
 *
 * For each repo:
 * 1. Clone --mirror from source Gitea
 * 2. Push --mirror to target remote
 * 3. Clean up temp directory
 *
 * Supports token auth and mTLS.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import https from 'node:https'
import type { MirrorTarget } from './config'
import type { RepoInfo } from './sources'

const execFileAsync = promisify(execFile)

export interface MirrorResult {
  repo: string
  success: boolean
  error?: string
  durationMs: number
}

export interface MirrorRunResult {
  startedAt: string
  completedAt: string
  target: string
  totalRepos: number
  succeeded: number
  failed: number
  results: MirrorResult[]
}

/**
 * Build the authenticated clone URL for the source Gitea.
 * Injects the token into the URL for git clone.
 */
const buildAuthUrl = (cloneUrl: string, token: string): string => {
  try {
    const url = new URL(cloneUrl)
    url.username = 'token'
    url.password = token
    return url.toString()
  } catch {
    // If URL parsing fails, try simple injection
    return cloneUrl.replace('://', `://token:${token}@`)
  }
}

/**
 * Build the target push URL with authentication.
 * For token auth, injects token. For mTLS, returns plain URL (git config handles auth).
 */
const buildTargetUrl = (target: MirrorTarget, owner: string, repoName: string): string => {
  const base = target.url.replace(/\/+$/, '')
  const repoUrl = `${base}/${owner}/${repoName}.git`

  if (target.auth === 'token' && target.token) {
    try {
      const url = new URL(repoUrl)
      url.username = 'token'
      url.password = target.token
      return url.toString()
    } catch {
      return repoUrl.replace('://', `://token:${target.token}@`)
    }
  }

  return repoUrl
}

/**
 * Read a certificate value — either inline PEM content or a file path.
 * If the value looks like a file path and the file exists, read it.
 * Otherwise, treat the value as inline PEM content.
 */
const readCertValue = async (value: string): Promise<string> => {
  const trimmed = value.trim()
  // If it starts with -----BEGIN, it's inline PEM
  if (trimmed.startsWith('-----BEGIN')) return trimmed
  // If it looks like a file path, try to read it
  if (trimmed.startsWith('/') || trimmed.startsWith('./')) {
    if (existsSync(trimmed)) {
      return readFile(trimmed, 'utf-8')
    }
  }
  // Fallback: treat as inline content
  return trimmed
}

/**
 * Build an HTTPS agent for fetch() calls.
 * For mTLS: loads client certs. For HTTPS targets: skips self-signed cert verification.
 * Returns undefined for plain HTTP targets.
 */
const buildHttpsAgent = async (target: MirrorTarget): Promise<https.Agent | undefined> => {
  if (!target.url.startsWith('https')) return undefined

  const agentOpts: https.AgentOptions = { rejectUnauthorized: false }

  if (target.auth === 'mtls') {
    try {
      if (target.cert) agentOpts.cert = await readCertValue(target.cert)
      if (target.key) agentOpts.key = await readCertValue(target.key)
      if (target.ca) {
        agentOpts.ca = await readCertValue(target.ca)
        agentOpts.rejectUnauthorized = true
      }
    } catch (err) {
      console.warn('[backup:mirror] failed to load mTLS certs for fetch:', err)
    }
  }

  return new https.Agent(agentOpts)
}

/**
 * Perform a fetch request with optional custom HTTPS agent.
 * Uses the undici dispatcher approach for Node.js fetch.
 */
const mtlsFetch = async (
  url: string,
  init: RequestInit & { dispatcher?: unknown },
  agent?: https.Agent,
): Promise<Response> => {
  if (!agent) return fetch(url, init)

  // Use the agent as undici dispatcher for Node.js fetch
  return fetch(url, { ...init, dispatcher: agent } as RequestInit)
}

/**
 * Ensure the target repo exists on the target Gitea.
 * Creates it via API if it doesn't exist.
 * Supports mTLS for HTTPS targets.
 */
const ensureTargetRepo = async (
  target: MirrorTarget,
  owner: string,
  repoName: string,
  description: string,
): Promise<void> => {
  if (!target.create_repos) return

  const apiToken = target.api_token || target.token
  if (!apiToken) return

  const baseUrl = target.url.replace(/\/+$/, '')
  const agent = await buildHttpsAgent(target)

  // Check if repo exists
  try {
    const checkUrl = `${baseUrl}/api/v1/repos/${owner}/${repoName}`
    const checkResp = await mtlsFetch(checkUrl, {
      headers: {
        Authorization: `token ${apiToken}`,
        Accept: 'application/json',
      },
    }, agent)

    if (checkResp.ok) return // Already exists
  } catch {
    // Can't check — try to create anyway
  }

  // Ensure org exists on target, then create repo under it
  try {
    // First, try to ensure the org exists
    await ensureTargetOrg(target, owner, agent)

    const createUrl = `${baseUrl}/api/v1/orgs/${owner}/repos`
    const resp = await mtlsFetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `token ${apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name: repoName,
        description: `[mirror] ${description}`,
        private: true,
        auto_init: false,
      }),
    }, agent)

    if (resp.ok) {
      console.log(`[backup:mirror] created target repo ${owner}/${repoName}`)
    } else if (resp.status === 409) {
      // Already exists — that's fine
    } else {
      const body = await resp.text().catch(() => '')
      console.warn(`[backup:mirror] failed to create target repo ${owner}/${repoName}: ${resp.status} ${body}`)
    }
  } catch (err) {
    console.warn(`[backup:mirror] failed to create target repo ${owner}/${repoName}:`, err)
  }
}

/**
 * Ensure the target org exists on the target Gitea.
 * Creates it if it doesn't exist. Silently ignores 409 (already exists).
 */
const ensureTargetOrg = async (
  target: MirrorTarget,
  orgName: string,
  agent?: https.Agent,
): Promise<void> => {
  const apiToken = target.api_token || target.token
  if (!apiToken) return

  const baseUrl = target.url.replace(/\/+$/, '')

  try {
    // Check if org already exists
    const checkResp = await mtlsFetch(`${baseUrl}/api/v1/orgs/${orgName}`, {
      headers: {
        Authorization: `token ${apiToken}`,
        Accept: 'application/json',
      },
    }, agent)

    if (checkResp.ok) return // Already exists
  } catch {
    // Can't check — try to create
  }

  try {
    const resp = await mtlsFetch(`${baseUrl}/api/v1/orgs`, {
      method: 'POST',
      headers: {
        Authorization: `token ${apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        username: orgName,
        full_name: orgName,
        visibility: 'private',
      }),
    }, agent)

    if (resp.ok) {
      console.log(`[backup:mirror] created target org "${orgName}"`)
    } else if (resp.status === 409 || resp.status === 422) {
      // Already exists — fine
    } else {
      const body = await resp.text().catch(() => '')
      console.warn(`[backup:mirror] failed to create target org "${orgName}": ${resp.status} ${body}`)
    }
  } catch (err) {
    console.warn(`[backup:mirror] failed to create target org "${orgName}":`, err)
  }
}

/**
 * Setup mTLS certificates for git operations and return git env vars.
 * Handles both file paths (pass through) and inline PEM (write to temp).
 */
const setupGitSslEnv = async (
  target: MirrorTarget,
  workDir: string,
): Promise<Record<string, string>> => {
  // For non-mTLS HTTPS targets, skip cert verification (self-signed certs)
  if (target.auth !== 'mtls') {
    return target.url.startsWith('https') ? { GIT_SSL_NO_VERIFY: 'true' } : {}
  }

  const env: Record<string, string> = {}

  // For each cert field: if it's a file path that exists, use it directly.
  // If it's inline PEM content, write to a temp file.
  if (target.cert) {
    const certContent = target.cert.trim()
    if (certContent.startsWith('/') && existsSync(certContent)) {
      env.GIT_SSL_CERT = certContent
    } else {
      const certPath = join(workDir, 'client-cert.pem')
      const content = await readCertValue(certContent)
      await writeFile(certPath, content)
      env.GIT_SSL_CERT = certPath
    }
  }

  if (target.key) {
    const keyContent = target.key.trim()
    if (keyContent.startsWith('/') && existsSync(keyContent)) {
      env.GIT_SSL_KEY = keyContent
    } else {
      const keyPath = join(workDir, 'client-key.pem')
      const content = await readCertValue(keyContent)
      await writeFile(keyPath, content)
      env.GIT_SSL_KEY = keyPath
    }
  }

  if (target.ca) {
    const caContent = target.ca.trim()
    if (caContent.startsWith('/') && existsSync(caContent)) {
      env.GIT_SSL_CAINFO = caContent
    } else {
      const caPath = join(workDir, 'ca-cert.pem')
      const content = await readCertValue(caContent)
      await writeFile(caPath, content)
      env.GIT_SSL_CAINFO = caPath
    }
  }

  return env
}

/**
 * Run a git command with optional extra env vars.
 */
const gitExec = async (
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>,
  timeoutMs = 120_000,
): Promise<{ stdout: string; stderr: string }> => {
  const env = { ...process.env, ...extraEnv }
  return execFileAsync('git', args, {
    cwd,
    env,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024, // 10MB
  })
}

/**
 * Mirror a single repo: clone --mirror from source, push --mirror to target.
 */
export const mirrorRepo = async (
  repo: RepoInfo,
  target: MirrorTarget,
  sourceToken: string,
): Promise<MirrorResult> => {
  const start = Date.now()
  let workDir: string | null = null

  try {
    // Create temp working directory
    workDir = await mkdtemp(join(tmpdir(), `gigi-mirror-${repo.name}-`))

    // Setup mTLS if needed
    const gitSslEnv = await setupGitSslEnv(target, workDir)

    // Ensure target repo exists
    await ensureTargetRepo(target, repo.owner, repo.name, repo.description)

    // Clone --mirror from source
    const sourceUrl = buildAuthUrl(repo.cloneUrl, sourceToken)
    const mirrorDir = join(workDir, `${repo.name}.git`)

    await gitExec(['clone', '--mirror', sourceUrl, mirrorDir], workDir, undefined, 300_000)

    // Push all refs except refs/pull/* (Gitea rejects pushes to PR refs)
    const targetUrl = buildTargetUrl(target, repo.owner, repo.name)

    await gitExec(
      ['push', '--force', targetUrl, 'refs/heads/*:refs/heads/*', 'refs/tags/*:refs/tags/*'],
      mirrorDir,
      gitSslEnv,
      300_000,
    )

    return {
      repo: repo.fullName,
      success: true,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      repo: repo.fullName,
      success: false,
      error: message,
      durationMs: Date.now() - start,
    }
  } finally {
    // Cleanup temp dir
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/**
 * Mirror all repos to a single target.
 * Runs mirrors sequentially to avoid overwhelming the target.
 */
export const mirrorAll = async (
  repos: RepoInfo[],
  target: MirrorTarget,
  sourceToken: string,
): Promise<MirrorRunResult> => {
  const startedAt = new Date().toISOString()
  const results: MirrorResult[] = []

  console.log(`[backup:mirror] starting mirror of ${repos.length} repos to "${target.name}"`)

  for (const repo of repos) {
    console.log(`[backup:mirror] mirroring ${repo.fullName}...`)
    const result = await mirrorRepo(repo, target, sourceToken)
    results.push(result)

    if (result.success) {
      console.log(`[backup:mirror] ✓ ${repo.fullName} (${result.durationMs}ms)`)
    } else {
      console.error(`[backup:mirror] ✗ ${repo.fullName}: ${result.error}`)
    }
  }

  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  console.log(`[backup:mirror] completed: ${succeeded} succeeded, ${failed} failed`)

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    target: target.name,
    totalRepos: repos.length,
    succeeded,
    failed,
    results,
  }
}
