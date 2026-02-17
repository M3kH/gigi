/**
 * Backup Sources — Resolve which repos to back up
 *
 * v1: org source (list all repos in a Gitea org).
 * Future: repo, match (glob pattern).
 */

import type { BackupSource } from './config'
import { createGiteaClient, type GiteaClient } from '../api-gitea/client'

export interface RepoInfo {
  owner: string
  name: string
  cloneUrl: string
  description: string
  /** Full name like "idea/gigi" */
  fullName: string
}

/**
 * Resolve all repos for the given backup sources.
 * Uses the local Gitea API to enumerate repos.
 */
export const resolveRepos = async (
  sources: BackupSource[],
  giteaUrl: string,
  giteaToken: string,
): Promise<RepoInfo[]> => {
  const gitea = createGiteaClient(giteaUrl, giteaToken)
  const baseCloneUrl = giteaUrl.replace(/\/+$/, '')
  const allRepos: RepoInfo[] = []
  const seen = new Set<string>()

  for (const source of sources) {
    let repos: RepoInfo[]

    if ('org' in source) {
      repos = await resolveOrgSource(gitea, source.org, baseCloneUrl)
    } else if ('repo' in source) {
      repos = await resolveRepoSource(gitea, source.repo, baseCloneUrl)
    } else if ('match' in source) {
      // v2: glob pattern matching
      console.warn(`[backup:sources] 'match' source not yet implemented: ${source.match}`)
      repos = []
    } else {
      repos = []
    }

    for (const repo of repos) {
      if (!seen.has(repo.fullName)) {
        seen.add(repo.fullName)
        allRepos.push(repo)
      }
    }
  }

  return allRepos
}

/**
 * List all repos in a Gitea org, paginating through all results.
 */
const resolveOrgSource = async (gitea: GiteaClient, orgName: string, baseCloneUrl: string): Promise<RepoInfo[]> => {
  const repos: RepoInfo[] = []
  let page = 1
  const limit = 50

  while (true) {
    const batch = await gitea.orgs.listRepos(orgName, { limit, page })

    for (const repo of batch) {
      repos.push({
        owner: orgName,
        name: repo.name,
        cloneUrl: `${baseCloneUrl}/${orgName}/${repo.name}.git`,
        description: repo.description || '',
        fullName: `${orgName}/${repo.name}`,
      })
    }

    if (batch.length < limit) break
    page++
  }

  return repos
}

/**
 * Resolve a single repo source like "idea/gigi".
 */
const resolveRepoSource = async (gitea: GiteaClient, repoSpec: string, baseCloneUrl: string): Promise<RepoInfo[]> => {
  const [owner, name] = repoSpec.split('/')
  if (!owner || !name) {
    console.warn(`[backup:sources] invalid repo spec: ${repoSpec} (expected "owner/name")`)
    return []
  }

  try {
    const repo = await gitea.repos.get(owner, name)
    return [{
      owner,
      name: repo.name,
      cloneUrl: `${baseCloneUrl}/${owner}/${repo.name}.git`,
      description: repo.description || '',
      fullName: `${owner}/${repo.name}`,
    }]
  } catch (err) {
    console.error(`[backup:sources] failed to resolve repo ${repoSpec}:`, err)
    return []
  }
}
