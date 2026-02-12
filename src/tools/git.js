import { runBash } from './bash.js'
import { getConfig } from '../store.js'

let credentialsConfigured = false

const ensureGitConfig = async () => {
  if (credentialsConfigured) return

  // Set identity
  await runBash({ command: 'git config --global user.name "Gigi"' })
  await runBash({ command: 'git config --global user.email "gigi@cluster.local"' })

  // Configure credential helper using Gitea token for HTTP push
  const giteaUrl = await getConfig('gitea_url')
  const giteaToken = await getConfig('gitea_token')
  if (giteaUrl && giteaToken) {
    const url = new URL(giteaUrl)
    const credUrl = `${url.protocol}//gigi:${giteaToken}@${url.host}`
    await runBash({ command: `git config --global credential.helper '!f() { echo "url=${credUrl}"; }; f'` })
    // Also set a simpler store-based approach
    await runBash({ command: `printf 'url=${credUrl}\\n' | git credential approve 2>/dev/null || true` })
    // Set the extraheader for all gitea repos
    await runBash({ command: `git config --global http.${giteaUrl}/.extraheader "Authorization: token ${giteaToken}"` })
  }

  credentialsConfigured = true
}

export const resetGitConfig = () => { credentialsConfigured = false }

export const gitTool = {
  name: 'git',
  description: 'Run git commands. For cloning, branching, committing, pushing. Working directory defaults to /workspace. Gitea credentials are auto-configured for push.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Git subcommand and args (e.g. "status", "log --oneline -10", "clone http://...")' },
      cwd: { type: 'string', description: 'Working directory (default: /workspace)' }
    },
    required: ['command']
  }
}

export const runGit = async ({ command, cwd = '/workspace' }) => {
  await ensureGitConfig()
  return runBash({ command: `cd "${cwd}" && git ${command}` })
}
