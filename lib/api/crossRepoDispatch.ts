/**
 * Cross-Repo Workflow Dispatch
 *
 * Triggers CI/CD workflows in gigi-infra when code changes land in other repos.
 * This decouples the gigi app repo from deployment — gigi-infra owns all CI/CD.
 *
 * Flow: gigi push (main) → webhook → dispatch gigi-infra build-gigi.yml
 */

import { getConfig } from '../core/store'

const getOrg = () => process.env.GITEA_ORG || 'acme'

interface DispatchConfig {
  /** Source repo name that triggers the dispatch */
  sourceRepo: string
  /** Target ref that must match (e.g. "refs/heads/main") */
  sourceRef: string
  /** Target repo owner/org */
  targetOwner: string
  /** Target repo name */
  targetRepo: string
  /** Workflow filename to dispatch */
  workflowFile: string
  /** Optional inputs to pass to the workflow */
  inputs?: Record<string, string>
}

/**
 * Registry of cross-repo triggers.
 * When a push matches sourceRepo + sourceRef, dispatch the target workflow.
 */
const getDispatchRules = (): DispatchConfig[] => [
  {
    sourceRepo: 'gigi',
    sourceRef: 'refs/heads/main',
    targetOwner: getOrg(),
    targetRepo: 'gigi-infra',
    workflowFile: 'build-gigi.yml',
  },
]

/**
 * Check if a push event should trigger any cross-repo workflow dispatches.
 * Call this from the webhook handler on push events.
 */
export const handlePushDispatch = async (
  repoName: string,
  ref: string,
  headSha?: string
): Promise<void> => {
  const matchingRules = getDispatchRules().filter(
    (r) => r.sourceRepo === repoName && r.sourceRef === ref
  )

  if (!matchingRules.length) return

  for (const rule of matchingRules) {
    try {
      const inputs = { ...rule.inputs }
      if (headSha) inputs.sha = headSha

      await dispatchWorkflow(rule.targetOwner, rule.targetRepo, rule.workflowFile, inputs)
      console.log(
        `[crossRepoDispatch] Dispatched ${rule.targetRepo}/${rule.workflowFile} ` +
        `(triggered by ${repoName} push to ${ref})`
      )
    } catch (err) {
      console.error(
        `[crossRepoDispatch] Failed to dispatch ${rule.targetRepo}/${rule.workflowFile}:`,
        (err as Error).message
      )
    }
  }
}

/**
 * Dispatch a Gitea Actions workflow via the API.
 * Uses workflow_dispatch event type.
 */
const dispatchWorkflow = async (
  owner: string,
  repo: string,
  workflowFile: string,
  inputs: Record<string, string> = {}
): Promise<void> => {
  const token = await getConfig('gitea_token')
  if (!token) throw new Error('No gitea_token configured')

  // Gitea API: POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches
  const giteaUrl = process.env.GITEA_URL || 'http://localhost:3300'
  const url = `${giteaUrl}/api/v1/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gitea API ${res.status}: ${body}`)
  }
}
